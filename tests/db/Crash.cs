using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Qirtasiya.Data;

/* ============================================================
   اختبار القتل: يُقتل البرنامج فجأة آلاف المرات وهو يحفظ
   ------------------------------------------------------------
   عملية ابن تفتح القاعدة وتنفّذ عملاً عشوائياً (بيع، إرجاع، تعديل...)،
   وتطبع رقم كل أمر بعد أن يقول «تم». الأب يقتلها في لحظة عشوائية (قتل
   فوري بلا إغلاق: TerminateProcess على ويندوز، SIGKILL على لينكس)،
   ثم يتأكد:
     - الملف سليم (quick_check + integrity_check) ويُفتح للكتابة.
     - كل أمر قيل عنه «تم» موجود، والأرقام متتالية بلا فجوة.
     - كل كمية = مجموع حركاتها، وكل دين = مجموع حركاته، وكل فاتورة
       مجموعها = أسطرها، وعدّاد الفواتير = آخر فاتورة.
   مع --migrate: يُقتل وسط ترقية ثقيلة، والقاعدة إما قبلها كاملة أو
   بعدها كاملة.

     DbTests.exe crash 2000            القتل وسط العمل
     DbTests.exe crash 300 --migrate   القتل وسط الترقية
   ============================================================ */
static class Crash
{
    static readonly object Gate = new object();

    public static int Parent(string[] args)
    {
        int n = args.Length > 1 ? int.Parse(args[1]) : 200;
        bool migrate = Array.IndexOf(args, "--migrate") >= 0;
        string dir = Path.Combine(Path.GetTempPath(), "qcrash-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        Directory.CreateDirectory(dir);
        string db = Path.Combine(dir, "crash.db");
        Console.WriteLine("SQLite " + Sqlite.Version + " · " + dir + " · " + n + (migrate ? " قتلة وسط الترقية" : " قتلة وسط العمل"));
        Random r = new Random(20261026);
        Stopwatch total = Stopwatch.StartNew();
        int ops = 0, killedMidMigration = 0, insideTx = 0, migrated = 0;
        string pristine = Path.Combine(dir, "before.db");

        for (int i = 1; i <= n; i++)
        {
            /* قاعدة جديدة كل 100 قتلة: يبقى الفحص الكامل سريعاً */
            if (i == 1 || (!migrate && i % 100 == 1) || (migrate && !File.Exists(db)))
            {
                if (migrate) PrepareV1(pristine, db, i == 1);
                else Fresh(db, r.Next());
            }
            List<long> reported = new List<long>();
            int wait = migrate ? r.Next(100, 600) : (r.Next(10) == 0 ? r.Next(1, 40) : r.Next(40, 700));
            string err = RunChild(db, i, migrate, wait, reported);
            if (err != null) return Fail(i, err, dir);

            string bad = Verify(db, reported, migrate);
            if (bad != null) return Fail(i, bad, dir);
            ops += reported.Count;
            if (migrate)
            {
                long v = UserVersion(db);
                if (v == Heavy) { migrated++; File.Delete(db); foreach (string f in Directory.GetFiles(dir, "crash.db-*")) File.Delete(f); }
                else
                {
                    killedMidMigration++;
                    if (reported.Contains(-1)) insideTx++;
                }
            }
            if (i % 100 == 0 || i == n)
                Console.WriteLine("  " + i + "/" + n + " · " + (migrate ? ("قبل اكتمال الترقية " + killedMidMigration + " (داخل معاملتها " + insideTx + ")، اكتملت " + migrated) : (ops + " أمر قيل عنه «تم»")) +
                    " · " + (total.ElapsedMilliseconds / 1000) + " ث");
        }
        if (migrate && (insideTx == 0 || migrated == 0))
            return Fail(n, "لم يغطِّ الاختبار الحالتين (قُتل داخل معاملة الترقية " + insideTx + "، اكتملت " + migrated + ")", dir);
        Console.WriteLine("==================================================");
        Console.WriteLine("  نجح: " + n + " قتلة بلا تلف ولا فقد" + (migrate ? "" : " (" + ops + " أمر)"));
        Console.WriteLine("==================================================");
        try { Directory.Delete(dir, true); } catch { }
        return 0;
    }

    static int Fail(int i, string why, string dir)
    {
        Console.WriteLine("  FAIL  القتلة " + i + ": " + why);
        Console.WriteLine("  الملفات باقية للفحص: " + dir);
        return 1;
    }

    static void Fresh(string db, int seed)
    {
        foreach (string f in Directory.GetFiles(Path.GetDirectoryName(db), "crash.db*")) File.Delete(f);
        ShopDb d = ShopDb.Open(db, null);
        Work.Setup(d, new Random(seed), 60, 15);
        d.Dispose();
    }

    /* قاعدة على آخر ترقية حقيقية فيها آلاف الصفوف، لتأخذ الترقية الثقيلة وقتاً يُقتل فيه */
    static void PrepareV1(string pristine, string db, bool build)
    {
        if (build)
        {
            ShopDb d = ShopDb.Open(pristine, null);
            Random r = new Random(9);
            Work.Setup(d, r, 3000, 50);
            for (int i = 0; i < 300; i++) Work.Step(d, r, null);
            d.Read<int>(delegate (Sqlite c) { c.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); return 0; });
            d.Dispose();
        }
        foreach (string f in Directory.GetFiles(Path.GetDirectoryName(db), "crash.db*")) File.Delete(f);
        File.Copy(pristine, db);
    }

    /* الترقية الثقيلة رقمها بعد آخر ترقية حقيقية */
    static readonly int Heavy = Schema.All().Count + 1;

    public static List<Migration> HeavyV2()
    {
        List<Migration> m = Schema.All();
        m.Add(new Migration(Heavy, "ترقية ثقيلة للاختبار",
            "ALTER TABLE items ADD COLUMN search_key TEXT NOT NULL DEFAULT '';" +
            "CREATE INDEX items_search_key ON items(search_key);",
            delegate (Sqlite c, string at)
            {
                /* الأب يعرف هكذا أن القتل وقع داخل معاملة الترقية نفسها */
                Console.WriteLine("MIG");
                Console.Out.Flush();
                for (int k = 0; k < 4; k++) c.Run("UPDATE items SET search_key = lower(title) || ' ' || code || ' ' || ?", k);
                c.Run("UPDATE counters SET value = value WHERE name = 'invoice'");
            }));
        return m;
    }

    static long UserVersion(string db)
    {
        using (Sqlite c = Sqlite.Open(db, true, false)) return c.Long("PRAGMA user_version", 0);
    }

    static string RunChild(string db, int seed, bool migrate, int waitMs, List<long> reported)
    {
        string exe = System.Reflection.Assembly.GetExecutingAssembly().Location;
        ProcessStartInfo p = new ProcessStartInfo();
        bool mono = Type.GetType("Mono.Runtime") != null;
        string a = "crash-child \"" + db + "\" " + seed + (migrate ? " --migrate" : "");
        p.FileName = mono ? "mono" : exe;
        p.Arguments = mono ? "\"" + exe + "\" " + a : a;
        p.UseShellExecute = false;
        p.RedirectStandardOutput = true;
        p.RedirectStandardError = true;
        p.CreateNoWindow = true;
        p.StandardOutputEncoding = System.Text.Encoding.UTF8;
        List<string> errLines = new List<string>();
        using (Process child = new Process())
        {
            child.StartInfo = p;
            child.OutputDataReceived += delegate (object s, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                if (e.Data.StartsWith("OK ")) lock (Gate) reported.Add(long.Parse(e.Data.Substring(3)));
                else if (e.Data == "MIG") lock (Gate) reported.Add(-1);
                else if (e.Data.StartsWith("ERR")) lock (Gate) errLines.Add(e.Data);
            };
            child.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e)
            {
                if (e.Data != null) lock (Gate) errLines.Add(e.Data);
            };
            child.Start();
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            bool exited = child.WaitForExit(waitMs);
            if (!exited)
            {
                try { child.Kill(); } catch (InvalidOperationException) { }
                child.WaitForExit();
            }
            else child.WaitForExit();
            lock (Gate)
            {
                if (errLines.Count > 0) return "الابن كتب خطأ: " + string.Join(" | ", errLines.ToArray());
                if (exited && !migrate) return "الابن خرج وحده برمز " + child.ExitCode;
            }
        }
        return null;
    }

    static string Verify(string db, List<long> reported, bool migrate)
    {
        OpenOptions o = new OpenOptions();
        if (migrate) o.Migrations = new List<Migration>(Schema.All());   // نفتح بلا الترقية 2 حتى لا نكملها نحن
        ShopDb d;
        try { d = ShopDb.Open(db, o); }
        catch (Exception e) { return "تعذّر الفتح بعد القتل: " + e.Message; }
        try
        {
            if (d.Report.Check != "ok") return "فحص الفتح: " + d.Report.Check;
            long ver = d.Report.VersionBefore;
            if (migrate)
            {
                if (ver != Heavy - 1 && ver != Heavy) return "رقم ترقية غريب " + ver;
                long hasCol = d.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM pragma_table_info('items') WHERE name = 'search_key'", 0); });
                if (ver == Heavy - 1 && hasCol != 0) return "نصف ترقية: العمود موجود والرقم " + ver;
                if (ver == Heavy)
                {
                    if (hasCol != 1) return "الترقية مكتملة والعمود ناقص";
                    long empty = d.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM items WHERE search_key NOT LIKE '% 3'", 0); });
                    if (empty != 0) return "الترقية مكتملة وتحويل البيانات ناقص (" + empty + " صف)";
                }
            }
            else if (d.ReadOnly) return "فُتحت للقراءة فقط: " + d.Report.ReadOnlyReason;

            List<string> bad = d.FullCheck();
            if (bad.Count > 0) return string.Join("؛ ", bad.ToArray());
            /* فهرس البحث في نفس معاملة الصنف: بعد القتل لا يحتاج إصلاحاً، ويطابق الأصناف حرفاً بحرف */
            if (!d.ReadOnly)
            {
                if (d.Report.SearchFixed != 0 || d.Report.SearchBuilt > 0)
                    return "فهرس البحث احتاج إصلاحاً بعد القتل (صُلح " + d.Report.SearchFixed + "، بُني " + d.Report.SearchBuilt + ")";
                bad = d.CheckSearchIndex();
                if (bad.Count > 0) return string.Join("؛ ", bad.ToArray());
            }
            long maxOp = d.Read<long>(delegate (Sqlite c) { return c.Long("SELECT MAX(id) FROM ops", 0); });
            long count = d.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM ops", 0); });
            if (count != maxOp) return "فجوة في أرقام الأوامر: " + count + " أمر وآخر رقم " + maxOp;
            lock (Gate)
            {
                foreach (long id in reported)
                {
                    if (id > 0 && id > maxOp) return "الأمر " + id + " قيل عنه «تم» ولم يُوجد (آخر موجود " + maxOp + ")";
                }
            }
            long noChange = d.Read<long>(delegate (Sqlite c)
            {
                return c.Long("SELECT COUNT(*) FROM ops WHERE kind = 'sale' AND id NOT IN (SELECT op_id FROM change_log)", 0);
            });
            if (noChange > 0) return noChange + " بيعة بلا صف في سجل التغييرات";
            return null;
        }
        finally { d.Dispose(); }
    }

    public static int Child(string[] args)
    {
        string db = args[1];
        int seed = int.Parse(args[2]);
        bool migrate = Array.IndexOf(args, "--migrate") >= 0;
        try
        {
            OpenOptions o = new OpenOptions();
            if (migrate) o.Migrations = HeavyV2();
            ShopDb d = ShopDb.Open(db, o);
            if (migrate) { Console.Out.Flush(); return 0; }
            Work.Items.Clear(); Work.Customers.Clear(); Work.Places.Clear();
            d.Read<int>(delegate (Sqlite c)
            {
                foreach (object[] r in c.Rows("SELECT id FROM items WHERE active = 1")) Work.Items.Add((long)r[0]);
                foreach (object[] r in c.Rows("SELECT id FROM customers WHERE active = 1")) Work.Customers.Add((long)r[0]);
                foreach (object[] r in c.Rows("SELECT id FROM places WHERE kind IN ('shelf', 'room') AND active = 1")) Work.Places.Add((long)r[0]);
                Work.Store = c.Long("SELECT id FROM places WHERE kind = 'store' LIMIT 1", 0);
                Work.Consignor = c.Long("SELECT id FROM consignors LIMIT 1", 0);
                return 0;
            });
            Random r2 = new Random(seed);
            TextWriter w = Console.Out;
            while (true)
            {
                if (Work.Step(d, r2, null) == null) continue;
                long op = d.Read<long>(delegate (Sqlite c) { return c.Long("SELECT MAX(id) FROM ops", 0); });
                w.WriteLine("OK " + op);
                w.Flush();
            }
        }
        catch (Exception e)
        {
            Console.WriteLine("ERR " + e.GetType().Name + ": " + e.Message.Replace('\n', ' '));
            Console.Out.Flush();
            return 2;
        }
    }
}
