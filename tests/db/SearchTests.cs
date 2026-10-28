using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using Qirtasiya.Data;
using Qirtasiya.Engine;

/* ============================================================
   البحث بالاسم (المرحلة 3، قرار 0009)
   ------------------------------------------------------------
   القائمة الثابتة من الخطة: «الفيزياء الأساسية» أولاً، الغلط الإملائي،
   الهمزات، «الجزء التاني» = «2». ومعها اختبارات 3.2 كما هي (tools/test.js
   «البحث المتسامح»)، وصيانة الفهرس مع كل تعديل، والإلغاء.
   ============================================================ */
static class SearchTests
{
    static ImportTests.Check ok;
    static ShopDb db;
    static readonly Dictionary<string, long> ids = new Dictionary<string, long>();

    public static void Run(ImportTests.Check check)
    {
        ok = check;
        Normalize();
        Scores();
        string path = Path.Combine(Path.GetTempPath(), "qsearch-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".db");
        db = ShopDb.Open(path, null);
        try
        {
            Seed();
            FixedList();
            Ranking32();
            Maintenance(path);
            ApiSearch();
            Cancelling();
        }
        finally
        {
            db.Dispose();
            foreach (string f in new string[] { path, path + "-wal", path + "-shm" }) { try { File.Delete(f); } catch { } }
        }
    }

    /* ---------- التوحيد ---------- */

    static void Same(string a, string b, string name)
    {
        string x = Search.Norm(a), y = Search.Norm(b);
        ok(x == y, name, "«" + x + "» ≠ «" + y + "»");
    }

    static void Normalize()
    {
        /* ملفات الكود UTF-8: مترجم ويندوز يقرأ الحروف العربية كما هي */
        ok("ا".Length == 1 && "ا"[0] == (char)0x0627 && "الجزء".Length == 5, "الحروف العربية في الكود تُقرأ كما كُتبت (UTF-8)");
        Same("أساسيات", "اساسيات", "الهمزات: «أساسيات» = «اساسيات»");
        Same("إبراهيم آمنة", "ابراهيم امنة", "الهمزات: إ آ = ا");
        Same("مكتبة", "مكتبه", "التاء المربوطة = الهاء");
        Same("مستشفى", "مستشفي", "الألف المقصورة = الياء");
        Same("مُحَمَّد", "محمد", "التشكيل يُحذف");
        Same("الكـــتاب", "الكتاب", "التطويل يُحذف");
        Same("الصف ٣", "الصف 3", "الأرقام العربية = اللاتينية");
        Same("رياضيات الجزء التاني", "رياضيات 2", "«الجزء التاني» = «2»");
        Same("رياضيات الجزء الثاني", "رياضيات ج2", "«الجزء الثاني» = «ج2»");
        Same("رياضيات ج ٢", "رياضيات 2", "«ج ٢» = «2»");
        Same("رياضيات (الجزء الأول)", "رياضيات 1", "«الجزء الأول» = «1»، والأقواس لا تهم");
        Same("الطبعة الثالثة", "ط3", "«الطبعة الثالثة» = «ط3»");
        Same("الحرب العالمية الثانية", "الحرب العالميه 2", "الترتيبي بـ«ال» رقم في أي مكان");
        Same("د. أشرف محمود", "دكتور أشرف محمود", "«د.» = «دكتور»");
        Same("الأستاذ أشرف محمود", "أشرف محمود", "«الأستاذ» يُحذف قبل الاسم");
        Same("أ.د. علي", "علي", "«أ.د.» يُحذف");
        ok(Search.Norm("فيتامين د") == "فيتامين د", "«فيتامين د»: «د» في آخر الاسم ليست لقباً", Search.Norm("فيتامين د"));
        ok(Search.Norm("تفسير جزء عم") == "تفسير جزء عم", "«جزء عم»: «جزء» بلا رقم بعدها تبقى", Search.Norm("تفسير جزء عم"));
        ok(Search.Norm("د") == "د" && Search.Norm("ج") == "ج", "حرف واحد يُكتب أول البحث لا يُحذف");
        Same("ﻻ تحزن", "لا تحزن", "أشكال العرض (ﻻ) حروف عادية");
        Same("Économie", "economie", "اللاتيني بعلامات وبالكبير = بلا علامات وبالصغير");
        ok(Search.Norm("K-0012") == "k 0012", "العلامات مسافات", Search.Norm("K-0012"));
        ok(Search.NearTerm("شيرلوك") && Search.NearTerm("isbn978") && !Search.NearTerm("k0012") && !Search.NearTerm("9789"),
            "قاموس القريب: الكلمات، لا الأرقام ولا الرموز");
    }

    /* ---------- الدرجات (3.2 كما هي) ---------- */

    static int Near(string q, string hay)
    {
        return Search.MatchNear(Search.Words(Search.Norm(q)), Search.Words(Search.Norm(hay)));
    }

    static int Exact(string q, string name, params string[] others)
    {
        string nq = Search.Norm(q);
        return Search.ExactScore(nq, nq.Split(' '), Search.Norm(name), Search.Others(others));
    }

    static void Scores()
    {
        int typo = Near("شرلوك هولمز", "سلسلة شيرلوك هومز"), sound = Near("حظارة الاسلام", "حضارة الإسلام في أسبانيا"),
            sound2 = Near("رياظ الاطفال", "الكتاب المرجعي لمعلمة رياض الأطفال"), typing = Near("شرلو", "سلسلة شيرلوك هومز"),
            far = Near("رياضيات", "سلسلة شيرلوك هومز"), code = Near("31541518", "سلسلة شيرلوك هومز 31541517"),
            kcode = Near("K0003", "حضارة K0004");
        string m = typo + "/" + sound + "/" + sound2 + "/" + typing + "/" + far + "/" + code + "/" + kcode;
        ok(typo > 0 && typo < 200 && typing > 0, "غلط إملائي يُعدّ «قريب» (3.2)", m);
        ok(sound >= 80 && sound2 >= 80, "الحروف المتشابهة (ظ=ض) قريبة جداً (3.2)", m);
        ok(far == 0, "كلمة بعيدة لا تطابق (3.2)", m);
        ok(code == 0 && kcode == 0, "الباركود والرمز لا يُقرَّبان أبداً (3.2)", m);

        ok(Exact("الفيزياء الأساسية", "الفيزياء الأساسية") == 1000, "1000: الاسم هو البحث");
        ok(Exact("الفيزياء", "الفيزياء الأساسية") == 900, "900: الاسم يبدأ به");
        ok(Exact("فيزياء", "مسائل في الفيزياء") == 850, "850: بداية كلمة بعد «ال»");
        ok(Exact("يزياء", "الفيزياء") == 800, "800: داخل الاسم");
        ok(Exact("آرثر كونان دويل", "سلسلة شيرلوك هومز", "K0002", "آرثر كونان دويل") == 750, "750: خانة أخرى هي البحث نفسه");
        ok(Exact("هومز شيرلوك", "سلسلة شيرلوك هومز") == 700, "700: كل الكلمات في الاسم بأي ترتيب");
        ok(Exact("شيرلوك دويل", "سلسلة شيرلوك هومز", "آرثر كونان دويل") == 500, "500: بعضها في الاسم وبعضها في المؤلف");
        ok(Exact("كونان دويل", "سلسلة شيرلوك هومز", "آرثر كونان دويل") == 400, "400: النص كما كُتب في خانة أخرى");
        ok(Exact("دويل آرثر", "سلسلة شيرلوك هومز", "آرثر كونان دويل") == 300, "300: الكلمات متفرّقة في الخانات الأخرى");
        ok(Exact("رياضيات", "سلسلة شيرلوك هومز", "آرثر") == 0, "0: لا يطابق");
    }

    /* ---------- مكتبة صغيرة ---------- */

    static long Add(string key, string kind, string title, string author, string cat, string barcode, string note)
    {
        ItemInput d = new ItemInput();
        d.Kind = kind; d.Title = title; d.Author = author ?? ""; d.Cat = cat ?? ""; d.Barcode = barcode ?? ""; d.Note = note ?? "";
        d.Price = 10000;
        long id = db.AddItem(d, 2, 0, 1);
        if (key != null) ids[key] = id;
        return id;
    }

    static void Seed()
    {
        /* بيانات اختبار 3.2: كتب تصنيفها فيه نفس الكلمات تأتي قبل الكتاب المقصود */
        Add("b2", "book", "سلسلة شيرلوك هومز", "آرثر كونان دويل", "", "31541517", "");
        Add("b3", "book", "حضارة الإسلام في أسبانيا", "", "", "", "");
        Add("b4", "book", "الكتاب المرجعي لمعلمة رياض الأطفال", "", "", "", "");
        for (int i = 0; i < 9; i++) Add("p" + i, "book", "أساسيات المختبر " + i, "", "العلوم الأساسية: الفيزياء", "", "");
        Add("p9", "book", "مسائل محلولة في الفيزياء الأساسية", "", "", "", "");
        Add("pb", "book", "الفيزياء الأساسية", "", "العلوم الأساسية", "", "");
        /* المرحلة 3 */
        Add("r1", "book", "رياضيات الجزء الأول", "", "", "", "");
        Add("r2", "book", "رياضيات الجزء الثاني", "", "", "", "");
        Add("r3", "book", "رياضيات الجزء الثالث", "", "", "", "");
        Add("chem", "book", "الكيمياء العامة", "د. أشرف محمود", "", "", "");
        Add("grade", "book", "اللغة العربية للصف ٣ الابتدائي", "", "", "", "");
        Add("geo", "book", "كتاب التمارين", "", "", "", "فيه تمارين الهندسة الفراغية");
        Add("pen", "stat", "قلم حبر أزرق", "", "", "", "");
    }

    static SearchResult Find(string q, int limit)
    {
        SearchOptions o = new SearchOptions();
        o.Limit = limit;
        return db.SearchItems(q, o);
    }

    static string Keys(SearchResult r, int n)
    {
        List<string> k = new List<string>();
        for (int i = 0; i < r.Ids.Count && i < n; i++)
        {
            string name = "#" + r.Ids[i];
            foreach (KeyValuePair<string, long> kv in ids) if (kv.Value == r.Ids[i]) name = kv.Key;
            k.Add(name);
        }
        return string.Join(",", k.ToArray());
    }

    static bool First(SearchResult r, string key) { return r.Ids.Count > 0 && r.Ids[0] == ids[key]; }

    /* القائمة الثابتة في الخطة */
    static void FixedList()
    {
        SearchResult r = Find("الفيزياء الاساسيه", 8);
        ok(First(r, "pb") && r.Ids[1] == ids["p9"] && r.Names == 1 && r.Exact == r.Ids.Count,
            "«الفيزياء الاساسيه»: الكتاب نفسه أول نتيجة، قبل كتب تصنيفها فيه نفس الكلمات", Keys(r, 8));
        r = Find("أساسيات المختبر", 8);
        SearchResult r2 = Find("اساسيات المختبر", 8);
        ok(r.Ids.Count == 8 && Keys(r, 8) == Keys(r2, 8), "الهمزات: «أساسيات» و«اساسيات» نفس النتائج", Keys(r, 8) + " | " + Keys(r2, 8));
        r = Find("رياضيات الجزء التاني", 8);
        ok(First(r, "r2") && r.Names == 1, "«رياضيات الجزء التاني» (باللهجة): «رياضيات الجزء الثاني» أولاً", Keys(r, 3));
        r = Find("رياضيات 2", 8);
        ok(First(r, "r2") && r.Names == 1, "«رياضيات 2» = «الجزء الثاني»", Keys(r, 3));
        r = Find("رياضيات ج٣", 8);
        ok(First(r, "r3") && r.Names == 1, "«رياضيات ج٣» = «الجزء الثالث»", Keys(r, 3));
        r = Find("شرلوك هولمز", 8);
        ok(First(r, "b2") && r.Exact == 0 && r.NearFrom == 0, "غلط إملائي: «شرلوك هولمز» يجد «سلسلة شيرلوك هومز» تحت «هل تقصد؟»", Keys(r, 3));
        r = Find("حظارة الاسلام", 8);
        ok(First(r, "b3") && r.NearFrom == 0, "الحروف المتشابهة: «حظارة» تجد «حضارة»", Keys(r, 3));
        r = Find("دكتور أشرف", 8);
        SearchResult r3 = Find("د. أشرف محمود", 8);
        ok(First(r, "chem") && First(r3, "chem") && r3.Scores[0] == 750, "المؤلف: «دكتور أشرف» و«د. أشرف محمود» يجدان كتابه", Keys(r, 3) + " | " + r3.Scores[0]);
        r = Find("العربية للصف 3", 8);
        ok(First(r, "grade"), "«للصف 3» تجد «للصف ٣»", Keys(r, 3));
    }

    /* اختبارات 3.2 (tools/test.js) على المحرك */
    static void Ranking32()
    {
        SearchResult r = Find("الفيزياء", 8);
        ok(First(r, "pb") && r.Ids[1] == ids["p9"], "3.2: كلمة واحدة — الكتب التي اسمها فيه الكلمة أولاً", Keys(r, 4));
        r = Find("الفيزياء الأساسية", 0);
        ok(First(r, "pb") && r.Ids[1] == ids["p9"] && r.Ids.Count == 11, "3.2: جدول الكتب (كل النتائج) بنفس الترتيب، 11 كتاباً", Keys(r, 12));
        r = Find("شرلوك", 8);
        ok(First(r, "b2") && r.Exact == 0 && r.NearFrom == 0, "3.2: القريب يظهر ومعلَّم أنه غير مطابق", Keys(r, 3) + " exact=" + r.Exact);
        r = Find("شرلو", 8);
        ok(First(r, "b2"), "3.2: ما زلت تكتب «شرلو» تجد «شيرلوك»", Keys(r, 3));
        r = Find("هومز شيرلوك", 8);
        ok(First(r, "b2") && r.Exact == 1 && r.Scores[0] == 700, "3.2: الكلمات بأي ترتيب مطابق (700)", Keys(r, 3));
        r = Find("31541517", 8);
        ok(First(r, "b2") && r.Scores[0] == 750, "الباركود كاملاً يجد صنفه", Keys(r, 3));
        r = Find("31541518", 8);
        ok(r.Ids.Count == 0, "باركود بخانة غلط لا يجد شيئاً (لا يُقرَّب)", Keys(r, 3));
        r = Find("رياضيات", 8);
        ok(Keys(r, 3) == "r1,r2,r3", "المتساوي: الأقصر ثم الأقدم", Keys(r, 3));
        r = Find("ق", 8);
        ok(First(r, "pen"), "حرف واحد: الأسماء التي تبدأ به", Keys(r, 3));
        SearchOptions o = new SearchOptions();
        o.Limit = 8; o.Kind = "stat";
        r = db.SearchItems("ا", o);
        ok(r.Ids.Count == 1 && First(r, "pen"), "القرطاسية وحدها (kind)", Keys(r, 3));
        r = Find("الفراغية", 8);
        o = new SearchOptions();
        o.Limit = 8; o.Notes = true;
        SearchResult rn = db.SearchItems("الفراغية", o);
        ok(r.Ids.Count == 0 && First(rn, "geo"), "الملاحظات خارج البحث، إلا إن طُلبت (قرار 0009)", Keys(r, 3) + " | " + Keys(rn, 3));
        r = Find("  ", 8);
        ok(r.Ids.Count == 0 && !r.Cancelled, "بحث فارغ: لا شيء");
    }

    /* ---------- الفهرس يتبع كل تعديل ---------- */

    static void Maintenance(string path)
    {
        long id = Add("new", "book", "جغرافيا ليبيا", "", "", "", "");
        ok(First(Find("جغرافيا ليبيا", 8), "new"), "صنف جديد يُوجد فوراً");
        ItemRow it = db.GetItem(id);
        ItemInput d = new ItemInput();
        d.Title = "تاريخ ليبيا الحديث"; d.Barcode = ""; d.Price = it.Price; d.HomePlaceId = it.HomePlaceId;
        db.UpdateItem(id, d, 1);
        ok(Find("جغرافيا", 8).Ids.Count == 0 && First(Find("تاريخ ليبيا", 8), "new"), "تعديل الاسم: القديم لا يُوجد والجديد يُوجد");
        ok(First(Find("ليبيا الحدث", 8), "new"), "وكلمات الاسم الجديد في القريب فوراً (القاموس يتبع)", Keys(Find("ليبيا الحدث", 8), 3));
        db.DeleteItem(id, 1);
        ok(Find("تاريخ ليبيا", 8).Ids.Count == 0, "الصنف المحذوف لا يُوجد");
        bool threw = false;
        ItemInput dup = new ItemInput();
        dup.Kind = "book"; dup.Title = "كتاب برمز مكرر"; dup.Code = db.GetItem(ids["pb"]).Code;
        try { db.AddItem(dup, 0, 0, 1); }
        catch (ShopException) { threw = true; }
        ok(threw && Find("كتاب برمز مكرر", 8).Ids.Count == 0, "أمر فشل (رمز مكرر): لا شيء منه في الفهرس");
        List<string> bad = db.CheckSearchIndex();
        ok(bad.Count == 0 && db.FullCheck().Count == 0, "فحص الفهرس حرفاً بحرف سليم بعد الإضافة والتعديل والحذف", string.Join("؛ ", bad.ToArray()));

        /* صنف كُتب من خارج المحرك: يُصلح عند الفتح. وتغيّر التوحيد: يُبنى كله */
        db.Read<int>(delegate (Sqlite c)
        {
            c.Run("INSERT INTO items(kind, code, title, created_at, updated_at) VALUES('book', 'X1', 'أطلس العالم', '2026-10-26', '2026-10-26')");
            return 0;
        });
        db.Dispose();
        db = ShopDb.Open(path, null);
        ok(db.Report.SearchFixed == 1 && Find("أطلس العالم", 8).Ids.Count == 1, "صنف ناقص من الفهرس يُصلح عند الفتح", db.Report.SearchFixed);
        db.Read<int>(delegate (Sqlite c) { c.Run("DELETE FROM local_state WHERE key = 'search_version'"); return 0; });
        db.Dispose();
        db = ShopDb.Open(path, null);
        long n = db.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM items WHERE active = 1", 0); });
        ok(db.Report.SearchBuilt == n && db.CheckSearchIndex().Count == 0, "نسخة توحيد مختلفة: الفهرس يُبنى كله عند الفتح", db.Report.SearchBuilt + "/" + n);
        ok(First(Find("الفيزياء الاساسيه", 8), "pb"), "والبحث كما كان بعد البناء");
    }

    /* ---------- الأمر ---------- */

    static Dictionary<string, object> Call(Api api, string cmd, string token, string body, out int status)
    {
        ApiResult r = api.Handle(cmd, token, body);
        status = r.Status;
        return (Dictionary<string, object>)Json.Parse(r.Json);
    }

    static void ApiSearch()
    {
        Api api = new Api(db, null);
        int st;
        string admin = (string)((Dictionary<string, object>)Call(api, "login", null, "{\"login\":\"admin\",\"password\":\"\"}", out st)["data"])["token"];
        Dictionary<string, object> r = Call(api, "search", admin, "{\"q\":\"الفيزياء الاساسيه\"}", out st);
        Dictionary<string, object> d = (Dictionary<string, object>)r["data"];
        List<object> items = (List<object>)d["items"];
        Dictionary<string, object> first = (Dictionary<string, object>)items[0];
        ok((bool)r["ok"] && (string)first["title"] == "الفيزياء الأساسية" && (long)first["qty"] == 2 && (long)first["price"] == 10000 &&
            (long)d["names"] == 1 && (long)d["nearFrom"] == -1, "أمر search: الكتاب نفسه أولاً بسعره وكميته", Json.Write(first));
        r = Call(api, "search", admin, "{\"q\":\"شرلوك\"}", out st);
        d = (Dictionary<string, object>)r["data"];
        ok((long)d["exact"] == 0 && (long)d["nearFrom"] == 0, "أمر search: القريب بعد nearFrom («هل تقصد؟»)", Json.Write(d["nearFrom"]));
        r = Call(api, "items.page", admin, "{\"q\":\"الفيزياء\",\"limit\":2,\"offset\":1}", out st);
        d = (Dictionary<string, object>)r["data"];
        items = (List<object>)d["items"];
        ok((long)d["total"] == 11 && items.Count == 2 && (string)((Dictionary<string, object>)items[0])["title"] == "مسائل محلولة في الفيزياء الأساسية",
            "صفحة الأصناف بالبحث: الترتيب نفسه، صفحة صفحة", Json.Write(d["total"]));
        r = Call(api, "items.page", admin, "{\"q\":\"الفيزياء\",\"cat\":\"العلوم الأساسية\"}", out st);
        d = (Dictionary<string, object>)r["data"];
        ok((long)d["total"] == 1, "صفحة الأصناف بالبحث مع التصنيف", Json.Write(d["total"]));
        Call(api, "user.add", admin, "{\"name\":\"سالم\",\"login\":\"salem\",\"password\":\"123456\"}", out st);
        string salem = (string)((Dictionary<string, object>)Call(api, "login", null, "{\"login\":\"salem\",\"password\":\"123456\"}", out st)["data"])["token"];
        r = Call(api, "search", salem, "{\"q\":\"الفيزياء\"}", out st);
        first = (Dictionary<string, object>)((List<object>)((Dictionary<string, object>)r["data"])["items"])[0];
        ok((bool)r["ok"] && !first.ContainsKey("cost"), "الموظف يبحث، وسعر الشراء لا يصله");
    }

    /* ---------- كل حرف جديد يلغي البحث السابق ---------- */

    static void Cancelling()
    {
        /* مكتبة أكبر: بحث «كل النتائج» بحرف واحد يمر على كل الأصناف ويأخذ وقتاً */
        db.Run("bulk", 1, delegate (Cmd c)
        {
            db.Read<int>(delegate (Sqlite s)
            {
                for (int i = 0; i < 20000; i++)
                    s.Run("INSERT INTO items(kind, code, title, author, created_at, updated_at) VALUES('book', ?, ?, ?, '2026-10-26', '2026-10-26')",
                        "Z" + i, "الكتاب رقم " + i + " في سلسلة المعرفة الأساسية", "مؤلف " + (i % 97));
                return 0;
            });
        });
        string path = db.FilePath;
        db.Dispose();
        db = ShopDb.Open(path, null);
        int cancelled = 0, newerOk = 0, otherOk = 0;
        /* الحرف الجديد يصل والبحث القديم يعمل: انتظار بدقة جزء من الميلي ثانية، لا Thread.Sleep
           (على ويندوز Sleep(3) ينام 15 ms تقريباً، فينتهي البحث القديم قبل أن يبدأ الجديد) */
        for (int round = 0; round < 60 && cancelled == 0; round++)
        {
            SearchResult old = null;
            SearchOptions a = new SearchOptions();
            a.Channel = "pos";
            Thread t = new Thread(delegate () { old = db.SearchItems("ا", a); });
            t.Start();
            System.Diagnostics.Stopwatch wait = System.Diagnostics.Stopwatch.StartNew();
            while (wait.Elapsed.TotalMilliseconds < round * 0.5) Thread.SpinWait(20);
            SearchOptions b = new SearchOptions();
            b.Channel = "pos"; b.Limit = 8;
            SearchResult newer = db.SearchItems("الكتاب رقم 7", b);
            t.Join();
            if (old.Cancelled) cancelled++;
            if (!newer.Cancelled && newer.Ids.Count > 0) newerOk++;
        }
        /* قناة أخرى (جدول الأصناف) لا تُلغى ببحث البيع */
        SearchResult x = null;
        SearchOptions xa = new SearchOptions();
        xa.Channel = "table";
        Thread tx = new Thread(delegate () { x = db.SearchItems("ا", xa); });
        tx.Start();
        Thread.Sleep(3);
        SearchOptions xb = new SearchOptions();
        xb.Channel = "pos"; xb.Limit = 8;
        db.SearchItems("الكتاب رقم 9", xb);
        tx.Join();
        if (!x.Cancelled && x.Ids.Count > 20000) otherOk++;
        ok(cancelled > 0 && newerOk > 0, "حرف جديد يلغي البحث السابق على نفس المربع، والجديد يكتمل", cancelled + "/" + newerOk);
        ok(otherOk == 1, "بحث مربع آخر لا يُلغى", x == null ? "null" : x.Ids.Count.ToString());
        /* صفحة الأصناف بحرف واحد: الصفحة المطلوبة بنفس ترتيب «الكل»، والعدد حتى 1000 */
        long total;
        bool more;
        SearchResult w = db.SearchWindow("ا", new SearchOptions(), 150, out total, out more);
        bool same = w.Ids.Count == 150;
        for (int i = 0; same && i < 150; i++) same = w.Ids[i] == x.Ids[i];
        ok(same && total == 1000 && more, "صفحة الأصناف بحرف واحد: أول 150 كما في الترتيب الكامل، والعدد «أكثر من 1000»", total + "/" + more);
        w = db.SearchWindow("الكتاب رقم 7", new SearchOptions(), 100, out total, out more);
        ok(total == w.Ids.Count && total > 100 && !more, "وبثلاثة أحرف فأكثر: العدد الكامل", total);
        List<string> bad = db.CheckSearchIndex();
        ok(bad.Count == 0, "الفهرس سليم بعد الإلغاء (20 ألف صنف أُضيفت من خارج المحرك وبُني لها عند الفتح)", string.Join("؛ ", bad.ToArray()));
    }
}
