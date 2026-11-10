using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Qirtasiya.Data;
using Qirtasiya.Engine;

/* واجهة 3.x فوق الأساس الجديد (قرار 0025): ملف 3.x يدخل القاعدة سجلاً سجلاً ويخرج
   منها حرفياً، وكل حفظ يطبّق ما غيّرته الواجهة وحده، والكميات والديون فرقاً */
static class X3Tests
{
    static ImportTests.Check ok;

    static Dictionary<string, object> P(string json) { return (Dictionary<string, object>)Json.Parse(json); }
    static List<object> A(object o) { return (List<object>)o; }
    static Dictionary<string, object> D(object o) { return (Dictionary<string, object>)o; }

    static Dictionary<string, object> Find(Dictionary<string, object> s, string coll, string id)
    {
        foreach (object o in A(s[coll])) if (Json.Str(D(o), "id") == id) return D(o);
        return null;
    }

    /* ملف 3.x صغير فيه كل أنواع الأقسام */
    const string Store =
        "{\"meta\":{\"shopName\":\"مكتبة التجربة\",\"currency\":\"د.ل\",\"libraries\":[\"A\",\"B\"],\"shelves\":6,\"setupDone\":true,\"lastBook\":{\"lib\":\"A\",\"shelf\":1}}," +
        "\"branch\":{\"id\":\"misrata\",\"name\":\"دار الحكمة\",\"city\":\"مصراتة\"}," +
        "\"sync\":{\"url\":\"\",\"key\":\"\",\"auto\":true,\"everyMin\":10}," +
        "\"notify\":{\"enabled\":false,\"kinds\":{\"low\":true,\"sale\":false},\"bigAmount\":100,\"log\":[]}," +
        "\"consignors\":[],\"consignments\":[],\"consPayments\":[],\"closings\":[],\"publishers\":[],\"counts\":[],\"countSession\":null," +
        "\"remotes\":[],\"warehouses\":[{\"id\":\"w1\",\"name\":\"المخزن\",\"stock\":[{\"type\":\"book\",\"itemId\":\"b1\",\"qty\":3}]}],\"outbox\":[]," +
        "\"books\":[{\"id\":\"b2\",\"code\":\"K0002\",\"title\":\"الكيمياء\",\"qty\":5,\"price\":12.5,\"cost\":8,\"lib\":\"A\",\"shelf\":\"1\"}," +
        "{\"id\":\"b1\",\"code\":\"K0001\",\"title\":\"الفيزياء \\\"الأساسية\\\"\",\"qty\":10,\"store\":2,\"price\":30,\"cost\":20,\"lib\":\"B\",\"shelf\":\"3\"}]," +
        "\"stationery\":[{\"id\":\"s1\",\"code\":\"Q0001\",\"name\":\"قلم\",\"qty\":100,\"price\":0.75}]," +
        "\"customers\":[{\"id\":\"c1\",\"name\":\"محمد\",\"balance\":10},{\"id\":\"c2\",\"name\":\"علي\",\"balance\":0}]," +
        "\"suppliers\":[],\"invoices\":[{\"id\":\"i2\",\"no\":2,\"kind\":\"sale\",\"items\":[{\"type\":\"book\",\"id\":\"b1\",\"qty\":1,\"price\":30}],\"total\":30}," +
        "{\"id\":\"i1\",\"no\":1,\"kind\":\"sale\",\"items\":[{\"type\":\"book\",\"id\":\"b2\",\"qty\":2,\"price\":12.5}],\"total\":25}]," +
        "\"payments\":[],\"purchases\":[],\"log\":[{\"at\":\"2026-10-27 18:55\",\"action\":\"إضافة كتاب\",\"detail\":\"الكيمياء\"}]," +
        "\"counters\":{\"invoice\":2,\"book\":2,\"stat\":1},\"phoneDone\":{}}";

    public static void Run(ImportTests.Check check)
    {
        ok = check;
        string dir = Path.Combine(Path.GetTempPath(), "qx3-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        Directory.CreateDirectory(dir);
        ShopDb db = ShopDb.Open(Path.Combine(dir, "x3.db"), null);

        /* ---------- الدخول والخروج حرفياً ---------- */
        ok(!db.X3Mode && db.X3Export() == "null", "قاعدة جديدة: بلا ملف 3.x");
        db.X3Adopt(Store, 1);
        string out1 = db.X3Export();
        ok(db.X3Mode, "بعد التبنّي: القاعدة بواجهة 3.x");
        ok(out1 == Store, "الملف يخرج من القاعدة حرفياً كما دخل", out1.Length + " / " + Store.Length);
        long docs = db.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM x3_docs WHERE key <> ''", 0); });
        ok(docs == 8, "سجل لكل كتاب وقرطاسية وزبون وفاتورة ومخزن (والباقي أقسام كاملة)", docs);
        ok(db.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM change_log WHERE tbl = 'x3_docs'", 0); }) > 0,
            "وكل سجل في سجل التغييرات (يصل الجهاز الثاني)");
        long gen0 = db.X3Gen;
        ok(db.X3Adopt(Store, 1).Changes == 0 && db.X3Gen == gen0, "تبنّي الملف نفسه مرة ثانية لا يغيّر شيئاً");

        /* قائمة الكتب للفروع الأخرى من بيانات 3.x نفسها */
        int cn;
        Dictionary<string, object> cat = P(db.CatalogJson(out cn));
        List<object> b1 = null;
        foreach (object o in A(cat["items"])) if ((string)A(o)[1] == "K0001") b1 = A(o);
        ok(cn == 3 && Json.Str(D(cat["branch"]), "id") == "misrata" && Json.Str(D(cat["branch"]), "name") == "دار الحكمة",
            "قائمة الفرع: كتابان وقلم، باسم الفرع", cn);
        ok(b1 != null && (string)b1[0] == "book" && (long)b1[6] == 10 && (long)b1[7] == 3 && (long)b1[8] == 30000 && (string)b1[9] == "خزانة B · رف 3",
            "الكتاب: ما في المحل، وما في المخزن، والسعر بالدرهم، ومكانه", b1 == null ? "" : Json.Write(b1));

        /* ---------- حفظ من الواجهة ---------- */
        Dictionary<string, object> s = P(out1);
        Dictionary<string, object> nb = P("{\"id\":\"b3\",\"code\":\"K0003\",\"title\":\"كتاب جديد\",\"qty\":4,\"price\":15}");
        A(s["books"]).Insert(0, nb);                                   // كتاب جديد أولاً (كما تفعل 3.x)
        Find(s, "books", "b1")["qty"] = 9L;
        Find(s, "books", "b1")["updated"] = "2026-10-28 10:00";
        A(s["customers"]).RemoveAt(1);
        A(s["invoices"]).Insert(0, P("{\"id\":\"i3\",\"no\":3,\"kind\":\"sale\",\"items\":[{\"type\":\"book\",\"id\":\"b1\",\"qty\":1,\"price\":30}],\"total\":30}"));
        D(s["counters"])["invoice"] = 3L; D(s["counters"])["book"] = 3L;
        A(s["log"]).Insert(0, P("{\"at\":\"2026-10-28 10:00\",\"action\":\"بيع\",\"detail\":\"فاتورة 3\"}"));
        A(s["consignors"]).Add(P("{\"id\":\"o1\",\"name\":\"صاحب كتب\"}"));
        s["newKey"] = "قسم جديد";
        string now1 = Json.Write(s);
        ShopDb.X3Result r1 = db.X3Save(out1, now1, 1);
        string out2 = db.X3Export();
        ok(out2 == now1 && !r1.Merged, "حفظ: كتاب جديد أولاً، كمية، حذف زبون، فاتورة، سجل، قسم جديد — يخرج كما أُرسل", r1.Changes);
        ok(db.X3Gen > gen0, "وكل حفظ يعلن تغييراً");

        /* الترتيب: جديد في الوسط وفي الآخر، ثم إعادة ترتيب */
        s = P(out2);
        A(s["books"]).Insert(2, P("{\"id\":\"b4\",\"title\":\"في الوسط\",\"qty\":1}"));
        A(s["books"]).Add(P("{\"id\":\"b5\",\"title\":\"في الآخر\",\"qty\":1}"));
        string now2 = Json.Write(s);
        db.X3Save(out2, now2, 1);
        string out3 = db.X3Export();
        ok(out3 == now2, "سجل جديد في الوسط وفي الآخر يأخذ مكانه نفسه");
        s = P(out3);
        object first = A(s["books"])[0];
        A(s["books"]).RemoveAt(0);
        A(s["books"]).Add(first);
        string now3 = Json.Write(s);
        db.X3Save(out3, now3, 1);
        ok(db.X3Export() == now3, "وإعادة ترتيب الموجود تُحفظ");

        /* الأقسام تتبدّل بين «سجلات» و«كاملة» (مصفوفة فارغة أو بلا معرّفات) */
        string out4 = db.X3Export();
        s = P(out4);
        s["consignors"] = new List<object>();
        A(s["warehouses"]).Add(P("{\"name\":\"بلا معرّف\"}"));
        string now4 = Json.Write(s);
        db.X3Save(out4, now4, 1);
        ok(db.X3Export() == now4, "مصفوفة سجلات صارت فارغة، وأخرى صارت بلا معرّفات: تخرج كما هي");
        string out5 = db.X3Export();
        s = P(out5);
        s.Remove("newKey");
        A(s["warehouses"]).RemoveAt(1);
        string now5 = Json.Write(s);
        db.X3Save(out5, now5, 1);
        ok(db.X3Export() == now5, "وقسم محذوف يُحذف، والمصفوفة ترجع سجلات");

        /* ---------- جهازان في وقت واحد ---------- */
        string baseShop = db.X3Export();
        Dictionary<string, object> start = P(baseShop);
        long q0 = Json.Long(Find(start, "books", "b1"), "qty", 0);
        long inv0 = Json.Long(D(start["counters"]), "invoice", 0);
        long bal0 = Json.Long(Find(start, "customers", "c1"), "balance", 0);

        /* اللابتوب (يرى baseShop): يبيع نسخة بالآجل لمحمد، ويضيف كتاباً برمز K0006 */
        s = P(baseShop);
        Find(s, "books", "b1")["qty"] = q0 - 1;
        Find(s, "customers", "c1")["balance"] = bal0 + 30;
        A(s["invoices"]).Insert(0, P("{\"id\":\"L1\",\"no\":" + (inv0 + 1) + ",\"kind\":\"sale\",\"customerId\":\"c1\",\"total\":30}"));
        D(s["counters"])["invoice"] = inv0 + 1;
        A(s["books"]).Insert(0, P("{\"id\":\"L2\",\"code\":\"K0006\",\"barcode\":\"K0006\",\"title\":\"من اللابتوب\",\"qty\":2}"));
        D(s["counters"])["book"] = 6L;
        List<X3Op> laptop = ShopDb.X3Diff(baseShop, Json.Write(s));
        ShopDb.X3Result rl = db.X3Apply(ShopDb.X3OpsFrom(Json.Parse(ShopDb.X3OpsJson(laptop))), true, 1, "لابتوب");
        Dictionary<string, object> afterL = P(db.X3Export());
        ok(Json.Long(Find(afterL, "invoices", "L1"), "no", 0) == inv0 + 1 && Json.Long(D(afterL["counters"]), "invoice", 0) == inv0 + 1,
            "بيعة اللابتوب تأخذ الرقم التالي في المحل", Find(afterL, "invoices", "L1"));

        /* المحل (ما زال على baseShop في الذاكرة): يبيع نسختين نقداً، ويضيف كتاباً برمز K0006 أيضاً */
        s = P(baseShop);
        Find(s, "books", "b1")["qty"] = q0 - 2;
        A(s["invoices"]).Insert(0, P("{\"id\":\"S1\",\"no\":" + (inv0 + 1) + ",\"kind\":\"sale\",\"total\":60}"));
        D(s["counters"])["invoice"] = inv0 + 1;
        A(s["books"]).Insert(0, P("{\"id\":\"S2\",\"code\":\"K0006\",\"title\":\"من المحل\",\"qty\":1}"));
        D(s["counters"])["book"] = 6L;
        ShopDb.X3Result rs = db.X3Save(baseShop, Json.Write(s), 1);
        string finTxt = db.X3Export();
        Dictionary<string, object> fin = P(finTxt);
        ok(Json.Long(Find(fin, "books", "b1"), "qty", 0) == q0 - 3, "الكمية: نسخة من اللابتوب ونسختان من المحل تُطرح الثلاث", Find(fin, "books", "b1")["qty"]);
        ok(Json.Long(Find(fin, "customers", "c1"), "balance", 0) == bal0 + 30, "ودين محمد من بيعة اللابتوب باقٍ بعد حفظ المحل");
        ok(Json.Long(Find(fin, "invoices", "S1"), "no", 0) == inv0 + 2 && Json.Long(D(fin["counters"]), "invoice", 0) == inv0 + 2,
            "فاتورة المحل أخذت الرقم التالي، لا رقم فاتورة اللابتوب", Find(fin, "invoices", "S1")["no"]);
        ok(Json.Str(Find(fin, "books", "S2"), "code") == "K0007" && Json.Str(Find(fin, "books", "L2"), "code") == "K0006" &&
            Json.Long(D(fin["counters"]), "book", 0) == 7, "ورمز الكتاب المكرر يصير الرمز التالي", Find(fin, "books", "S2"));
        ok(rs.Merged && !rl.Merged, "والمحل يعرف أن عليه إعادة التحميل (تغيّر ما لم يرسله)");
        ok(Find(fin, "books", "L2") != null && Find(fin, "invoices", "L1") != null, "وما أضافه اللابتوب لم يُمسح بحفظ المحل");

        /* اللابتوب يرجع فاتورته (برقمه عنده) بعد أن أخذت رقماً آخر هنا */
        string baseL = db.X3Export();
        s = P(baseL);
        Find(s, "invoices", "L1")["no"] = 999L;                         // ما يراه اللابتوب قبل أن يصله الرقم الجديد
        string lapView = Json.Write(s);
        A(s["invoices"]).Insert(0, P("{\"id\":\"L3\",\"no\":1000,\"kind\":\"return\",\"refNo\":999,\"total\":-30}"));
        List<X3Op> ret = ShopDb.X3Diff(lapView, Json.Write(s));
        db.X3Apply(ShopDb.X3OpsFrom(Json.Parse(ShopDb.X3OpsJson(ret))), true, 1, "لابتوب");
        Dictionary<string, object> fr = P(db.X3Export());
        ok(Json.Long(Find(fr, "invoices", "L3"), "refNo", 0) == Json.Long(Find(fr, "invoices", "L1"), "no", 0),
            "إرجاعه يشير لرقم فاتورته هنا", Find(fr, "invoices", "L3"));

        /* المحل على نسخة قبل إرجاع اللابتوب (عدّاده أقل بواحد) يحفظ ثلاث فواتير دفعة واحدة (ثلاثة طلبات
           تلفون أُخذت معاً): الأولى أُخذ رقمها هنا. كانت تأخذ التالي والثانية تبقى برقمها وهو نفسه */
        s = P(finTxt);
        long c0 = Json.Long(D(s["counters"]), "invoice", 0);
        for (int k = 1; k <= 3; k++)
            A(s["invoices"]).Insert(0, P("{\"id\":\"P" + k + "\",\"no\":" + (c0 + k) + ",\"kind\":\"sale\",\"total\":10,\"source\":\"phone\"}"));
        D(s["counters"])["invoice"] = c0 + 3;
        ShopDb.X3Result rp = db.X3Save(finTxt, Json.Write(s), 1);
        Dictionary<string, object> ph = P(db.X3Export());
        List<string> nos = new List<string>();
        HashSet<long> uniq = new HashSet<long>();
        foreach (object o in A(ph["invoices"])) { long n = Json.Long(D(o), "no", 0); nos.Add(n.ToString()); uniq.Add(n); }
        ok(uniq.Count == nos.Count, "ثلاث فواتير دفعة من المحل وأول رقم منها مأخوذ هنا: لا رقم مكرّر", string.Join(",", nos.ToArray()));
        ok(Json.Long(Find(ph, "invoices", "P1"), "no", 0) == c0 + 2 && Json.Long(Find(ph, "invoices", "P2"), "no", 0) == c0 + 3 &&
            Json.Long(Find(ph, "invoices", "P3"), "no", 0) == c0 + 4 && Json.Long(D(ph["counters"]), "invoice", 0) == c0 + 4 && rp.Merged,
            "أخذت الأرقام التالية بترتيبها، والعدّاد بعدها، والمحل يعيد التحميل",
            Find(ph, "invoices", "P1")["no"] + "/" + Find(ph, "invoices", "P2")["no"] + "/" + Find(ph, "invoices", "P3")["no"] + " عدّاد " + D(ph["counters"])["invoice"]);

        /* فاتورة جديدة برقم أكبر من العدّاد والشاشة لم ترسل العدّاد: العدّاد يلحقها (فلا يُعطى رقمها لغيرها) */
        string bq = db.X3Export();
        s = P(bq);
        long c1 = Json.Long(D(s["counters"]), "invoice", 0);
        A(s["invoices"]).Insert(0, P("{\"id\":\"Q1\",\"no\":" + (c1 + 5) + ",\"kind\":\"sale\",\"total\":5}"));
        db.X3Save(bq, Json.Write(s), 1);
        ok(Json.Long(D(P(db.X3Export())["counters"]), "invoice", 0) == c1 + 5, "فاتورة برقم بعد العدّاد بلا عدّاد معها: العدّاد يصير رقمها");

        db.Dispose();
        Second(dir);
        Empty(dir);
        SameDiff();
        PatchSame();
        Codes(dir);
        try { Directory.Delete(dir, true); } catch { }
    }

    /* ---------- الفرق من النص = التحليل الكامل ----------
       X3Diff يقارن نص كل سجل بنظيره ولا يحلّل إلا ما اختلف (حفظ 20 ألف كتاب كان أكثر من ثانية).
       يجب أن يعطي ما يعطيه X3DiffParsed (الملفان كاملين كائنات) بالضبط: مئات التغييرات
       العشوائية، ومنها رقم كُتب بطريقة أخرى (15.0)، ومسافات، ونص فيه هروب، ومعرّفات أرقام */
    static Dictionary<string, object> Big(Random r)
    {
        Dictionary<string, object> s = P(Store);
        List<object> books = A(s["books"]), inv = A(s["invoices"]);
        for (int i = 3; i < 40; i++)
            books.Add(P("{\"id\":\"b" + i + "\",\"code\":\"K" + i.ToString("0000") + "\",\"title\":\"كتاب \\\"" + i + "\\\" \\\\ " + i +
                "\",\"qty\":" + r.Next(0, 30) + ",\"price\":" + (r.Next(1, 400) / 4.0).ToString(System.Globalization.CultureInfo.InvariantCulture) + "}"));
        for (int i = 3; i < 25; i++)
            inv.Insert(0, P("{\"id\":\"i" + i + "\",\"no\":" + i + ",\"kind\":\"sale\",\"items\":[{\"type\":\"book\",\"id\":\"b" + (i + 3) + "\",\"qty\":1}],\"total\":" + i + "}"));
        D(s["counters"])["invoice"] = 24L;
        s["nums"] = new List<object> { P("{\"id\":1,\"v\":\"a\"}"), P("{\"id\":2.5,\"v\":\"b\"}"), P("{\"id\":3,\"v\":\"c\"}") };
        return s;
    }

    static readonly string[] Colls = { "books", "invoices", "customers", "stationery", "nums", "warehouses" };
    static int fresh;

    static void Mutate(Random r, Dictionary<string, object> s)
    {
        string coll = Colls[r.Next(Colls.Length)];
        List<object> l = s.ContainsKey(coll) ? s[coll] as List<object> : null;
        switch (r.Next(12))
        {
            case 0: case 1: case 2:   // حقل في سجل
                if (l == null || l.Count == 0 || D(l[r.Next(l.Count)]) == null) break;
                Dictionary<string, object> d = D(l[r.Next(l.Count)]);
                int f = r.Next(5);
                if (f == 0) d["qty"] = (long)r.Next(-3, 50);
                else if (f == 1) d["price"] = r.Next(0, 900) / 8.0;
                else if (f == 2) d["title"] = "عنوان \"" + r.Next(100) + "\" \\ جديد";
                else if (f == 3) d["extra" + r.Next(3)] = new List<object> { (long)r.Next(9), "س" };
                else if (d.Count > 1) { List<string> ks = new List<string>(d.Keys); ks.Remove("id"); if (ks.Count > 0) d.Remove(ks[r.Next(ks.Count)]); }
                break;
            case 3: case 4:           // سجل جديد في مكان ما
                if (l == null) break;
                Dictionary<string, object> nr = P("{\"id\":\"new" + (++fresh) + "\",\"code\":\"K" + r.Next(1, 60).ToString("0000") + "\",\"qty\":3}");
                if (coll == "invoices" && r.Next(2) == 0)
                {
                    nr["kind"] = "return";
                    nr["refNo"] = (long)r.Next(1, 30);
                    nr["no"] = (long)(100 + fresh);
                }
                l.Insert(r.Next(l.Count + 1), nr);
                break;
            case 5:                   // حذف سجل
                if (l != null && l.Count > 0) l.RemoveAt(r.Next(l.Count));
                break;
            case 6:                   // ترتيب آخر
                if (l != null && l.Count > 1) { int a = r.Next(l.Count), b = r.Next(l.Count); object t = l[a]; l[a] = l[b]; l[b] = t; }
                break;
            case 7:                   // مصفوفة صارت فارغة، أو قسم حُذف، أو قسم جديد
                int k = r.Next(3);
                if (k == 0) s[coll] = new List<object>();
                else if (k == 1) s.Remove(coll);
                else s["key" + r.Next(4)] = r.Next(2) == 0 ? (object)(long)r.Next(9) : P("{\"x\":[1,2,{\"y\":\"ص\"}]}");
                break;
            case 8:                   // سجل بلا معرّف، أو معرّف مكرر: لم تعد سجلات
                if (l == null || l.Count == 0) break;
                if (r.Next(2) == 0) l.Add(P("{\"name\":\"بلا معرّف\"}"));
                else if (D(l[0]) != null) l.Add(P("{\"id\":" + Json.Write(Json.Get(D(l[0]), "id")) + ",\"dup\":true}"));
                break;
            case 9:                   // meta وcounters
                D(s["meta"])["shopName"] = "مكتبة " + r.Next(100);
                if (s.ContainsKey("counters") && D(s["counters"]) != null) D(s["counters"])["invoice"] = (long)r.Next(20, 40);
                break;
            case 10:                  // ترتيب المفاتيح
                List<string> keys = new List<string>(s.Keys);
                string kk = keys[r.Next(keys.Count)];
                object v = s[kk];
                s.Remove(kk);
                s[kk] = v;
                break;
            default:                  // لا شيء (الحفظ نفسه مرة أخرى)
                break;
        }
    }

    /* القيم نفسها بنص آخر: 15 ← 15.0، ومسافات بعد الفواصل في بعض السجلات */
    static string Reformat(Random r, string t)
    {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < t.Length; i++)
        {
            sb.Append(t[i]);
            if (t[i] == ':' && i + 1 < t.Length && char.IsDigit(t[i + 1]) && r.Next(5) == 0)
            {
                int j = i + 1;
                while (j < t.Length && char.IsDigit(t[j])) j++;
                if (j < t.Length && (t[j] == ',' || t[j] == '}')) { sb.Append(t, i + 1, j - i - 1).Append(".0"); i = j - 1; }
            }
            else if (t[i] == ',' && r.Next(9) == 0) sb.Append(' ');
        }
        return sb.ToString();
    }

    static void SameDiff()
    {
        Random r = new Random(20261102);
        int same = 0, total = 0, withOps = 0;
        string first = null;
        for (int round = 0; round < 600; round++)
        {
            Dictionary<string, object> b = Big(r);
            int pre = r.Next(3);
            for (int i = 0; i < pre; i++) Mutate(r, b);
            string bt = Json.Write(b);
            if (r.Next(6) == 0) bt = Reformat(r, bt);
            Dictionary<string, object> n = P(bt);
            int k = r.Next(0, 6);
            for (int i = 0; i < k; i++) Mutate(r, n);
            string nt = Json.Write(n);
            if (r.Next(4) == 0) nt = Reformat(r, nt);
            string a = ShopDb.X3OpsJson(ShopDb.X3Diff(bt, nt)), c = ShopDb.X3OpsJson(ShopDb.X3DiffParsed(bt, nt));
            total++;
            if (a != "[]") withOps++;
            if (a == c) same++;
            else if (first == null) first = "جولة " + round + ": " + a + " ≠ " + c;
        }
        ok(same == total && withOps > total / 2, "الفرق من النص = التحليل الكامل في " + total + " حفظاً عشوائياً (" + withOps + " فيها تغيير)", first);
        string plain = Json.Write(Big(new Random(1)));
        ok(ShopDb.X3Diff(plain, Reformat(new Random(2), plain).Replace(":24,", ":24.0,")).Count == 0,
            "والقيم نفسها بكتابة أخرى (15.0، مسافات): لا تغيير");
        ok(ShopDb.X3Diff(null, plain).Count == ShopDb.X3DiffParsed(null, plain).Count && ShopDb.X3Diff("null", "{}").Count == 0,
            "وبلا ملف سابق: كل شيء جديد، كما كان");
        bool bad = false;
        try { ShopDb.X3Diff(plain, "[1,2]"); }
        catch (ShopException) { bad = true; }
        ok(bad, "وما ليس ملف 3.x يُرفض كما كان");
    }

    /* ---------- الحفظ بالفرق (X4) ----------
       ما يبنيه X3Patch من النسخة السابقة وفرق الشاشة = ما كانت الشاشة سترسله كله: القيم نفسها،
       والفرق منه نفسه، ومواضعه كما يفحصها X3Scan، وحفظات متتالية كل واحد على ما بناه السابق.
       الفرق هنا يُبنى كما تبنيه الشاشة (core.js: snapOf وpatchText) */
    static string SnapId(object o)
    {
        Dictionary<string, object> d = o as Dictionary<string, object>;
        object v;
        if (d == null || !d.TryGetValue("id", out v)) return null;
        string s = v as string;
        if (s != null) return s.Length > 0 ? s : null;
        if (v is long) return ((long)v).ToString(System.Globalization.CultureInfo.InvariantCulture);
        return null;
    }

    sealed class SnapSec { public string T; public List<string> Ids, Txt; public Dictionary<string, int> Map; }
    sealed class Snap { public List<string> Keys = new List<string>(); public Dictionary<string, SnapSec> Secs = new Dictionary<string, SnapSec>(); }

    static Snap SnapOf(Dictionary<string, object> s)
    {
        Snap sn = new Snap();
        foreach (KeyValuePair<string, object> e in s)
        {
            sn.Keys.Add(e.Key);
            SnapSec sec = new SnapSec();
            List<object> l = e.Value as List<object>;
            if (l != null && l.Count > 0)
            {
                sec.Ids = new List<string>(); sec.Txt = new List<string>(); sec.Map = new Dictionary<string, int>();
                foreach (object o in l)
                {
                    string id = SnapId(o);
                    if (id == null || sec.Map.ContainsKey(id)) { sec.Ids = null; break; }
                    sec.Map[id] = sec.Ids.Count; sec.Ids.Add(id); sec.Txt.Add(Json.Write(o));
                }
            }
            if (sec.Ids == null) { sec.Txt = null; sec.Map = null; sec.T = Json.Write(e.Value); }
            sn.Secs[e.Key] = sec;
        }
        return sn;
    }

    static string PatchOf(Snap b, Snap n)
    {
        List<string> parts = new List<string>();
        List<object> keys = new List<object>();
        foreach (string k in n.Keys)
        {
            keys.Add(k);
            SnapSec ns = n.Secs[k], bs;
            b.Secs.TryGetValue(k, out bs);
            string part = null;
            if (ns.T != null) { if (bs == null || bs.T != ns.T) part = "{\"t\":" + ns.T + "}"; }
            else if (bs == null || bs.Ids == null) part = "{\"t\":[" + string.Join(",", ns.Txt.ToArray()) + "]}";
            else
            {
                List<string> put = new List<string>();
                bool same = ns.Ids.Count == bs.Ids.Count;
                for (int i = 0; i < ns.Ids.Count; i++)
                {
                    int bi;
                    if (!bs.Map.TryGetValue(ns.Ids[i], out bi)) { put.Add(ns.Txt[i]); same = false; continue; }
                    if (bi != i) same = false;
                    if (bs.Txt[bi] != ns.Txt[i]) put.Add(ns.Txt[i]);
                }
                if (!same || put.Count > 0)
                {
                    List<string> p = new List<string>();
                    if (put.Count > 0) p.Add("\"put\":[" + string.Join(",", put.ToArray()) + "]");
                    if (!same)
                    {
                        List<object> runs = new List<object>();
                        int rs = -1, rl = 0;
                        foreach (string id in ns.Ids)
                        {
                            int bi;
                            bool inB = bs.Map.TryGetValue(id, out bi);
                            if (inB && rl > 0 && bi == rs + rl) { rl++; continue; }
                            if (rl > 0) { runs.Add(new List<object> { (long)rs, (long)rl }); rl = 0; }
                            if (!inB) runs.Add(id); else { rs = bi; rl = 1; }
                        }
                        if (rl > 0) runs.Add(new List<object> { (long)rs, (long)rl });
                        p.Add("\"order\":" + Json.Write(runs));
                    }
                    part = "{" + string.Join(",", p.ToArray()) + "}";
                }
            }
            if (part != null) parts.Add(Json.Write(k) + ":" + part);
        }
        return "{\"x3patch\":1,\"keys\":" + Json.Write(keys) + ",\"secs\":{" + string.Join(",", parts.ToArray()) + "}}";
    }

    /* المواضع كما يفحصها X3Scan من النص نفسه */
    static string SamePlaces(ShopDb.X3Doc a, ShopDb.X3Doc b)
    {
        if (a == null || b == null) return "لا يُفحص";
        if (string.Join("|", a.Keys.ToArray()) != string.Join("|", b.Keys.ToArray())) return "المفاتيح";
        foreach (string k in a.Keys)
        {
            ShopDb.X3Sec x = a.Secs[k], y = b.Secs[k];
            if (x.Start != y.Start || x.Len != y.Len) return k + ": موضع القسم";
            if ((x.Ids == null) != (y.Ids == null)) return k + ": سجلات أم لا";
            if (x.Ids == null) continue;
            if (x.Ids.Count != y.Ids.Count) return k + ": العدد";
            for (int i = 0; i < x.Ids.Count; i++)
                if (x.Ids[i] != y.Ids[i] || x.RStart[i] != y.RStart[i] || x.RLen[i] != y.RLen[i]) return k + ": السجل " + i;
            if (x.Map != null) foreach (KeyValuePair<string, int> e in x.Map) if (x.Ids[e.Value] != e.Key) return k + ": الفهرس";
        }
        return null;
    }

    static void PatchSame()
    {
        Random r = new Random(20261106);
        int rounds = 0, good = 0, small = 0, backSmall = 0;
        string first = null;
        for (int chain = 0; chain < 200; chain++)
        {
            Dictionary<string, object> b = Big(r);
            for (int i = r.Next(3); i > 0; i--) Mutate(r, b);
            string bt = Json.Write(b);
            if (r.Next(5) == 0) bt = Reformat(r, bt);          // ما في البرنامج مكتوب بطريقة أخرى
            ShopDb.X3Doc bd = ShopDb.X3ScanOrNull(bt);
            Snap sb = SnapOf(P(bt));                            // ما رأته الشاشة بعد التحميل
            Dictionary<string, object> n = P(bt);
            for (int step = 0; step < 4; step++)
            {
                for (int i = r.Next(0, 5); i > 0; i--) Mutate(r, n);
                string nt = Json.Write(n);
                Snap sn = SnapOf(n);
                string patch = PatchOf(sb, sn), err, full;
                ShopDb.X3Doc pd = ShopDb.X3Patch(bd, patch, out err, out full);
                rounds++;
                string why = pd == null ? "رُفض: " + err
                    : !ShopDb.JsonEqual(Json.Parse(pd.Src), Json.Parse(nt)) ? "القيم"
                    : ShopDb.X3OpsJson(ShopDb.X3Diff(bd, pd)) != ShopDb.X3OpsJson(ShopDb.X3Diff(bt, nt)) ? "الفرق"
                    : SamePlaces(pd, ShopDb.X3ScanOrNull(pd.Src));
                /* والعكس: ما يرسله البرنامج للشاشة (X3PatchFrom) يعطي الملف نفسه */
                if (why == null)
                {
                    string back = ShopDb.X3PatchFrom(bd, pd), e2, f2;
                    ShopDb.X3Doc bk = ShopDb.X3Patch(bd, back, out e2, out f2);
                    if (bk == null) why = "العكس رُفض: " + e2;
                    else if (!ShopDb.JsonEqual(Json.Parse(bk.Src), Json.Parse(pd.Src)) || SamePlaces(bk, ShopDb.X3ScanOrNull(bk.Src)) != null) why = "العكس لا يطابق";
                    else if (!(Json.Parse(back) is Dictionary<string, object>)) why = "العكس ليس JSON";
                    else if (back.Length * 4 < nt.Length) backSmall++;
                }
                if (why == null) good++;
                else if (first == null) first = "سلسلة " + chain + " خطوة " + step + ": " + why + " — " + (patch.Length > 400 ? patch.Substring(0, 400) : patch);
                if (patch.Length * 4 < nt.Length) small++;
                if (pd == null) break;
                bd = pd; bt = pd.Src; sb = sn;                  // الحفظ القادم على ما بناه هذا
            }
        }
        ok(good == rounds && small > rounds / 2, "الحفظ بالفرق = الملف كله في " + rounds + " حفظاً متتالياً عشوائياً (" + small + " منها أصغر من ربع الملف)", first);
        ok(backSmall > rounds / 2, "وما يرسله البرنامج للشاشة بعد تغيير من جهاز آخر يعطي الملف نفسه (" + backSmall + " منها أصغر من ربع الملف)", backSmall);

        /* فرق لا يستقيم يُرفض (والشاشة ترسل الملف كله) */
        string bt0 = Json.Write(Big(new Random(3)));
        ShopDb.X3Doc b0 = ShopDb.X3ScanOrNull(bt0);
        string keys0 = Json.Write(new List<object>(b0.Keys.ToArray()));
        int nb = b0.Secs["books"].Ids.Count;
        string[] bad = {
            "{\"keys\":" + keys0 + ",\"secs\":{}}",                                                            // بلا x3patch
            "{\"x3patch\":2,\"keys\":" + keys0 + ",\"secs\":{}}",
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"nope\":{\"t\":1}}}",                            // قسم ليس في المفاتيح
            "{\"x3patch\":1,\"keys\":" + keys0.Replace("]", ",\"new\"]") + ",\"secs\":{}}",                    // مفتاح جديد بلا نص
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"books\":{\"order\":[[0," + (nb + 1) + "]]}}}",  // خارج النسخة
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"books\":{\"order\":[[0,2],[1,1]]}}}",           // مكرر
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"books\":{\"order\":[]}}}",                       // فارغة
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"books\":{\"put\":[{\"id\":\"zz\",\"qty\":1}]}}}", // جديد بلا مكان
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"books\":{\"put\":[{\"id\":\"zz\"}],\"order\":[[0," + nb + "]]}}}", // أُرسل وليس في الترتيب
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"books\":{\"order\":[\"zz\",[0," + nb + "]]}}}",    // معرّف جديد بلا سجل
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"books\":{\"t\":[],\"put\":[]}}}",
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"meta\":{\"put\":[{\"id\":\"m\"}]}}}",            // ليس سجلات في الأصل
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"books\":{\"put\":[{\"id\":\"b3\"},{\"id\":\"b3\"}]}}}", // مكرر في put
            "{\"x3patch\":1,\"keys\":[\"meta\",\"meta\"],\"secs\":{}}",
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{\"meta\":{\"t\":{\"a\":}}}}",
            "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{}} x",
        };
        int refused = 0;
        string took = null;
        foreach (string p in bad)
        {
            string err, full;
            if (ShopDb.X3Patch(b0, p, out err, out full) == null) refused++;
            else if (took == null) took = p;
        }
        ok(refused == bad.Length, "وفرق لا يستقيم يُرفض (" + refused + " من " + bad.Length + ")", took);
        string e0, f0;
        ShopDb.X3Doc same0 = ShopDb.X3Patch(b0, "{\"x3patch\":1,\"keys\":" + keys0 + ",\"secs\":{},\"full\":" + bt0 + "}", out e0, out f0);
        ok(same0 != null && same0.Src == bt0 && f0 == bt0 && ShopDb.X3Diff(b0, same0).Count == 0,
            "وفرق بلا تغيير: الملف نفسه حرفياً، ومعه الملف كله للمقارنة في الاختبار", e0);
    }

    /* ---------- رموز الأصناف ----------
       كان كل صنف جديد يسأل القاعدة عن رمزه بالمرور على كل الأصناف: نقل عشرين ألف كتاب أخذ
       أكثر من أربع دقائق. صارت الرموز تُقرأ مرة في الحفظ وتُتابَع فيه */
    static void Codes(string dir)
    {
        ShopDb db = ShopDb.Open(Path.Combine(dir, "x3-codes.db"), null);
        StringBuilder sb = new StringBuilder("{\"books\":[");
        int n = 6000;
        for (int i = 1; i <= n; i++)
            sb.Append(i > 1 ? "," : "").Append("{\"id\":\"b").Append(i).Append("\",\"code\":\"K").Append(i.ToString("00000"))
              .Append("\",\"title\":\"كتاب ").Append(i).Append("\",\"qty\":3}");
        sb.Append("],\"counters\":{\"invoice\":0,\"book\":").Append(n).Append(",\"stat\":0}}");
        System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
        db.X3Adopt(sb.ToString(), 1);
        long ms = sw.ElapsedMilliseconds;
        ok(ms < 20000 && db.X3Export() == sb.ToString(), "أخذ " + n + " كتاب للقاعدة في " + ms + " ms، كما هي حرفياً");
        /* حذف كتاب، ثم كتاب جديد برمزه نفسه (يبقى)، وكتاب برمز موجود (يأخذ التالي) */
        Dictionary<string, object> s = P(db.X3Export());
        List<object> books = A(s["books"]);
        books.RemoveAt(0);
        db.X3Save(db.X3Export(), Json.Write(s), 1);
        s = P(db.X3Export());
        books = A(s["books"]);
        books.Insert(0, P("{\"id\":\"x1\",\"code\":\"K00001\",\"title\":\"مكان المحذوف\",\"qty\":1}"));
        books.Insert(0, P("{\"id\":\"x2\",\"code\":\"K00002\",\"title\":\"رمز مأخوذ\",\"qty\":1}"));
        ShopDb.X3Result res = db.X3Save(db.X3Export(), Json.Write(s), 1);
        Dictionary<string, object> after = P(db.X3Export());
        ok(Json.Str(Find(after, "books", "x1"), "code") == "K00001" && Json.Str(Find(after, "books", "x2"), "code") == "K6001" &&
            res.Merged, "الرمز الذي حُذف صاحبه يبقى، والمأخوذ يصير التالي", Json.Write(Find(after, "books", "x2")));
        db.Dispose();
    }

    /* محل بلا قرطاسية (أو بلا كتب): المصفوفة الفارغة قسم واحد لا صنف جديد */
    static void Empty(string dir)
    {
        ShopDb db = ShopDb.Open(Path.Combine(dir, "x3-empty.db"), null);
        Dictionary<string, object> s = P(Store);
        s["stationery"] = new List<object>();
        string st = Json.Write(s);
        string err = "";
        try { db.X3Adopt(st, 1); } catch (Exception ex) { err = ex.Message; }
        ok(err == "" && db.X3Export() == st, "ملف بلا قرطاسية يدخل القاعدة ويخرج كما هو", err);

        s = P(db.X3Export());
        string b0 = Json.Write(s);
        s["books"] = new List<object>();
        string now = Json.Write(s);
        err = "";
        try { db.X3Save(b0, now, 1); } catch (Exception ex) { err = ex.Message; }
        ok(err == "" && db.X3Export() == now, "حذف آخر كتاب يُحفظ", err);

        s = P(now);
        A(s["stationery"]).Add(P("{\"id\":\"s9\",\"code\":\"Q0009\",\"name\":\"ممحاة\",\"qty\":3}"));
        A(s["books"]).Add(P("{\"id\":\"b9\",\"code\":\"K0009\",\"title\":\"أول كتاب من جديد\",\"qty\":1}"));
        string now2 = Json.Write(s);
        err = "";
        try { db.X3Save(now, now2, 1); } catch (Exception ex) { err = ex.Message; }
        ok(err == "" && db.X3Export() == now2, "وأول صنف بعد الفراغ يرجع سجلاً", err);

        /* سجلان جديدان أولاً في حفظ واحد (عمليتان في السجل قبل الحفظ)، وثلاثة متتالية في الوسط */
        s = P(now2);
        A(s["customers"]).Insert(0, P("{\"id\":\"n2\",\"name\":\"ثاني جديد\"}"));
        A(s["customers"]).Insert(0, P("{\"id\":\"n1\",\"name\":\"أول جديد\"}"));
        string now3 = Json.Write(s);
        db.X3Save(now2, now3, 1);
        ok(db.X3Export() == now3, "سجلان جديدان أولاً في حفظ واحد يبقيان أولاً بترتيبهما", db.X3Export().Length);
        s = P(now3);
        for (int i = 3; i >= 1; i--) A(s["customers"]).Insert(2, P("{\"id\":\"m" + i + "\",\"name\":\"في الوسط " + i + "\"}"));
        string now4 = Json.Write(s);
        db.X3Save(now3, now4, 1);
        ok(db.X3Export() == now4, "وثلاثة جديدة متتالية في الوسط بترتيبها");
        db.Dispose();
    }

    /* قطع السجل كلها من جهاز المحل للجهاز الثاني، كما تفعل حلقة المزامنة */
    static void Pull(ShopDb main, ShopDb second)
    {
        while (true)
        {
            long from, to;
            string json = main.LogChunk(second.LocalLong("sync.applied", -1), 50, 100000, out from, out to);
            if (json == null) return;
            second.ApplyRemote(ShopDb.ParseChunk(ShopDb.Unpack(ShopDb.Pack(json))), to);
        }
    }

    /* ما ينتظر في الجهاز الثاني يُنفَّذ عند جهاز المحل، كما تفعل حلقة المزامنة */
    static int Send(ShopDb second, Api mainApi, ref long sid)
    {
        int n = 0;
        foreach (ShopDb.OutboxRow o in second.OutboxUnsent())
        {
            second.OutboxSent(o.N, ++sid);
            string err = mainApi.ExecRemote(sid, "dev2abcdef", "لابتوب", o.N, "{\"user\":" + o.UserId + ",\"cmd\":" + Json.Write(o.Cmd) + ",\"body\":" + o.Body + "}");
            if (err != null) throw new Exception(err);
            n++;
        }
        return n;
    }

    static string Ops(string baseJson, string nowJson)
    {
        return "{\"ops\":" + ShopDb.X3OpsJson(ShopDb.X3Diff(baseJson, nowJson)) + "}";
    }

    /* ---------- المحل واللابتوب (جهاز ثانٍ) كلاهما بواجهة 3.x ---------- */
    static void Second(string dir)
    {
        ShopDb main = ShopDb.Open(Path.Combine(dir, "main.db"), null);
        Api mainApi = new Api(main, null);
        main.X3Adopt(Store, 1);
        string snap = Path.Combine(dir, "snap.db");
        main.SnapshotTo(snap);
        File.Copy(snap, Path.Combine(dir, "second.db"));
        ShopDb second = ShopDb.Open(Path.Combine(dir, "second.db"), null);
        Dictionary<string, string> st = new Dictionary<string, string>();
        st["sync.role"] = "second"; st["sync.device"] = "dev2abcdef"; st["sync.applied"] = main.LogSeq().ToString();
        second.SetLocals(st);
        Api secApi = new Api(second, null);
        int touched = 0;
        second.X3Changed = delegate { touched++; };
        ok(second.X3Mode && second.X3Export() == Store, "اللابتوب يبدأ بنسخة المحل نفسها، بواجهة 3.x");

        /* اللابتوب يبيع: الحفظ ينتظر المحل، ويظهر في شاشته فوراً */
        string lv0 = second.X3ExportWithPending();
        Dictionary<string, object> s = P(lv0);
        Find(s, "books", "b1")["qty"] = 9L;
        A(s["invoices"]).Insert(0, P("{\"id\":\"L1\",\"no\":3,\"kind\":\"sale\",\"items\":[{\"type\":\"book\",\"id\":\"b1\",\"qty\":1,\"price\":30}],\"total\":30}"));
        D(s["counters"])["invoice"] = 3L;
        string lv1 = Json.Write(s);
        Dictionary<string, object> q = P(secApi.RunInternal("x3.apply", Ops(lv0, lv1)).Json);
        ok((bool)q["ok"] && (bool)D(q["data"])["queued"] && ((string)D(q["data"])["label"]) == "بيعة", "حفظ اللابتوب ينتظر جهاز المحل بوصفه «بيعة»", q);
        ok(second.X3Export() == Store, "وقاعدة اللابتوب نفسها لم تتغيّر");
        ok(second.X3ExportWithPending() == lv1, "لكن شاشته تراه كما حفظه (المنتظر فوق ما عنده)");

        /* حفظ ثانٍ على اللابتوب فوق الأول: كتاب جديد */
        s = P(lv1);
        A(s["books"]).Insert(0, P("{\"id\":\"L2\",\"code\":\"K0003\",\"title\":\"من اللابتوب\",\"qty\":2}"));
        D(s["counters"])["book"] = 3L;
        string lv2 = Json.Write(s);
        q = P(secApi.RunInternal("x3.apply", Ops(lv1, lv2)).Json);
        ok((bool)D(q["data"])["queued"] && (string)D(q["data"])["label"] == "صنف جديد: من اللابتوب", "والكتاب الجديد ينتظر بعده", q);
        ok(second.X3ExportWithPending() == lv2, "والشاشة ترى الحفظين معاً");

        /* المحل في الوقت نفسه يبيع نسختين برقم الفاتورة نفسه */
        string sv0 = main.X3Export();
        s = P(sv0);
        Find(s, "books", "b1")["qty"] = 8L;
        A(s["invoices"]).Insert(0, P("{\"id\":\"S1\",\"no\":3,\"kind\":\"sale\",\"total\":60}"));
        D(s["counters"])["invoice"] = 3L;
        main.X3Save(sv0, Json.Write(s), 1);

        /* الاتصال: المحل ينفّذ ما انتظر، واللابتوب يأخذ السجل */
        long sid = 0;
        ok(Send(second, mainApi, ref sid) == 2, "المحل ينفّذ الحفظين");
        Dictionary<string, object> m = P(main.X3Export());
        ok(Json.Long(Find(m, "books", "b1"), "qty", 0) == 7 && Json.Long(Find(m, "invoices", "L1"), "no", 0) == 4 &&
            Json.Long(Find(m, "invoices", "S1"), "no", 0) == 3 && Find(m, "books", "L2") != null,
            "في المحل: الكمية 10−1−2، وبيعة اللابتوب أخذت الرقم 4، والكتاب وصل", Find(m, "invoices", "L1"));
        ok(second.X3ExportWithPending() == lv2, "قبل وصول السجل: شاشة اللابتوب على حالها (لا يُطبَّق شيء مرتين)");
        touched = 0;
        Pull(main, second);
        ok(touched > 0, "وصول السجل يعلن تغييراً (شاشة اللابتوب تعيد التحميل)");
        ok(second.X3Export() == main.X3Export() && second.X3ExportWithPending() == main.X3Export(),
            "بعده: اللابتوب مثل المحل حرفياً، ولا شيء ينتظر");
        ok(Json.Long(Find(P(second.X3Export()), "invoices", "L1"), "no", 0) == 4, "وفاتورته برقمها في المحل");

        /* أمر تكرّر وصوله (انقطاع قبل حفظ آخر ما نُفّذ) لا يُنفَّذ مرتين */
        ok(mainApi.ExecRemote(1, "dev2abcdef", "لابتوب", 1, "{\"user\":1,\"cmd\":\"x3.apply\",\"body\":" + Ops(lv0, lv1) + "}") == null &&
            main.X3Export() == second.X3Export(), "وأمر نُفّذ يصل مرة ثانية لا يتكرّر");

        main.Dispose(); second.Dispose();
    }
}
