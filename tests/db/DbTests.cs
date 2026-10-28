using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Qirtasiya.Data;

/* ============================================================
   اختبارات قاعدة البيانات (المرحلة 1)
   ------------------------------------------------------------
     DbTests.exe                 كل الاختبارات
     DbTests.exe crash N         اختبار القتل N مرة (Crash.cs)
     DbTests.exe bench DIR       القياس على بيانات المولّد (Bench.cs)
   يُبنى بـ tools/build-dbtests.sh (لينكس) أو tools\build-dbtests.bat
   (ويندوز، بالمترجم المدمج ومكتبة sqlite3.dll التي تُشحن).
   ============================================================ */
static class DbTests
{
    static int pass, fail;
    static readonly List<string> failures = new List<string>();
    static string Root;

    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        string mode = args.Length > 0 ? args[0] : "test";
        if (mode == "crash") return Crash.Parent(args);
        if (mode == "crash-child") return Crash.Child(args);
        if (mode == "bench") return Bench.Run(args);
        if (mode == "import") return ImportTests.Cli(args);

        Root = Path.Combine(Path.GetTempPath(), "qdbtest-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        Directory.CreateDirectory(Root);
        Console.WriteLine("SQLite " + Sqlite.Version + " · " + (IntPtr.Size * 8) + "-bit · " + Root);

        Section("الغلاف", Wrapper);
        Section("JSON", JsonTests);
        Section("الفتح والترقيات", OpenAndMigrate);
        Section("الملف التالف والأحدث والغريب", BadFiles);
        Section("الأماكن والأصناف", PlacesAndItems);
        Section("الكميات", Stock);
        Section("البيع", Sales);
        Section("الإرجاع (حالات 3.x)", Returns);
        Section("تعديل الفاتورة وحذفها", EditDelete);
        Section("الزبائن والديون", Customers);
        Section("إدخال البضاعة", Receive);
        Section("الكتب على المباع", Consign);
        Section("الجرد", Counts);
        Section("المستخدمون", Users);
        Section("كاملة أو لا شيء", Atomic);
        Section("سجل التغييرات كامل", ReplayEqual);
        Section("الفحص الكامل والنسخة", CheckAndBackup);
        Section("نقل بيانات 3.x", delegate { ImportTests.Run(Ok); });
        Section("أوامر المحرك والصلاحيات", delegate { ApiTests.Run(Ok); });
        Section("البحث بالاسم", delegate { SearchTests.Run(Ok); });
        Section("بيانات التجربة (قرار 0021)", Demo);
        Section("المزامنة بين الأجهزة والفروع (قرار 0023)", delegate { SyncTests.Run(Ok); });
        Section("شاشات المحل: الجرد وإقفال اليوم، الزبائن، الإرجاع", delegate { ShopTests.Run(Ok); });
        Section("واجهة 3.x فوق الأساس الجديد (قرار 0025)", delegate { X3Tests.Run(Ok); });

        Console.WriteLine();
        Console.WriteLine("==================================================");
        Console.WriteLine("  نجح: " + pass + "    فشل: " + fail);
        Console.WriteLine("==================================================");
        foreach (string f in failures) Console.WriteLine("  ✗ " + f);
        if (fail == 0) { try { Directory.Delete(Root, true); } catch { } }
        return fail == 0 ? 0 : 1;
    }

    /* ---------- أدوات ---------- */

    static void Section(string name, Action body)
    {
        Console.WriteLine();
        Console.WriteLine("== " + name + " ==");
        try { body(); }
        catch (Exception e)
        {
            fail++;
            failures.Add(name + ": استثناء " + e.GetType().Name + ": " + e.Message);
            Console.WriteLine("  FAIL  استثناء غير متوقع: " + e);
        }
    }

    static void Ok(bool cond, string name, object detail = null)
    {
        if (cond) { pass++; Console.WriteLine("  PASS  " + name); }
        else
        {
            fail++;
            string d = detail == null ? "" : " — " + detail;
            failures.Add(name + d);
            Console.WriteLine("  FAIL  " + name + d);
        }
    }

    static void Eq(object want, object got, string name)
    {
        bool same = object.Equals(want, got) ||
            (want is int && got is long && (long)(int)want == (long)got) ||
            (want is long && got is int && (long)want == (long)(int)got);
        Ok(same, name, "المتوقع " + Show(want) + " والناتج " + Show(got));
    }

    static string Show(object v) { return v == null ? "null" : v.ToString(); }

    static void Throws(Action a, string contains, string name)
    {
        try
        {
            a();
            Ok(false, name, "لم يُرفض");
        }
        catch (ShopException e) { Ok(contains == null || e.Message.Contains(contains), name, e.Message); }
        catch (Exception e) { Ok(false, name, "استثناء من نوع آخر " + e.GetType().Name + ": " + e.Message); }
    }

    sealed class Clock
    {
        public DateTime T = new DateTime(2026, 10, 26, 9, 0, 0);
        public DateTime Now() { T = T.AddSeconds(1); return T; }
    }

    static int seq;
    static string NewPath() { return Path.Combine(Root, "t" + (++seq) + ".db"); }

    static ShopDb Fresh(Clock clk)
    {
        OpenOptions o = new OpenOptions();
        o.Clock = clk.Now;
        return ShopDb.Open(NewPath(), o);
    }

    static ShopDb Fresh() { return Fresh(new Clock()); }

    static long L(ShopDb d, string sql, params object[] args)
    {
        return d.Read<long>(delegate (Sqlite c) { return c.Long(sql, 0, args); });
    }

    static string S(ShopDb d, string sql, params object[] args)
    {
        return d.Read<string>(delegate (Sqlite c) { return c.Text(sql, args); });
    }

    static long Book(ShopDb d, string title, long price, long cost, long qty, long place)
    {
        ItemInput i = new ItemInput();
        i.Title = title; i.Price = price; i.Cost = cost;
        if (place > 0) i.HomePlaceId = place;
        return d.AddItem(i, qty, 0, 1);
    }

    static SaleInput Sale(params SaleLine[] lines)
    {
        SaleInput s = new SaleInput();
        s.Lines.AddRange(lines);
        return s;
    }

    static long D(double dinars) { return (long)Math.Round(dinars * 1000); }

    /* ---------- الغلاف ---------- */

    static void Wrapper()
    {
        Ok(Sqlite.VersionNumber >= ShopDb.MinSqlite, "نسخة SQLite 3.38 أو أحدث", Sqlite.Version);
        using (Sqlite c = Sqlite.Open(NewPath(), false, true))
        {
            c.Exec("CREATE TABLE t(id INTEGER PRIMARY KEY, s TEXT, n INTEGER, r REAL, b BLOB); CREATE TABLE u(x INTEGER NOT NULL UNIQUE);");
            string ar = "فيزياء أساسية — الجزء التاني «د. أشرف» 😀";
            long id = c.Insert("INSERT INTO t(s, n, r, b) VALUES(?, ?, ?, ?)", ar, long.MaxValue, 1.5, new byte[] { 1, 2, 3 });
            Eq(ar, c.Text("SELECT s FROM t WHERE id = ?", id), "نص عربي يرجع كما كُتب (UTF-8)");
            Eq(long.MaxValue, c.Long("SELECT n FROM t WHERE id = ?", 0, id), "أكبر عدد صحيح");
            c.Run("INSERT INTO t(s) VALUES('')");
            Eq(1L, c.Long("SELECT COUNT(*) FROM t WHERE s = '' AND s IS NOT NULL", 0), "النص الفارغ يبقى فارغاً لا NULL");
            c.Run("INSERT INTO t(s) VALUES(?)", (object)null);
            Eq(1L, c.Long("SELECT COUNT(*) FROM t WHERE s IS NULL", 0), "و null يُخزَّن NULL");
            List<object[]> rows = c.Rows("SELECT r, b FROM t WHERE id = ?", id);
            Ok(rows.Count == 1 && (double)rows[0][0] == 1.5 && ((byte[])rows[0][1]).Length == 3, "الكسر والبيانات الثنائية");
            c.Run("INSERT INTO u(x) VALUES(1)");
            try { c.Run("INSERT INTO u(x) VALUES(1)"); Ok(false, "قيد الفريد يُرفض"); }
            catch (SqliteException e) { Ok(e.Primary == 19 && e.Message.Contains("UNIQUE"), "قيد الفريد يُرفض برمزه ورسالته", e.Message); }
            try { c.Prepare("SELEC 1"); Ok(false, "خطأ الكتابة يُرفض"); }
            catch (SqliteException e) { Ok(e.Message.Contains("syntax"), "خطأ في SQL يُرفض برسالة واضحة", e.Message); }
            Eq("{\"a\":1}", c.Text("SELECT json_object('a', 1)"), "دوال JSON موجودة");
            string dir = Path.Combine(Root, "مجلد عربي");
            Directory.CreateDirectory(dir);
            using (Sqlite c2 = Sqlite.Open(Path.Combine(dir, "بيانات.db"), false, true))
            {
                c2.Exec("CREATE TABLE x(a)");
                Ok(File.Exists(Path.Combine(dir, "بيانات.db")), "مسار عربي للملف");
            }
        }
    }

    static void JsonTests()
    {
        string src = "{\"a\":\"نص \\\"مقتبس\\\" \\n سطر\",\"n\":-12,\"f\":1.25,\"t\":true,\"z\":null,\"l\":[1,\"x\",{\"k\":[]}],\"u\":\"\\u0628\"}";
        Dictionary<string, object> o = (Dictionary<string, object>)Json.Parse(src);
        Eq("نص \"مقتبس\" \n سطر", o["a"], "نص بهروب");
        Eq(-12L, o["n"], "عدد صحيح سالب ← long");
        Eq(1.25, o["f"], "كسر ← double");
        Eq(true, o["t"], "منطقي");
        Ok(o.ContainsKey("z") && o["z"] == null, "null");
        Eq(3, ((List<object>)o["l"]).Count, "مصفوفة متداخلة");
        Eq("ب", o["u"], "\\u");
        Eq(src.Replace("\\u0628", "ب"), Json.Write(o), "الكتابة تعيد النص نفسه");
        try { Json.Parse("{\"a\":1,}"); Ok(false, "JSON معطوب يُرفض"); }
        catch (FormatException) { Ok(true, "JSON معطوب يُرفض"); }
    }

    /* ---------- الفتح والترقيات ---------- */

    static void OpenAndMigrate()
    {
        Clock clk = new Clock();
        string path = NewPath();
        OpenOptions o = new OpenOptions();
        o.Clock = clk.Now;
        ShopDb d = ShopDb.Open(path, o);
        int n = Schema.All().Count;
        Ok(d.Report.Created && d.Report.VersionNow == n && d.Report.Upgrades.Count == n, "قاعدة جديدة: كل الترقيات (" + n + ")", string.Join(",", d.Report.Upgrades.ToArray()));
        Eq("wal", S(d, "PRAGMA journal_mode"), "وضع WAL");
        Eq(2L, L(d, "PRAGMA synchronous"), "الحفظ الكامل على القرص (FULL)");
        Eq(1L, L(d, "PRAGMA foreign_keys"), "المفاتيح مفعّلة");
        Eq((long)Schema.AppId, L(d, "PRAGMA application_id"), "علامة ملف المنظومة");
        Eq("المحل", S(d, "SELECT name FROM places WHERE id = 1"), "المكان الأول: المحل");
        Eq("admin", S(d, "SELECT login FROM users WHERE id = 1"), "المدير الافتراضي");
        long logged = d.Read<long>(delegate (Sqlite c) { return Schema.LoggedTables(c).Count; });
        Eq(logged * 3, L(d, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'log%'"), "ثلاثة مُطلِقات لكل جدول مسجَّل");
        Eq(0L, L(d, "SELECT COUNT(*) FROM change_log WHERE op_id NOT IN (SELECT id FROM ops WHERE kind = 'migrate')"), "بذور الترقيات مسجّلة باسم أوامر الترقية");
        Eq("migrate", S(d, "SELECT kind FROM ops WHERE id = 1"), "والترقية في سجل العمليات");
        d.Dispose();

        d = ShopDb.Open(path, o);
        Ok(!d.Report.Created && d.Report.VersionBefore == n && d.Report.Upgrades.Count == 0 && d.Report.Check == "ok",
            "إعادة الفتح: لا ترقية، والفحص سليم", d.Report.Check);
        long book = Book(d, "كتاب قبل الترقية", D(10), D(6), 3, 0);
        d.Dispose();

        /* ترقية قادمة تجريبية: عمود جديد وتحويل بيانات */
        List<Migration> two = Schema.All();
        two.Add(new Migration(n + 1, "عمود تجربة", "ALTER TABLE items ADD COLUMN shelf_note TEXT NOT NULL DEFAULT '';",
            delegate (Sqlite c, string at) { c.Run("UPDATE items SET shelf_note = 'منقول'"); }));
        OpenOptions o2 = new OpenOptions();
        o2.Clock = clk.Now;
        o2.Migrations = two;
        d = ShopDb.Open(path, o2);
        Ok(d.Report.VersionBefore == n && d.Report.VersionNow == n + 1, "الترقية التجريبية طُبّقت");
        Ok(File.Exists(d.Report.BackupFile), "نسخة احتياطية قبل الترقية", d.Report.BackupFile);
        using (Sqlite b = Sqlite.Open(d.Report.BackupFile, true, false))
        {
            Eq((long)n, b.Long("PRAGMA user_version", 0), "النسخة على الترقية السابقة");
            Eq(1L, b.Long("SELECT COUNT(*) FROM items", 0), "وفيها الكتاب");
        }
        Eq("منقول", S(d, "SELECT shelf_note FROM items WHERE id = ?", book), "تحويل البيانات في الترقية");
        Book(d, "كتاب بعد الترقية", D(5), D(3), 1, 0);
        Ok((S(d, "SELECT data FROM change_log WHERE tbl = 'items' ORDER BY seq DESC LIMIT 1") ?? "").Contains("shelf_note"),
            "المُطلِقات تعرف العمود الجديد");
        d.Dispose();

        /* ترقية فاشلة: لا يتغيّر شيء، والنسخة موجودة */
        List<Migration> three = new List<Migration>(two);
        three.Add(new Migration(n + 2, "ترقية معطوبة", "ALTER TABLE items ADD COLUMN x INTEGER; SELECT * FROM جدول_غير_موجود;", null));
        OpenOptions o3 = new OpenOptions();
        o3.Clock = clk.Now;
        o3.Migrations = three;
        try { ShopDb.Open(path, o3).Dispose(); Ok(false, "الترقية المعطوبة تُرفض"); }
        catch (SqliteException) { Ok(true, "الترقية المعطوبة تُرفض"); }
        d = ShopDb.Open(path, o2);
        Ok(d.Report.VersionBefore == n + 1 && d.Report.Check == "ok", "والقاعدة باقية على الترقية السابقة سليمة");
        Eq(0L, L(d, "SELECT COUNT(*) FROM pragma_table_info('items') WHERE name = 'x'"), "ولا أثر لنصف الترقية");
        Eq(2, Directory.GetFiles(Path.Combine(Root, "backups"), "qirtasiya-before-v*.db").Length, "نسخة لكل محاولة ترقية");
        d.Dispose();
    }

    static void BadFiles()
    {
        string other = NewPath();
        using (Sqlite c = Sqlite.Open(other, false, true)) c.Exec("CREATE TABLE notes(a TEXT); INSERT INTO notes VALUES('x');");
        Throws(delegate { ShopDb.Open(other, null).Dispose(); }, "ليس قاعدة بيانات المنظومة", "ملف SQLite غريب يُرفض");

        string newer = NewPath();
        ShopDb d = ShopDb.Open(newer, null);
        d.Dispose();
        using (Sqlite c = Sqlite.Open(newer, false, false)) c.Exec("PRAGMA user_version = 99");
        d = ShopDb.Open(newer, null);
        Ok(d.ReadOnly && d.Report.ReadOnlyReason.Contains("أحدث"), "بيانات من نسخة أحدث: قراءة فقط", d.Report.ReadOnlyReason);
        Throws(delegate { Book(d, "x", 1, 0, 0, 0); }, "لا يمكن الحفظ", "ولا كتابة عليها");
        d.Dispose();

        /* ملف تالف: صفحات من وسطه تُكتب فوقها بيانات عشوائية */
        string bad = NewPath();
        d = ShopDb.Open(bad, null);
        for (int i = 0; i < 300; i++) Book(d, "كتاب رقم " + i + " بعنوان طويل نسبياً ليملأ الصفحات", D(10), D(5), 1, 0);
        d.Read<int>(delegate (Sqlite c) { c.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); return 0; });
        d.Dispose();
        long size = new FileInfo(bad).Length;
        using (FileStream f = new FileStream(bad, FileMode.Open, FileAccess.Write))
        {
            Random r = new Random(7);
            byte[] junk = new byte[4096 * 3];
            r.NextBytes(junk);
            f.Position = (size / 4096 / 2) * 4096;
            f.Write(junk, 0, junk.Length);
        }
        try
        {
            d = ShopDb.Open(bad, null);
            Ok(d.Report.Check != "ok" && d.ReadOnly, "الملف التالف يُكتشف عند الفتح ويُفتح للقراءة فقط", d.Report.Check);
            d.Dispose();
        }
        catch (SqliteException e) { Ok(e.Primary == 11 || e.Primary == 26, "الملف التالف يُكتشف عند الفتح", e.Message); }
    }

    /* ---------- الأماكن والأصناف ---------- */

    static void PlacesAndItems()
    {
        ShopDb d = Fresh();
        long floor = d.AddPlace(0, "floor", "الطابق الأول", "ط1", 1);
        long sec = d.AddPlace(floor, "section", "قانون", "قانون", 1);
        long cab = d.AddPlace(sec, "cabinet", "خزانة C", "C", 1);
        long shelf = d.AddPlace(cab, "shelf", "رف 4", "4", 1);
        long store = d.AddPlace(0, "store", "المخزن الأول", "م1", 1);
        Ok(shelf > 0 && store > 0, "شجرة أماكن: طابق ← قسم ← خزانة ← رف، ومخزن");
        Throws(delegate { d.AddPlace(0, "planet", "x", "", 1); }, "نوع مكان", "نوع مكان غير معروف يُرفض");

        ItemInput b = new ItemInput();
        b.Title = "  مبادئ القانون المدني  "; b.Author = "د. سالم"; b.Barcode = "9789953000001";
        b.Price = D(45); b.PriceW = D(40); b.Cost = D(30); b.HomePlaceId = shelf; b.Cat = "قانون";
        long id = d.AddItem(b, 5, 0, 1);
        ItemRow it = d.GetItem(id);
        Ok(it.Code == "K0001" && it.Title == "مبادئ القانون المدني", "كتاب جديد: رمز K0001 والاسم بلا فراغات زائدة", it.Code);
        Eq(45000L, it.Price, "السعر بالدرهم");
        Eq(5L, d.StockOf(id)[shelf], "الكمية على رفه");

        ItemInput s = new ItemInput();
        s.Kind = "stat"; s.Title = "قلم أزرق"; s.Price = D(0.75); s.Unit = "قطعة";
        long sid = d.AddItem(s, 100, 0, 1);
        Eq("Q0001", d.GetItem(sid).Code, "قرطاسية: رمز Q0001");

        ItemInput dup = new ItemInput();
        dup.Title = "كتاب آخر"; dup.Barcode = "9789953000001";
        Throws(delegate { d.AddItem(dup, 0, 0, 1); }, "مبادئ القانون المدني", "الباركود المكرر يُرفض ويذكر صاحبه");
        ItemInput neg = new ItemInput();
        neg.Title = "سالب"; neg.Price = -1;
        Throws(delegate { d.AddItem(neg, 0, 0, 1); }, "سالبة", "السعر السالب يُرفض");
        ItemInput code = new ItemInput();
        code.Title = "رمز مكرر"; code.Code = "k0001";
        Throws(delegate { d.AddItem(code, 0, 0, 1); }, "مستعمل", "الرمز المكرر يُرفض (بلا فرق بين الحروف)");

        b.Price = D(50); b.Title = "مبادئ القانون المدني — طبعة 2";
        d.UpdateItem(id, b, 1);
        Eq(50000L, d.GetItem(id).Price, "التعديل يحفظ السعر الجديد");
        Ok((S(d, "SELECT before FROM ops WHERE kind = 'item-edit'") ?? "").Contains("45000") &&
           (S(d, "SELECT after FROM ops WHERE kind = 'item-edit'") ?? "").Contains("50000"), "والسجل يحفظ السعر قبل وبعد");

        Throws(delegate { d.DeletePlace(shelf, 1); }, "بضاعة", "مكان فيه بضاعة لا يُحذف");
        Throws(delegate { d.DeletePlace(cab, 1); }, "أماكن أخرى", "مكان تحته أماكن لا يُحذف");
        Throws(delegate { d.DeletePlace(1, 1); }, "لا يُحذف", "المحل نفسه لا يُحذف");
        d.DeletePlace(store, 1);
        Eq(0L, L(d, "SELECT active FROM places WHERE id = ?", store), "المخزن الفارغ يُحذف");

        d.DeleteItem(id, 1);
        Ok(!d.GetItem(id).Active && d.FindByBarcode("9789953000001") == null, "حذف الصنف يُخفيه");
        dup.Title = "صنف جديد بالباركود نفسه";
        Ok(d.AddItem(dup, 0, 0, 1) > 0, "وباركوده يصير متاحاً لغيره");
        Ok(d.FindByCode("k0001") != null, "البحث بالرمز بلا فرق بين الحروف");

        d.SetCategories("book", new string[] { "قانون", "طب", "قانون", " " }, 1);
        Eq("قانون,طب", string.Join(",", d.Categories("book").ToArray()), "قائمة التصنيفات بلا تكرار ولا فراغ");
        long pub = d.SavePublisher(0, "دار المعرفة", 2000, "", "", 1);
        Throws(delegate { d.SavePublisher(0, "دار المعرفة", 1000, "", "", 1); }, "موجودة", "دار النشر المكررة تُرفض");
        Eq(2000L, L(d, "SELECT rate_bp FROM publishers WHERE id = ?", pub), "خصم الجملة 20%");
        d.SetSetting("shopName", "مكتبة تجربة", 1);
        Eq("مكتبة تجربة", d.GetSetting("shopName"), "الإعدادات");
        d.Dispose();
    }

    /* ---------- الكميات ---------- */

    static void Stock()
    {
        ShopDb d = Fresh();
        long shelf = d.AddPlace(0, "shelf", "رف 1", "1", 1);
        long room = d.AddPlace(0, "room", "غرفة الخزين", "", 1);
        long store = d.AddPlace(0, "store", "المخزن", "", 1);
        long id = Book(d, "كتاب", D(10), D(6), 4, shelf);
        d.AdjustStock(id, store, 10, "", 1);
        Eq(4L, d.ShopQty(id), "كمية المحل لا تحسب المخزن");
        Throws(delegate { d.AdjustStock(id, shelf, -5, "", 1); }, "لا تكفي", "الإنقاص اليدوي لا يجعلها سالبة");
        Eq(3L, d.MoveStock(id, store, room, 3, 1), "نقل 3 من المخزن للغرفة");
        Eq(7L, d.MoveStock(id, store, shelf, 20, 1), "النقل لا يتجاوز الموجود (7 لا 20)");
        Throws(delegate { d.MoveStock(id, store, shelf, 1, 1); }, "لا توجد كمية", "النقل من مكان فارغ يُرفض");
        Dictionary<long, long> st = d.StockOf(id);
        Ok(st[shelf] == 11 && st[room] == 3 && st[store] == 0, "الأرصدة بعد النقل: رف 11، غرفة 3، مخزن 0", Json.Write(st.Values));
        Eq(0, d.FullCheck().Count, "كل رصيد = مجموع حركاته");
        d.Dispose();
    }

    /* ---------- البيع ---------- */

    static void Sales()
    {
        ShopDb d = Fresh();
        long home = d.AddPlace(0, "shelf", "رف 1", "1", 1);
        long other = d.AddPlace(0, "shelf", "رف 2", "2", 1);
        long room = d.AddPlace(0, "room", "غرفة الخزين", "", 1);
        long store = d.AddPlace(0, "store", "المخزن", "", 1);
        long a = Book(d, "الفيزياء الأساسية", D(50), D(30), 10, home);
        long b = Book(d, "تاريخ ليبيا", D(20), D(12), 5, home);
        long seq0 = L(d, "SELECT MAX(seq) FROM change_log");

        InvoiceResult r = d.Sell(Sale(new SaleLine(a, 2, D(50)), new SaleLine(b, 1, D(20))), 1);
        InvoiceRow v = d.GetInvoice(r.Id);
        Ok(r.No == 1 && v.Subtotal == D(120) && v.Total == D(120) && v.Profit == D(120 - 72), "بيع نقدي: المجموع والربح", v.Profit);
        Ok(v.Method == "cash" && v.Paid == v.Total && v.Due == 0 && v.CustomerId == 0, "النقدي مدفوع كله وبلا زبون");
        Ok(d.StockOf(a)[home] == 8 && d.StockOf(b)[home] == 4, "الكمية نقصت من رف الكتاب");
        ItemRow ia = d.GetItem(a);
        Ok(ia.SoldTotal == 2 && ia.LastSold == "2026-10-26", "آخر بيع ومجموع المبيع على الصنف");
        Eq(2, v.Lines.Count, "سطران في الفاتورة");
        Eq("الفيزياء الأساسية", v.Lines[0].Name, "اسم الصنف محفوظ في السطر");
        Eq(D(30), v.Lines[0].Cost, "وسعر شرائه وقت البيع");
        string tables = S(d, "SELECT group_concat(DISTINCT tbl) FROM (SELECT tbl FROM change_log WHERE seq > ? ORDER BY tbl)", seq0);
        Ok(tables.Contains("invoices") && tables.Contains("invoice_lines") && tables.Contains("item_stock") &&
           tables.Contains("stock_moves") && tables.Contains("items") && tables.Contains("counters") && tables.Contains("ops"),
           "البيعة في سجل التغييرات كاملة", tables);
        Ok((S(d, "SELECT detail FROM ops WHERE kind = 'sale'") ?? "").Contains("فاتورة 1 بقيمة 120"), "وفي سجل العمليات");

        /* ترتيب الإنقاص: رف الكتاب، ثم بقية الرفوف، ثم الغرفة، ولا يُمسّ المخزن */
        long c = Book(d, "كتاب في أماكن كثيرة", D(10), D(5), 2, home);
        d.AdjustStock(c, other, 3, "", 1);
        d.AdjustStock(c, room, 4, "", 1);
        d.AdjustStock(c, store, 10, "", 1);
        r = d.Sell(Sale(new SaleLine(c, 6, D(10))), 1);
        Dictionary<long, long> st = d.StockOf(c);
        Ok(st[home] == 0 && st[other] == 0 && st[room] == 3 && st[store] == 10, "6 نسخ: رفه 2 ثم الرف الآخر 3 ثم الغرفة 1", Json.Write(st.Values));
        Ok(r.FromRoom.Count == 1 && r.FromRoom[0].EndsWith("× 1"), "وينبّه أن نسخة أُخذت من غرفة الخزين");
        d.Sell(Sale(new SaleLine(c, 10, D(10))), 1);
        st = d.StockOf(c);
        Ok(st[room] == 0 && st[home] == -7 && st[store] == 10, "البيع فوق الموجود يُسجَّل سالباً على رف الكتاب، والمخزن كما هو");

        /* الخصم لا يتجاوز المجموع */
        r = d.Sell(Sale(new SaleLine(b, 1, D(20))), 1);
        SaleInput big = Sale(new SaleLine(b, 1, D(30)));
        big.Discount = D(500);
        r = d.Sell(big, 1);
        v = d.GetInvoice(r.Id);
        Ok(v.Discount == D(30) && v.Total == 0 && v.Profit == D(30 - 12) - D(30), "خصم 500 على 30: الصافي 0 والربح −التكلفة لا −470");

        SaleInput cr = Sale(new SaleLine(a, 1, D(50)));
        cr.Method = "credit";
        Throws(delegate { d.Sell(cr, 1); }, "اختر الزبون", "الآجل بلا زبون يُرفض");
        long cu = d.AddCustomer("أحمد", "0911111111", "", false, 0, 1);
        cr.CustomerId = cu; cr.Paid = D(80);
        r = d.Sell(cr, 1);
        v = d.GetInvoice(r.Id);
        Ok(v.Paid == D(50) && v.Due == 0, "المدفوع في الآجل لا يتجاوز الفاتورة");
        cr.Paid = D(20);
        r = d.Sell(cr, 1);
        Eq(D(30), d.GetCustomer(cu).Balance, "الباقي من الآجل يُضاف لدين الزبون");

        /* طلب التلفون نفسه مرتين = فاتورة واحدة */
        SaleInput ph = Sale(new SaleLine(b, 1, D(20)));
        ph.Source = "phone"; ph.PhoneId = "ph-123"; ph.Device = "تلفون أحمد";
        InvoiceResult p1 = d.Sell(ph, 1);
        InvoiceResult p2 = d.Sell(ph, 1);
        Ok(!p1.Duplicate && p2.Duplicate && p1.Id == p2.Id, "طلب التلفون المكرر لا يُسجَّل مرتين");
        Eq(1L, L(d, "SELECT COUNT(*) FROM invoices WHERE phone_id = 'ph-123'"), "فاتورة واحدة للطلب");

        Throws(delegate { d.Sell(Sale(), 1); }, "فارغة", "الفاتورة الفارغة تُرفض");
        Throws(delegate { d.Sell(Sale(new SaleLine(a, 0, D(50))), 1); }, "الكمية", "الكمية صفر تُرفض");
        d.DeleteItem(b, 1);
        Throws(delegate { d.Sell(Sale(new SaleLine(b, 1, D(20))), 1); }, "غير موجود", "الصنف المحذوف لا يُباع");
        Eq(0, d.FullCheck().Count, "الفحص الكامل سليم بعد البيع");
        d.Dispose();
    }

    /* ---------- الإرجاع (حالات test-money.js في 3.x) ---------- */

    static void Returns()
    {
        ShopDb d = Fresh();
        long a = Book(d, "كتاب 50", D(50), D(30), 10, 0);

        /* [١] بيع 2×50 بخصم 20 = 80، وإرجاع الكل يردّ 80 لا 100 */
        SaleInput s = Sale(new SaleLine(a, 2, D(50)));
        s.Discount = D(20);
        InvoiceResult r = d.Sell(s, 1);
        InvoiceRow v = d.GetInvoice(r.Id);
        InvoiceResult back = d.Return(v.Id, new ReturnLine[] { new ReturnLine(v.Lines[0].Id, 2) }, "", 1);
        Ok(back.CashBack == D(80) && back.Total == -D(80), "إرجاع الكل يردّ 80 (ما دفعه الزبون) لا 100", back.CashBack);
        Eq(0L, L(d, "SELECT SUM(total) FROM invoices"), "صافي المبيعات بعد إرجاع كامل = 0");
        Eq(10L, d.ShopQty(a), "والكمية عادت 10");

        /* [٢] لا يُرجَع أكثر مما بِيع */
        r = d.Sell(Sale(new SaleLine(a, 2, D(50))), 1);
        v = d.GetInvoice(r.Id);
        d.Return(v.Id, new ReturnLine[] { new ReturnLine(v.Lines[0].Id, 2) }, "", 1);
        Throws(delegate { d.Return(v.Id, new ReturnLine[] { new ReturnLine(v.Lines[0].Id, 2) }, "", 1); }, "أُرجع كل", "الإرجاع الثاني للفاتورة نفسها يُرفض");
        Eq(10L, d.ShopQty(a), "المخزون لا يتجاوز ما كان (10)");
        r = d.Sell(Sale(new SaleLine(a, 3, D(50))), 1);
        v = d.GetInvoice(r.Id);
        back = d.Return(v.Id, new ReturnLine[] { new ReturnLine(v.Lines[0].Id, 2), new ReturnLine(v.Lines[0].Id, 5) }, "", 1);
        Eq(D(150), back.CashBack, "طلبان على السطر نفسه في إرجاع واحد لا يتجاوزان المبيع (3)");

        /* [٦] إرجاع من آجل: يُنقص الدين ولا يخرج نقد */
        long cu = d.AddCustomer("زبون آجل", "", "", false, 0, 1);
        s = Sale(new SaleLine(a, 2, D(50)));
        s.Method = "credit"; s.CustomerId = cu;
        r = d.Sell(s, 1);
        v = d.GetInvoice(r.Id);
        back = d.Return(v.Id, new ReturnLine[] { new ReturnLine(v.Lines[0].Id, 1) }, "", 1);
        Ok(d.GetCustomer(cu).Balance == D(50) && back.CashBack == 0 && back.DebtCut == D(50), "إرجاع قطعة من دين 100 يترك 50 ولا نقد يخرج");

        /* [٩] آجل مدفوع جزئياً، ثم سُدّد الدين كله، ثم إرجاع ⇦ يُردّ نقداً */
        long cu2 = d.AddCustomer("زبون سدّد", "", "", false, 0, 1);
        s = Sale(new SaleLine(a, 2, D(50)));
        s.Method = "credit"; s.CustomerId = cu2; s.Paid = D(50);
        r = d.Sell(s, 1);
        d.Pay(cu2, D(50), "", "", 1);
        v = d.GetInvoice(r.Id);
        back = d.Return(v.Id, new ReturnLine[] { new ReturnLine(v.Lines[0].Id, 1) }, "", 1);
        Ok(back.CashBack == D(50) && back.DebtCut == 0 && d.GetCustomer(cu2).Balance == 0, "لا دين ليُنقص ⇦ يُردّ نقداً 50");

        Throws(delegate { d.Return(back.Id, new ReturnLine[] { new ReturnLine(1, 1) }, "", 1); }, "إرجاع", "لا إرجاع من عملية إرجاع");
        /* نصف درهم يُقرَّب للأعلى: 3 قطع × 1.001 بخصم 0.001 */
        long tiny = Book(d, "صغير", 1001, 0, 10, 0);
        s = Sale(new SaleLine(tiny, 2, 1001));
        s.Discount = 1;
        r = d.Sell(s, 1);
        v = d.GetInvoice(r.Id);
        back = d.Return(v.Id, new ReturnLine[] { new ReturnLine(v.Lines[0].Id, 1) }, "", 1);
        Eq(1001L, back.CashBack, "تقريب نصف الدرهم للأعلى (1000.5 ⇦ 1001)");
        Eq(0, d.FullCheck().Count, "الفحص الكامل سليم");
        d.Dispose();
    }

    /* ---------- تعديل الفاتورة وحذفها ---------- */

    static void EditDelete()
    {
        ShopDb d = Fresh();
        long a = Book(d, "أ", D(50), D(30), 10, 0);
        long b = Book(d, "ب", D(20), D(10), 10, 0);
        long cu = d.AddCustomer("زبون", "", "", false, 0, 1);

        InvoiceResult r = d.Sell(Sale(new SaleLine(a, 3, D(50))), 1);
        InvoiceResult e = d.EditInvoice(r.Id, new SaleLine[] { new SaleLine(a, 1, D(50)), new SaleLine(b, 2, D(20)) }, 0, "cash", 0, 0, true, 1);
        InvoiceRow v = d.GetInvoice(r.Id);
        Ok(v.Total == D(90) && v.Lines.Count == 2 && v.EditedAt.Length > 0, "تعديل: قطعة من أ وقطعتان من ب = 90");
        Ok(d.ShopQty(a) == 9 && d.ShopQty(b) == 8, "فرق الكميات عاد للمخزون وخرج للجديد");
        Eq(D(30), v.Lines[0].Cost, "سعر الشراء للسطر القديم كما كان");

        /* الآجل: أثر الدين فرق واحد، وزبون سدّد ثم نقصت فاتورته يأخذ الزيادة */
        SaleInput s = Sale(new SaleLine(a, 2, D(50)));
        s.Method = "credit"; s.CustomerId = cu;
        r = d.Sell(s, 1);
        Eq(D(100), d.GetCustomer(cu).Balance, "دين 100");
        d.Pay(cu, D(100), "", "", 1);
        e = d.EditInvoice(r.Id, new SaleLine[] { new SaleLine(a, 1, D(50)) }, 0, "credit", cu, 0, true, 1);
        Ok(d.GetCustomer(cu).Balance == 0 && e.Over == D(50), "سدّد 100 ثم صارت الفاتورة 50: رصيده 0 وله 50", e.Over);

        r = d.Sell(Sale(new SaleLine(b, 1, D(20))), 1);
        e = d.EditInvoice(r.Id, new SaleLine[] { new SaleLine(b, 1, D(20)) }, 0, "credit", cu, 5000, true, 1);
        Eq(D(15), d.GetCustomer(cu).Balance, "تحويل نقدي إلى آجل لزبون يضيف الباقي لدينه");

        Throws(delegate { d.EditInvoice(r.Id, new SaleLine[0], 0, "cash", 0, 0, true, 1); }, "فارغة", "لا تُترك الفاتورة فارغة");
        InvoiceRow rv = d.GetInvoice(r.Id);
        InvoiceResult ret = d.Return(rv.Id, new ReturnLine[] { new ReturnLine(rv.Lines[0].Id, 1) }, "", 1);
        Throws(delegate { d.EditInvoice(r.Id, new SaleLine[] { new SaleLine(b, 1, D(20)) }, 0, "cash", 0, 0, true, 1); }, "إرجاع", "فاتورة عليها إرجاع لا تُعدَّل");
        Throws(delegate { d.EditInvoice(ret.Id, new SaleLine[] { new SaleLine(b, 1, D(20)) }, 0, "cash", 0, 0, true, 1); }, "لا تُعدَّل", "عملية الإرجاع لا تُعدَّل");
        Throws(delegate { d.DeleteInvoice(r.Id, true, "", 1); }, "إرجاع", "فاتورة عليها إرجاع لا تُحذف قبله");

        long bBefore = d.ShopQty(b), debtBefore = d.GetCustomer(cu).Balance;
        d.DeleteInvoice(ret.Id, true, "تجربة", 1);
        Ok(d.ShopQty(b) == bBefore - 1 && d.GetCustomer(cu).Balance == debtBefore + d.GetInvoice(ret.Id).DebtCut,
            "حذف الإرجاع: يخرج ما أُعيد، ويعود ما أُنقص من الدين");
        d.DeleteInvoice(r.Id, true, "خطأ", 1);
        v = d.GetInvoice(r.Id);
        Ok(v.Deleted && v.DeleteReason == "خطأ" && d.ShopQty(b) == bBefore, "حذف البيع: علامة الحذف وسببه، والكمية عادت");
        Eq(0L, d.GetCustomer(cu).Balance - (debtBefore + d.GetInvoice(ret.Id).DebtCut - D(15)), "ودينه نقص بقيمة الفاتورة");
        long no = r.No;
        InvoiceResult next = d.Sell(Sale(new SaleLine(b, 1, D(20))), 1);
        Ok(next.No > ret.No && d.GetInvoiceByNo(no) != null, "رقم الفاتورة المحذوفة لا يُعاد استعماله");
        Throws(delegate { d.DeleteInvoice(r.Id, true, "", 1); }, "غير موجودة", "المحذوفة لا تُحذف مرتين");

        /* إرجاع حُذف ثم عُدّلت فاتورته: تنقطع إشارة سطره، ويُسجَّل ذلك في سجل التغييرات */
        r = d.Sell(Sale(new SaleLine(a, 2, D(50))), 1);
        InvoiceRow rv2 = d.GetInvoice(r.Id);
        InvoiceResult ret2 = d.Return(r.Id, new ReturnLine[] { new ReturnLine(rv2.Lines[0].Id, 1) }, "", 1);
        d.DeleteInvoice(ret2.Id, true, "", 1);
        long seqE = L(d, "SELECT MAX(seq) FROM change_log");
        d.EditInvoice(r.Id, new SaleLine[] { new SaleLine(a, 1, D(50)) }, 0, "cash", 0, 0, true, 1);
        long retLine = d.GetInvoice(ret2.Id).Lines[0].Id;
        Ok(d.GetInvoice(ret2.Id).Lines[0].SrcLineId == 0, "تعديل فاتورة إرجاعها محذوف ينجح، وتنقطع إشارة السطر");
        Ok((S(d, "SELECT data FROM change_log WHERE seq > ? AND tbl = 'invoice_lines' AND row_id = ? AND op = 'u'", seqE, retLine) ?? "")
            .Contains("\"src_line_id\":null"), "وانقطاعها مسجّل في سجل التغييرات");

        long q0 = d.ShopQty(a);
        r = d.Sell(Sale(new SaleLine(a, 2, D(50))), 1);
        d.DeleteInvoice(r.Id, false, "", 1);
        Eq(q0 - 2, d.ShopQty(a), "الحذف بلا إرجاع للمخزون يترك الكمية");
        Eq(0, d.FullCheck().Count, "الفحص الكامل سليم");
        d.Dispose();
    }

    /* ---------- الزبائن ---------- */

    static void Customers()
    {
        ShopDb d = Fresh();
        long cu = d.AddCustomer(" سالم ", "0912345678", "", false, D(75), 1);
        Ok(d.GetCustomer(cu).Name == "سالم" && d.GetCustomer(cu).Balance == D(75), "زبون بدين سابق 75");
        Throws(delegate { d.DeleteCustomer(cu, 1); }, "عليه دين", "زبون عليه دين لا يُحذف");
        Eq(D(75), d.Pay(cu, D(100), "", "", 1), "التسديد لا يتجاوز الدين (75 لا 100)");
        Throws(delegate { d.Pay(cu, D(10), "", "", 1); }, "لا دين", "لا تسديد بلا دين");
        d.SetBalance(cu, D(20), "رصيد افتتاحي خاطئ", 1);
        Eq(D(20), d.GetCustomer(cu).Balance, "تعديل الدين يدوياً");
        Eq("adjust", S(d, "SELECT reason FROM customer_moves ORDER BY id DESC LIMIT 1"), "ويُسجَّل حركة بسببها");
        d.Pay(cu, D(20), "", "", 1);
        d.DeleteCustomer(cu, 1);
        Ok(!d.GetCustomer(cu).Active, "بلا دين يُحذف");
        Eq(0, d.FullCheck().Count, "كل دين = مجموع حركاته");
        d.Dispose();
    }

    static void Receive()
    {
        ShopDb d = Fresh();
        long store = d.AddPlace(0, "store", "المخزن", "", 1);
        long sup = d.AddSupplier("مورّد", "", "", "", 1);
        long a = Book(d, "أ", D(20), D(10), 2, 0);
        long id = d.Receive(sup, "2026-10-20", "", new ReceiveLine[] { new ReceiveLine(a, 12, D(8.5), 0), new ReceiveLine(a, 5, 0, store) }, 1);
        Ok(d.StockOf(a)[1] == 14 && d.StockOf(a)[store] == 5, "استلام 12 للرف و5 للمخزن");
        Eq(D(8.5), d.GetItem(a).Cost, "سعر الشراء الجديد 8.5 (والصفر لا يمحوه)");
        Eq(D(102), L(d, "SELECT total FROM purchases WHERE id = ?", id), "إجمالي الاستلام 102");
        Throws(delegate { d.Receive(sup, "", "", new ReceiveLine[] { new ReceiveLine(a, 0, 0, 0) }, 1); }, "صنفاً", "استلام بلا كميات يُرفض");
        d.Dispose();
    }

    static void Consign()
    {
        ShopDb d = Fresh();
        ConsignLine l1 = new ConsignLine();
        l1.Title = "ديوان شعر"; l1.Author = "شاعر"; l1.Qty = 5; l1.Price = D(30); l1.OwnerPrice = D(20);
        ConsignLine l2 = new ConsignLine();
        l2.Title = "رواية"; l2.Qty = 2; l2.Price = D(15); l2.OwnerPrice = D(10); l2.Code = "C-77";
        long owner = d.ConsignReceive(0, "صاحب الكتب", "0920000000", "", "", new ConsignLine[] { l1, l2 }, 1);
        long item1 = L(d, "SELECT item_id FROM consignments WHERE title = 'ديوان شعر'");
        ItemRow it = d.GetItem(item1);
        Ok(it.Cat == "على المباع" && it.Cost == D(20) && d.ShopQty(item1) == 5, "كل كتاب صار صنفاً: على المباع، وسعر شرائه حق صاحبه");
        Eq("C-77", d.FindByBarcode("C-77").Code, "الكود المكتوب صار رمزه وباركوده");
        ConsignLine l3 = new ConsignLine();
        l3.Title = "مكرر"; l3.Qty = 1; l3.Code = "C-77";
        Throws(delegate { d.ConsignReceive(owner, "", "", "", "", new ConsignLine[] { l3 }, 1); }, "مستعمل", "كود مستعمل في المحل يُرفض");

        InvoiceResult r = d.Sell(Sale(new SaleLine(item1, 2, D(30))), 1);
        Eq(2L, L(d, "SELECT sold FROM consignments WHERE item_id = ?", item1), "البيع يُسجَّل على المباع");
        Eq(D(40), d.ConsignDue(owner), "المستحق لصاحبه 2 × 20");
        Throws(delegate { d.ConsignPay(owner, D(50), "", "", true, 1); }, "فقط", "لا يُسدَّد أكثر من المستحق");
        d.ConsignPay(owner, D(40), "", "", true, 1);
        Eq(0L, d.ConsignDue(owner), "بعد التسديد لا شيء له");
        InvoiceRow v = d.GetInvoice(r.Id);
        d.Return(v.Id, new ReturnLine[] { new ReturnLine(v.Lines[0].Id, 1) }, "", 1);
        Eq(1L, L(d, "SELECT sold FROM consignments WHERE item_id = ?", item1), "الإرجاع يُنقص المبيع على المباع");
        long cid = L(d, "SELECT id FROM consignments WHERE item_id = ?", item1);
        Eq(4L, d.ConsignGiveBack(cid, 10, 1), "إرجاع الباقي لصاحبه: 4 لا 10");
        Eq(0L, d.ShopQty(item1), "وخرجت من المخزون");
        Throws(delegate { d.ConsignGiveBack(cid, 1, 1); }, "لا توجد نسخ", "لا شيء باقٍ ليُرجَع");
        Eq(0, d.FullCheck().Count, "الفحص الكامل سليم");
        d.Dispose();
    }

    static void Counts()
    {
        ShopDb d = Fresh();
        long a = Book(d, "أ", D(10), D(6), 5, 0);
        long b = Book(d, "ب", D(10), D(4), 3, 0);
        long s = d.CountStart("all", "", 1);
        Throws(delegate { d.CountStart("all", "", 1); }, "مفتوح", "جرد واحد مفتوح في كل مرة");
        d.CountSet(s, a, 5, 1);
        d.Sell(Sale(new SaleLine(a, 2, D(10))), 1);       // بيع بعد العدّ
        d.CountSet(s, b, 1, 1);
        CountResult r = d.CountApply(s, 1);
        Ok(d.ShopQty(a) == 3, "عُدّ 5 ثم بيع 2 ⇦ المخزون 3 لا 5", d.ShopQty(a));
        Ok(d.ShopQty(b) == 1 && r.Less == 1 && r.LossQty == 2 && r.LossVal == D(8) && r.Ok == 1, "نقص قطعتين من ب، وقيمته بسعر الشراء");
        Eq("applied", S(d, "SELECT status FROM count_sessions WHERE id = ?", s), "الجرد مُطبَّق");
        long s2 = d.CountStart("books", "", 1);
        d.CountSet(s2, a, 100, 1);
        d.CountSet(s2, a, null, 1);
        d.CountCancel(s2, 1);
        Eq(3L, d.ShopQty(a), "الإلغاء لا يغيّر شيئاً");
        Throws(delegate { d.CountStart("cat", "لا يوجد", 1); }, "لا توجد أصناف", "نطاق بلا أصناف يُرفض");
        Eq(0, d.FullCheck().Count, "الفحص الكامل سليم");
        d.Dispose();
    }

    static void Users()
    {
        byte[] k = ShopDb.Pbkdf2(Encoding.ASCII.GetBytes("password"), Encoding.ASCII.GetBytes("salt"), 4096, 32);
        Eq("c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a", Hex(k), "PBKDF2-SHA256: المثال المعياري (4096 دورة)");
        k = ShopDb.Pbkdf2(Encoding.ASCII.GetBytes("passwordPASSWORDpassword"), Encoding.ASCII.GetBytes("saltSALTsaltSALTsaltSALTsaltSALTsalt"), 4096, 40);
        Eq("348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1c635518c7dac47e9", Hex(k), "PBKDF2-SHA256: المثال الطويل (40 بايت)");

        Clock clk = new Clock();
        ShopDb d = Fresh(clk);
        Ok(d.Login("admin", "").Ok, "المدير الافتراضي يدخل بلا كلمة سر (مصراتة لا يتغيّر يومها)");
        long u = d.AddUser("موظف", "ali", "سر-1234", "staff", null, 1);
        LoginResult lr = d.Login("ALI", "سر-1234");
        Ok(lr.Ok && lr.Perms.Count == 3 && lr.Perms.Contains("sell") && !lr.Perms.Contains("edit_prices"),
            "الموظف الجديد: بيع وبحث ومشاهدة فقط", string.Join(",", lr.Perms.ToArray()));
        Ok(S(d, "SELECT pass_hash FROM users WHERE id = ?", u).StartsWith("pbkdf2-sha256$"), "كلمة السر مخزّنة مشفّرة لا نصاً");
        for (int i = 0; i < 4; i++) d.Login("ali", "خطأ");
        lr = d.Login("ali", "خطأ");
        Ok(!lr.Ok && lr.Message.Contains("مقفل"), "بعد 5 محاولات خاطئة يُقفل", lr.Message);
        Ok(!d.Login("ali", "سر-1234").Ok, "ولو بكلمة السر الصحيحة وقت القفل");
        clk.T = clk.T.AddMinutes(6);
        Ok(d.Login("ali", "سر-1234").Ok, "بعد دقائق القفل يدخل");
        Eq(0L, L(d, "SELECT failed FROM users WHERE id = ?", u), "والعدّاد صفر بعد الدخول");
        Ok(L(d, "SELECT COUNT(*) FROM ops WHERE kind = 'login' AND detail LIKE '%خاطئة%'") == 5, "كل محاولة خاطئة في سجل العمليات");
        Ok(!d.Login("nobody", "x").Ok, "مستخدم غير موجود يُرفض بالرسالة نفسها");
        Throws(delegate { d.AddUser("آخر", "Ali", "", "staff", null, 1); }, "مستعمل", "اسم الدخول فريد بلا فرق بين الحروف");
        d.SetPerms(u, new string[] { "sell", "search", "view_stock", "edit_prices" }, 1);
        Ok(S(d, "SELECT after FROM ops WHERE kind = 'user-perms'").Contains("edit_prices"), "تغيير الصلاحيات يُسجَّل قبل وبعد");
        d.Dispose();
    }

    static string Hex(byte[] b)
    {
        StringBuilder sb = new StringBuilder();
        foreach (byte x in b) sb.Append(x.ToString("x2"));
        return sb.ToString();
    }

    /* ---------- كاملة أو لا شيء ---------- */

    static void Atomic()
    {
        ShopDb d = Fresh();
        long a = Book(d, "أ", D(10), D(5), 5, 0);
        long before = L(d, "SELECT MAX(seq) FROM change_log"), ops = L(d, "SELECT COUNT(*) FROM ops");
        Throws(delegate { d.Sell(Sale(new SaleLine(a, 2, D(10)), new SaleLine(99999, 1, D(10))), 1); }, "غير موجود", "بيعة سطرها الثاني خطأ تُرفض");
        Ok(d.ShopQty(a) == 5 && L(d, "SELECT COUNT(*) FROM invoices") == 0, "ولا أثر للسطر الأول: الكمية 5 ولا فاتورة");
        Ok(L(d, "SELECT MAX(seq) FROM change_log") == before && L(d, "SELECT COUNT(*) FROM ops") == ops, "ولا شيء في السجلين");
        Eq(0L, L(d, "SELECT value FROM counters WHERE name = 'invoice'"), "ورقم الفاتورة لم يُستهلك");
        try
        {
            d.Run("test", 1, delegate (Cmd c)
            {
                d.Read<int>(delegate (Sqlite s) { s.Run("UPDATE item_stock SET qty = 100"); return 0; });
                throw new InvalidOperationException("انقطاع في الوسط");
            });
        }
        catch (InvalidOperationException) { }
        Eq(5L, d.ShopQty(a), "خطأ غير متوقع في وسط الأمر يُرجع كل شيء");
        d.Dispose();
    }

    /* ---------- سجل التغييرات كامل: إعادة تطبيقه تبني نفس القاعدة ---------- */

    static void ReplayEqual()
    {
        Clock clk = new Clock();
        ShopDb d = Fresh(clk);
        Random r = new Random(1234);
        Work.Setup(d, r, 40, 12);
        int done = 0;
        for (int i = 0; i < 400; i++) if (Work.Step(d, r, null) != null) done++;
        Ok(done > 300, "400 عملية عشوائية (بيع، إرجاع، تعديل، حذف، تسديد، نقل، استلام، جرد، مباع)", done);
        Eq(0, d.FullCheck().Count, "الفحص الكامل سليم بعدها");

        string copy = NewPath();
        Clock clk2 = new Clock();
        OpenOptions o = new OpenOptions();
        o.Clock = clk2.Now;
        ShopDb e = ShopDb.Open(copy, o);
        e.Dispose();
        List<ShopDb.Change> all = d.ChangesSince(0, int.MaxValue);
        using (Sqlite c = Sqlite.Open(copy, false, false)) ShopDb.ApplyChanges(c, all);
        int diffs = 0;
        string first = "";
        List<string> tables = d.Read<List<string>>(delegate (Sqlite c) { return Schema.LoggedTables(c); });
        using (Sqlite c = Sqlite.Open(copy, true, false))
        {
            foreach (string t in tables)
            {
                string a = Dump(d.Read<List<object[]>>(delegate (Sqlite x) { return x.Rows("SELECT * FROM \"" + t + "\" ORDER BY id"); }));
                string b = Dump(c.Rows("SELECT * FROM \"" + t + "\" ORDER BY id"));
                if (a != b) { diffs++; if (first.Length == 0) first = t; }
            }
        }
        Ok(diffs == 0, "إعادة تطبيق سجل التغييرات على قاعدة فارغة تبني نفس الجداول صفاً صفاً (" + tables.Count + " جدول، " + all.Count + " تغيير)", first);
        /* فهرس البحث لا يُسجَّل: يُكتب هناك من الأصناف نفسها، فيطابق الأصل */
        ShopDb f = ShopDb.Open(copy, o);
        string sa = Dump(d.Read<List<object[]>>(delegate (Sqlite x) { return x.Rows("SELECT * FROM search_items ORDER BY item_id"); }));
        string sb = Dump(f.Read<List<object[]>>(delegate (Sqlite x) { return x.Rows("SELECT * FROM search_items ORDER BY item_id"); }));
        List<string> bad = f.CheckSearchIndex();
        Ok(sa == sb && sa.Length > 0 && bad.Count == 0 && f.Report.SearchFixed == 0 && f.Report.SearchBuilt < 0,
            "وفهرس البحث فيها مثل الأصل وسليم، بلا إصلاح عند فتحها", string.Join("؛ ", bad.ToArray()));
        f.Dispose();
        d.Dispose();
    }

    static void Demo()
    {
        ShopDb d = Fresh();
        System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
        int n = d.SeedDemo(1);
        long ms = sw.ElapsedMilliseconds;
        Ok(n >= 150 && L(d, "SELECT COUNT(*) FROM items WHERE kind = 'stat'") > 10 && L(d, "SELECT COUNT(*) FROM invoices WHERE kind = 'sale'") > 5 &&
           L(d, "SELECT COUNT(*) FROM places WHERE kind = 'store'") == 1 && L(d, "SELECT COUNT(*) FROM customers WHERE balance > 0") > 0,
            "مكتبة تجربة: " + n + " صنف، أماكن ومخزن، زبائن بديون، وبيعات اليوم (" + ms + " ms)");
        List<string> bad = d.FullCheck();
        bad.AddRange(d.CheckSearchIndex());
        Ok(bad.Count == 0, "وكلها سليمة: الكميات من حركاتها، والفهرس", string.Join("؛ ", bad.ToArray()));
        Ok(S(d, "SELECT value FROM settings WHERE key = 'demo'") == "true", "وعليها علامة «نسخة تجربة»");
        SearchOptions o = new SearchOptions();
        o.Limit = 8;
        SearchResult r = d.SearchItems("الفيزياء الاساسيه", o);
        Ok(r.Ids.Count > 0 && d.GetItem(r.Ids[0]).Title == "الفيزياء الأساسية" && r.Names == 1, "والبحث فيها: «الفيزياء الاساسيه» أولاً");
        bool threw = false;
        try { d.SeedDemo(1); }
        catch (ShopException) { threw = true; }
        Ok(threw, "ولا تُضاف مرة ثانية فوق أصناف موجودة");
        d.Dispose();
    }

    static string Dump(List<object[]> rows)
    {
        StringBuilder sb = new StringBuilder();
        foreach (object[] r in rows)
        {
            foreach (object v in r)
            {
                byte[] bl = v as byte[];
                sb.Append(bl != null ? Convert.ToBase64String(bl) : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)).Append('\u001f');
            }
            sb.Append('\n');
        }
        return sb.ToString();
    }

    static void CheckAndBackup()
    {
        ShopDb d = Fresh();
        Random r = new Random(5);
        Work.Setup(d, r, 20, 5);
        for (int i = 0; i < 100; i++) Work.Step(d, r, null);
        Eq(0, d.FullCheck().Count, "قاعدة سليمة: لا مشاكل");
        string bk = Path.Combine(Root, "نسخ", "نسخة.db");
        d.BackupTo(bk);
        ShopDb b = ShopDb.Open(bk, null);
        Ok(b.Report.Check == "ok" && L(b, "SELECT COUNT(*) FROM invoices") == L(d, "SELECT COUNT(*) FROM invoices") &&
           L(b, "SELECT COUNT(*) FROM change_log") == L(d, "SELECT COUNT(*) FROM change_log"), "النسخة تُفتح سليمة وفيها كل شيء");
        b.Dispose();

        /* النسخة اليومية من اتصال قراءة منفصل: تكتمل وأمرٌ جارٍ يمسك القاعدة */
        System.Threading.ManualResetEvent inside = new System.Threading.ManualResetEvent(false), release = new System.Threading.ManualResetEvent(false);
        System.Threading.Thread w = new System.Threading.Thread(delegate ()
        {
            d.Run("test-hold", 1, delegate (Cmd c) { inside.Set(); release.WaitOne(10000); });
        });
        w.Start();
        inside.WaitOne(10000);
        System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
        string snap = d.SnapshotTo(Path.Combine(Root, "نسخ", "qirtasiya-2026-10-27.db"));
        long held = sw.ElapsedMilliseconds;
        release.Set();
        w.Join();
        ShopDb sn = ShopDb.Open(snap, null);
        Ok(held < 5000 && sn.Report.Check == "ok" && sn.FullCheck().Count == 0 &&
           L(sn, "SELECT COUNT(*) FROM invoices") == L(d, "SELECT COUNT(*) FROM invoices"),
            "النسخة اليومية تكتمل والبيع جارٍ (لا تنتظره)، وتُفتح سليمة", held + " ms");
        sn.Dispose();

        d.Read<int>(delegate (Sqlite c) { c.Run("UPDATE item_stock SET qty = qty + 1 WHERE id = (SELECT MIN(id) FROM item_stock)"); return 0; });
        List<string> bad = d.FullCheck();
        Ok(bad.Count == 1 && bad[0].StartsWith("كمية"), "تعديل كمية من خارج المنظومة يُكتشف", string.Join("؛ ", bad.ToArray()));
        d.Dispose();
    }
}
