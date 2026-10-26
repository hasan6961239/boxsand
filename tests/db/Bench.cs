using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using Qirtasiya.Data;

/* ============================================================
   قياس القاعدة الجديدة على بيانات المولّد (المرحلة 1)
   ------------------------------------------------------------
     node tools/gen/generate.js --profile tripoli --books 100000 \
          --stationery 10000 --years 5 --out /tmp/g100k
     DbTests.exe bench /tmp/g100k [--json out.json]

   يحمّل المكتبة كلها في قاعدة جديدة (معاملة واحدة، كالاستيراد)، ثم
   يقيس ما يعيشه البائع: فتح البرنامج، البيع، الإرجاع، التسديد، الاستلام،
   والصفحات الثقيلة (التنبيهات، الراكد، تقرير الشهر...)، والبحث بالاسم
   مع كل حرف (المرحلة 3).
   ============================================================ */
static class Bench
{
    static readonly Dictionary<string, object> Out = new Dictionary<string, object>();

    public static int Run(string[] args)
    {
        if (args.Length < 2) { Console.WriteLine("الاستعمال: DbTests.exe bench <مجلد المولّد> [--json ملف]"); return 2; }
        string gen = args[1];
        int ji = Array.IndexOf(args, "--json");
        string jsonOut = ji > 0 && ji + 1 < args.Length ? args[ji + 1] : null;
        string dir = Path.Combine(Path.GetTempPath(), "qbench-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        Directory.CreateDirectory(dir);
        string db = Path.Combine(dir, "bench.db");
        Console.WriteLine("SQLite " + Sqlite.Version + " · " + (IntPtr.Size * 8) + "-bit · " + gen);

        Stopwatch sw = Stopwatch.StartNew();
        ShopDb d = ShopDb.Open(db, null);
        Load(d, gen);
        Out["load_s"] = Math.Round(sw.ElapsedMilliseconds / 1000.0, 1);
        d.Read<int>(delegate (Sqlite c)
        {
            Out["books"] = c.Long("SELECT COUNT(*) FROM items WHERE kind = 'book'", 0);
            Out["stationery"] = c.Long("SELECT COUNT(*) FROM items WHERE kind = 'stat'", 0);
            Out["invoices"] = c.Long("SELECT COUNT(*) FROM invoices", 0);
            Out["lines"] = c.Long("SELECT COUNT(*) FROM invoice_lines", 0);
            Out["stock_rows"] = c.Long("SELECT COUNT(*) FROM item_stock", 0);
            c.Exec("PRAGMA wal_checkpoint(TRUNCATE)");
            return 0;
        });
        d.Dispose();
        Out["disk_mb"] = Math.Round(new FileInfo(db).Length / 1048576.0, 1);
        Console.WriteLine("  حُمّلت في " + Out["load_s"] + " ث: " + Out["books"] + " كتاب، " + Out["stationery"] + " قرطاسية، " +
            Out["invoices"] + " فاتورة · " + Out["disk_mb"] + " ميغا");

        /* فتح البرنامج: فتح الملف + فحص السلامة السريع */
        /* أول فتح يبني فهرس البحث (المكتبة أُدخلت من خارج المحرك) */
        List<double> opens = new List<double>();
        for (int i = 0; i < 4; i++)
        {
            sw.Restart();
            d = ShopDb.Open(db, null);
            if (i == 0)
            {
                Out["search_build_s"] = Math.Round(d.Report.SearchMs / 1000.0, 1);
                d.Read<int>(delegate (Sqlite c) { c.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); return 0; });
                Out["search_index_mb"] = Math.Round(new FileInfo(db).Length / 1048576.0 - (double)Out["disk_mb"], 1);
                Console.WriteLine("  فهرس البحث: بُني في " + Out["search_build_s"] + " ث، حجمه " + Out["search_index_mb"] + " ميغا");
            }
            else opens.Add(sw.Elapsed.TotalMilliseconds);
            if (i < 3) d.Dispose();
        }
        Out["open_ms"] = Median(opens);
        Out["quick_check_ms"] = d.Report.CheckMs;

        SearchBench(d);

        Random r = new Random(42);
        List<long> items = Ids(d, "SELECT id FROM items WHERE active = 1");
        List<long> customers = Ids(d, "SELECT id FROM customers WHERE active = 1");
        List<long> shelves = Ids(d, "SELECT id FROM places WHERE kind = 'shelf'");
        long store = d.Read<long>(delegate (Sqlite c) { return c.Long("SELECT id FROM places WHERE kind = 'store' LIMIT 1", 0); });

        Ops(d, r, "sale", 1000, delegate
        {
            SaleInput s = new SaleInput();
            int n = r.Next(1, 4);
            for (int k = 0; k < n; k++)
            {
                long it = items[r.Next(items.Count)];
                bool dup = false;
                foreach (SaleLine x in s.Lines) if (x.ItemId == it) dup = true;
                if (!dup) s.Lines.Add(new SaleLine(it, r.Next(1, 3), d.GetItem(it).Price));
            }
            if (r.Next(10) == 0) { s.Method = "credit"; s.CustomerId = customers[r.Next(customers.Count)]; }
            d.Sell(s, 1);
        });
        Out["changelog_bytes_per_sale"] = d.Read<long>(delegate (Sqlite c)
        {
            return c.Long("SELECT SUM(length(l.data)) / COUNT(DISTINCT l.op_id) FROM change_log l JOIN ops o ON o.id = l.op_id WHERE o.kind = 'sale'", 0);
        });
        Console.WriteLine("  سجل التغييرات: " + Out["changelog_bytes_per_sale"] + " بايت للبيعة");
        List<long> recent = Ids(d, "SELECT id FROM invoices WHERE kind = 'sale' ORDER BY id DESC LIMIT 1000");
        Ops(d, r, "return", 200, delegate
        {
            InvoiceRow v = d.GetInvoice(recent[r.Next(recent.Count)]);
            try { d.Return(v.Id, new ReturnLine[] { new ReturnLine(v.Lines[0].Id, 1) }, "", 1); } catch (ShopException) { }
        });
        List<long> owing = Ids(d, "SELECT id FROM customers WHERE balance > 0");
        Ops(d, r, "payment", 200, delegate
        {
            try { d.Pay(owing[r.Next(owing.Count)], 1000 * r.Next(1, 20), "", "", 1); } catch (ShopException) { }
        });
        Ops(d, r, "receive", 100, delegate
        {
            List<ReceiveLine> ls = new List<ReceiveLine>();
            for (int k = r.Next(1, 4); k > 0; k--) ls.Add(new ReceiveLine(items[r.Next(items.Count)], r.Next(1, 20), 1000 * r.Next(5, 40), 0));
            d.Receive(0, "", "", ls, 1);
        });
        List<long> inStore = Ids(d, "SELECT item_id FROM item_stock WHERE place_id = (SELECT id FROM places WHERE kind = 'store' LIMIT 1) AND qty >= 2");
        /* مصراتة بلا مخزن: لا نقل يُقاس */
        if (inStore.Count > 0) Ops(d, r, "move", 100, delegate
        {
            d.MoveStock(inStore[r.Next(inStore.Count)], store, shelves[r.Next(shelves.Count)], 1, 1);
        });
        Ops(d, r, "edit", 100, delegate
        {
            InvoiceRow v = d.GetInvoice(recent[r.Next(recent.Count)]);
            List<SaleLine> ls = new List<SaleLine>();
            foreach (InvoiceLineRow l in v.Lines) if (l.ItemId > 0) ls.Add(new SaleLine(l.ItemId, l.Qty + 1, l.Price));
            try { d.EditInvoice(v.Id, ls, 0, "cash", 0, 0, true, 1); } catch (ShopException) { }
        });

        /* الصفحات الثقيلة: كانت تُحسب في الواجهة على كل البيانات (3.x) */
        string today = ShopDb.Day(DateTime.Now);
        Query(d, "page_alerts",
            "SELECT i.id, i.title, i.min_qty, IFNULL(q.qty, 0) FROM items i LEFT JOIN " +
            "(SELECT s.item_id, SUM(s.qty) AS qty FROM item_stock s JOIN places p ON p.id = s.place_id WHERE p.kind <> 'store' GROUP BY s.item_id) q " +
            "ON q.item_id = i.id WHERE i.active = 1 AND (IFNULL(q.qty, 0) <= 0 OR (i.min_qty > 0 AND IFNULL(q.qty, 0) <= i.min_qty)) " +
            "ORDER BY IFNULL(q.qty, 0), i.title LIMIT 200");
        Query(d, "page_stale",
            "SELECT i.id, i.title, i.last_sold FROM items i WHERE i.active = 1 AND i.last_sold < date('2026-10-25', '-180 days') " +
            "AND EXISTS (SELECT 1 FROM item_stock s WHERE s.item_id = i.id AND s.qty > 0) ORDER BY i.last_sold LIMIT 200");
        Query(d, "page_invoices",
            "SELECT v.no, v.at, v.total, c.name FROM invoices v LEFT JOIN customers c ON c.id = v.customer_id " +
            "WHERE v.deleted_at = '' ORDER BY v.id DESC LIMIT 50");
        Query(d, "report_day", "SELECT COUNT(*), SUM(total), SUM(profit) FROM invoices WHERE date = ? AND deleted_at = ''", today);
        Query(d, "report_month",
            "SELECT date, COUNT(*), SUM(total), SUM(profit) FROM invoices WHERE date BETWEEN '2026-09-01' AND '2026-09-30' AND deleted_at = '' GROUP BY date");
        Query(d, "report_year_top",
            "SELECT l.item_id, SUM(CASE v.kind WHEN 'return' THEN -l.qty ELSE l.qty END) AS q FROM invoice_lines l JOIN invoices v ON v.id = l.invoice_id " +
            "WHERE v.date >= '2025-10-26' AND v.deleted_at = '' GROUP BY l.item_id ORDER BY q DESC LIMIT 50");
        long cu = customers[0];
        Query(d, "customer_statement",
            "SELECT 'v', no, at, total, due FROM invoices WHERE customer_id = ? AND deleted_at = '' UNION ALL " +
            "SELECT 'p', id, at, amount, 0 FROM payments WHERE customer_id = ? ORDER BY 3 DESC LIMIT 100", cu, cu);
        string bc = d.Read<string>(delegate (Sqlite c) { return c.Text("SELECT barcode FROM items WHERE barcode <> '' LIMIT 1 OFFSET 500"); });
        Query(d, "lookup_barcode", "SELECT id, title, price FROM items WHERE barcode = ? AND barcode <> '' AND active = 1", bc);
        Query(d, "item_page",
            "SELECT p.name, s.qty FROM item_stock s JOIN places p ON p.id = s.place_id WHERE s.item_id = ?", items[777]);

        sw.Restart();
        List<string> bad = d.FullCheck();
        Out["full_check_s"] = Math.Round(sw.ElapsedMilliseconds / 1000.0, 1);
        Out["full_check_problems"] = bad.Count;
        sw.Restart();
        bad.AddRange(d.CheckSearchIndex());
        Out["search_check_s"] = Math.Round(sw.ElapsedMilliseconds / 1000.0, 1);
        Out["search_check_problems"] = bad.Count - (int)Out["full_check_problems"];
        Console.WriteLine("  الفحص الكامل: " + Out["full_check_s"] + " ث · فحص فهرس البحث حرفاً بحرف: " + Out["search_check_s"] + " ث · مشاكل: " + bad.Count);
        foreach (string b in bad) Console.WriteLine("    ✗ " + b);
        sw.Restart();
        d.BackupTo(Path.Combine(dir, "backup.db"));
        Out["backup_s"] = Math.Round(sw.ElapsedMilliseconds / 1000.0, 1);
        d.Dispose();
        Out["disk_after_mb"] = Math.Round(new FileInfo(db).Length / 1048576.0, 1);

        Console.WriteLine(Json.Write(Out));
        if (jsonOut != null) File.WriteAllText(jsonOut, Json.Write(Out));
        if (Array.IndexOf(args, "--keep") >= 0) Console.WriteLine("  القاعدة باقية: " + db);
        else { try { Directory.Delete(dir, true); } catch { } }
        return bad.Count == 0 ? 0 : 1;
    }

    /* ---------- البحث بالاسم (المرحلة 3) ----------
       كما يكتب البائع: كل حرف بحث جديد (8 نتائج) على 30 اسماً حقيقياً من
       المكتبة، وعلى 10 منها بغلط إملائي في وسطها، وقائمة ثابتة. ثم صفحة
       الأصناف (كل المطابق مرتّباً) للأسماء كاملة. الهدف: أقل من 100 ms. */
    static void SearchBench(ShopDb d)
    {
        /* البرنامج يجهّز القاموس في الخلفية عند التشغيل */
        Stopwatch sw = Stopwatch.StartNew();
        d.WarmSearch();
        Out["search_warm_ms"] = sw.ElapsedMilliseconds;
        List<string> titles = new List<string>();
        long n = d.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM items WHERE active = 1", 0); });
        for (int i = 0; i < 30; i++)
        {
            long off = n * i / 30 + 7;
            titles.Add(d.Read<string>(delegate (Sqlite c) { return c.Text("SELECT title FROM items WHERE active = 1 ORDER BY id LIMIT 1 OFFSET ?", off); }));
        }
        List<string> typed = new List<string>(titles);
        for (int i = 0; i < 10; i++) typed.Add(Typo(titles[i * 3]));
        typed.AddRange(new string[] { "الفيزياء الاساسيه", "رياضيات الجزء التاني", "شرلوك هولمز", "حظارة", "د. محمد" });

        List<double> keys = new List<double>();
        double worst = 0;
        string worstQ = "";
        SearchOptions pos = new SearchOptions();
        pos.Limit = 8; pos.Channel = "bench";
        foreach (string t in typed)
        {
            for (int L = 1; L <= t.Length; L++)
            {
                string q = t.Substring(0, L);
                if (q.EndsWith(" ")) continue;
                SearchResult r = d.SearchItems(q, pos);
                keys.Add(r.Ms);
                if (r.Ms > worst) { worst = r.Ms; worstQ = q; }
            }
        }
        keys.Sort();
        int slow = 0;
        foreach (double k in keys) if (k > 100) slow++;
        Out["search_keys_over_100ms"] = slow;
        Out["search_keystrokes"] = keys.Count;
        Out["search_key_ms_median"] = Math.Round(keys[keys.Count / 2], 1);
        Out["search_key_ms_p95"] = Math.Round(keys[(int)(keys.Count * 0.95)], 1);
        Out["search_key_ms_max"] = Math.Round(worst, 1);
        Console.WriteLine("  تجهيز البحث عند التشغيل: " + Out["search_warm_ms"] + " ms");
        Console.WriteLine("  البحث مع كل حرف (" + keys.Count + " حرف): الوسيط " + Out["search_key_ms_median"] + " ms · 95% " +
            Out["search_key_ms_p95"] + " ms · الأسوأ " + Out["search_key_ms_max"] + " ms («" + worstQ + "») · فوق 100 ms: " + slow);

        int found = 0;
        foreach (string t in titles) if (d.SearchItems(t, pos).Ids.Count > 0) found++;
        int nearFound = 0;
        for (int i = 0; i < 10; i++)
        {
            SearchResult r = d.SearchItems(Typo(titles[i * 3]), pos);
            if (r.Ids.Count > 0) nearFound++;
        }
        Out["search_found_exact"] = found + "/30";
        Out["search_found_typo"] = nearFound + "/10";

        List<double> table = new List<double>();
        SearchOptions all = new SearchOptions();
        long rows = 0;
        foreach (string t in titles)
        {
            SearchResult r = d.SearchItems(t, all);
            table.Add(r.Ms);
            rows += r.Ids.Count;
        }
        table.Sort();
        /* الجدول بحرف أو حرفين: كل ما فيه هذه الحروف، مرتّباً (أثقل حالة) */
        double shortMax = 0;
        foreach (string q in new string[] { "ا", "م", "ال", "كت", "ثق" })
        {
            /* كما تطلبها صفحة الأصناف: أول 100 والعدد */
            long total;
            bool more;
            sw.Restart();
            d.SearchWindow(q, new SearchOptions(), 100, out total, out more);
            shortMax = Math.Max(shortMax, sw.Elapsed.TotalMilliseconds);
        }
        Out["search_table_short_ms_max"] = Math.Round(shortMax, 1);
        Out["search_table_ms_median"] = Math.Round(table[table.Count / 2], 1);
        Out["search_table_ms_max"] = Math.Round(table[table.Count - 1], 1);
        Console.WriteLine("  صفحة الأصناف بالبحث: الوسيط " + Out["search_table_ms_median"] + " ms · الأسوأ " + Out["search_table_ms_max"] +
            " ms · وُجد " + found + "/30 بالاسم و" + nearFound + "/10 بغلط إملائي · " + rows / titles.Count + " نتيجة للاسم في المتوسط" +
            " · بحرف أو حرفين: " + Out["search_table_short_ms_max"] + " ms");
    }

    /* غلط إملائي في وسط أطول كلمة: حرف مكان حرف */
    static string Typo(string t)
    {
        string[] w = t.Split(' ');
        int k = 0;
        for (int i = 1; i < w.Length; i++) if (w[i].Length > w[k].Length) k = i;
        if (w[k].Length < 4) return t;
        char[] c = w[k].ToCharArray();
        int p = c.Length / 2;
        c[p] = c[p] == 'ر' ? 'ز' : 'ر';
        w[k] = new string(c);
        return string.Join(" ", w);
    }

    static List<long> Ids(ShopDb d, string sql)
    {
        List<long> l = new List<long>();
        foreach (object[] r in d.Read<List<object[]>>(delegate (Sqlite c) { return c.Rows(sql); })) l.Add((long)r[0]);
        return l;
    }

    static double Median(List<double> v)
    {
        v.Sort();
        return Math.Round(v[v.Count / 2], 1);
    }

    static void Ops(ShopDb d, Random r, string name, int n, Action op)
    {
        List<double> t = new List<double>();
        Stopwatch sw = new Stopwatch();
        for (int i = 0; i < n; i++)
        {
            sw.Restart();
            op();
            t.Add(sw.Elapsed.TotalMilliseconds);
        }
        t.Sort();
        Out[name + "_ms_median"] = Math.Round(t[t.Count / 2], 1);
        Out[name + "_ms_p95"] = Math.Round(t[(int)(t.Count * 0.95)], 1);
        Out[name + "_ms_max"] = Math.Round(t[t.Count - 1], 1);
        Console.WriteLine("  " + name + ": الوسيط " + Out[name + "_ms_median"] + " ms · 95% " + Out[name + "_ms_p95"] + " ms · الأسوأ " + Out[name + "_ms_max"] + " ms");
    }

    static void Query(ShopDb d, string name, string sql, params object[] args)
    {
        List<double> t = new List<double>();
        int rows = 0;
        for (int i = 0; i < 5; i++)
        {
            Stopwatch sw = Stopwatch.StartNew();
            rows = d.Read<List<object[]>>(delegate (Sqlite c) { return c.Rows(sql, args); }).Count;
            t.Add(sw.Elapsed.TotalMilliseconds);
        }
        Out[name + "_ms"] = Median(t);
        Console.WriteLine("  " + name + ": " + Out[name + "_ms"] + " ms (" + rows + " صف)");
    }

    /* ---------- التحميل ----------
       معاملة واحدة كالاستيراد: مُطلِقات سجل التغييرات تُزال أثناءه وتُبنى
       بعده، فالمكتبة المستوردة نقطة بداية (تتبعها نسخة كاملة)، لا مليون
       صف في السجل. */
    static void Load(ShopDb d, string gen)
    {
        d.Run("import", 1, delegate (Cmd cmd)
        {
            d.Read<int>(delegate (Sqlite c)
            {
                foreach (object[] t in c.Rows("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'log%'"))
                    c.Exec("DROP TRIGGER \"" + t[0] + "\"");
                Dictionary<string, long> place = new Dictionary<string, long>();
                Dictionary<string, string> kindOf = new Dictionary<string, string>();
                foreach (object o in (List<object>)Json.Parse(File.ReadAllText(Path.Combine(gen, "places.json"))))
                {
                    Dictionary<string, object> p = (Dictionary<string, object>)o;
                    string parent = Json.Str(p, "parent");
                    long id = c.Insert("INSERT INTO places(parent_id, kind, name, code, created_at) VALUES(?, ?, ?, ?, ?)",
                        parent.Length > 0 ? (object)place[parent] : null, Json.Str(p, "kind"), Json.Str(p, "name"), Json.Str(p, "code"), cmd.At);
                    place[Json.Str(p, "id")] = id;
                    kindOf[Json.Str(p, "id")] = Json.Str(p, "kind");
                }
                Dictionary<string, long> item = new Dictionary<string, long>();
                long books = 0, stats = 0;
                foreach (string line in File.ReadLines(Path.Combine(gen, "items.jsonl")))
                {
                    Dictionary<string, object> it = (Dictionary<string, object>)Json.Parse(line);
                    List<object> stock = Json.Arr(it, "stock");
                    long home = 1;
                    foreach (object so in stock)
                    {
                        string pl = Json.Str((Dictionary<string, object>)so, "place");
                        if (kindOf[pl] == "shelf") { home = place[pl]; break; }
                    }
                    string kind = Json.Str(it, "type") == "stat" ? "stat" : "book";
                    if (kind == "book") books++; else stats++;
                    long id = c.Insert("INSERT INTO items(kind, code, title, author, brand, publisher, barcode, cat, cat_full, unit, home_place_id, " +
                        "price, price_w, cost, min_qty, note, created_at, updated_at, old_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        kind, Json.Str(it, "code"), Json.Str(it, "title"), Json.Str(it, "author"), Json.Str(it, "brand"), Json.Str(it, "publisher"),
                        Json.Str(it, "barcode"), Json.Str(it, "cat"), Json.Str(it, "catFull"), Json.Str(it, "unit"), home,
                        Json.Long(it, "price", 0), Json.Long(it, "priceW", 0), Json.Long(it, "cost", 0), Json.Long(it, "min", 0),
                        Json.Str(it, "note"), Json.Str(it, "created") + " 10:00:00", cmd.At, Json.Str(it, "id"));
                    item[Json.Str(it, "id")] = id;
                    foreach (object so in stock)
                    {
                        Dictionary<string, object> s = (Dictionary<string, object>)so;
                        long q = Json.Long(s, "qty", 0);
                        long pl = place[Json.Str(s, "place")];
                        c.Run("INSERT INTO item_stock(item_id, place_id, qty) VALUES(?, ?, ?)", id, pl, q);
                        c.Run("INSERT INTO stock_moves(op_id, at, item_id, place_id, delta, reason) VALUES(?, ?, ?, ?, ?, 'import')", cmd.OpId, cmd.At, id, pl, q);
                    }
                }
                Dictionary<string, long> cust = new Dictionary<string, long>();
                foreach (string line in File.ReadLines(Path.Combine(gen, "customers.jsonl")))
                {
                    Dictionary<string, object> cu = (Dictionary<string, object>)Json.Parse(line);
                    long bal = Json.Long(cu, "balance", 0);
                    long id = c.Insert("INSERT INTO customers(name, phone, wholesale, balance, created_at, updated_at, old_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
                        Json.Str(cu, "name"), Json.Str(cu, "phone"), Json.Bool(cu, "wholesale"), bal, cmd.At, cmd.At, Json.Str(cu, "id"));
                    if (bal != 0) c.Run("INSERT INTO customer_moves(op_id, at, customer_id, delta, reason) VALUES(?, ?, ?, ?, 'import')", cmd.OpId, cmd.At, id, bal);
                    cust[Json.Str(cu, "id")] = id;
                }
                Dictionary<long, long> byNo = new Dictionary<long, long>();
                long lastNo = 0;
                foreach (string line in File.ReadLines(Path.Combine(gen, "invoices.jsonl")))
                {
                    Dictionary<string, object> v = (Dictionary<string, object>)Json.Parse(line);
                    long no = Json.Long(v, "no", 0);
                    string cid = Json.Str(v, "customerId");
                    long refNo = Json.Long(v, "refNo", 0);
                    long id = c.Insert("INSERT INTO invoices(no, kind, ref_id, date, at, subtotal, discount, total, profit, method, mode, customer_id, " +
                        "paid, due, cash_back, debt_cut, source, old_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?)",
                        no, Json.Str(v, "kind"), refNo > 0 ? (object)byNo[refNo] : null, Json.Str(v, "date"), Json.Str(v, "at") + ":00",
                        Json.Long(v, "subtotal", 0), Json.Long(v, "discount", 0), Json.Long(v, "total", 0), Json.Long(v, "profit", 0),
                        Json.Str(v, "method"), Json.Str(v, "mode") == "wholesale" ? "wholesale" : "retail",
                        cid.Length > 0 ? (object)cust[cid] : null, Json.Long(v, "paid", 0), Json.Long(v, "due", 0),
                        Json.Long(v, "cashBack", 0), Json.Long(v, "debtCut", 0), Json.Str(v, "id"));
                    byNo[no] = id;
                    lastNo = Math.Max(lastNo, no);
                    int ln = 0;
                    foreach (object lo in Json.Arr(v, "items"))
                    {
                        Dictionary<string, object> l = (Dictionary<string, object>)lo;
                        long iid;
                        c.Run("INSERT INTO invoice_lines(invoice_id, line_no, item_id, kind, name, qty, price, cost) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                            id, ++ln, item.TryGetValue(Json.Str(l, "id"), out iid) ? (object)iid : null,
                            Json.Str(l, "type") == "stat" ? "stat" : "book", Json.Str(l, "name"), Json.Long(l, "qty", 0),
                            Json.Long(l, "price", 0), Json.Long(l, "cost", 0));
                    }
                }
                foreach (string line in File.ReadLines(Path.Combine(gen, "payments.jsonl")))
                {
                    Dictionary<string, object> p = (Dictionary<string, object>)Json.Parse(line);
                    c.Run("INSERT INTO payments(customer_id, amount, date, at, note, old_id) VALUES(?, ?, ?, ?, ?, ?)",
                        cust[Json.Str(p, "customerId")], Json.Long(p, "amount", 0), Json.Str(p, "date"), Json.Str(p, "at") + ":00",
                        Json.Str(p, "note"), Json.Str(p, "id"));
                }
                /* آخر بيع لكل صنف من الفواتير: تقرير الراكد يحتاجه */
                c.Run("UPDATE items SET last_sold = IFNULL((SELECT MAX(v.date) FROM invoice_lines l JOIN invoices v ON v.id = l.invoice_id " +
                    "WHERE l.item_id = items.id AND v.kind = 'sale'), '')");
                c.Run("UPDATE counters SET value = ? WHERE name = 'invoice'", lastNo);
                c.Run("UPDATE counters SET value = ? WHERE name = 'book'", books);
                c.Run("UPDATE counters SET value = ? WHERE name = 'stat'", stats);
                Schema.RebuildTriggers(c);
                return 0;
            });
            cmd.Detail = "استيراد مكتبة تجربة من " + gen;
        });
        d.Read<int>(delegate (Sqlite c) { c.Exec("ANALYZE"); return 0; });
    }
}
