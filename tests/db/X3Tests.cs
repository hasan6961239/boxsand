using System;
using System.Collections.Generic;
using System.IO;
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
        Dictionary<string, object> fin = P(db.X3Export());
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

        db.Dispose();
        Second(dir);
        try { Directory.Delete(dir, true); } catch { }
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
