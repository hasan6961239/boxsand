using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace Qirtasiya.Data
{
    /* تقرير المطابقة: كل رقم كما كان في 3.x وكما صار في القاعدة */
    public sealed class ImportReport
    {
        public sealed class Row
        {
            public string Name, Source, Db;
            public bool Ok;
        }

        public readonly List<Row> Rows = new List<Row>();
        public readonly List<string> Warnings = new List<string>();
        public long Ms;

        public bool AllOk
        {
            get
            {
                foreach (Row r in Rows) if (!r.Ok) return false;
                return true;
            }
        }

        public void Add(string name, string src, string db)
        {
            Row r = new Row();
            r.Name = name; r.Source = src; r.Db = db; r.Ok = src == db;
            Rows.Add(r);
        }

        public string ToText()
        {
            StringBuilder sb = new StringBuilder();
            foreach (Row r in Rows)
                sb.Append(r.Ok ? "  ✓ " : "  ✗ ").Append(r.Name).Append(": ").Append(r.Source)
                  .Append(r.Ok ? "" : " ← في القاعدة " + r.Db).Append('\n');
            if (Warnings.Count > 0)
            {
                sb.Append("  تنبيهات (").Append(Warnings.Count).Append("):\n");
                foreach (string w in Warnings) sb.Append("    - ").Append(w).Append('\n');
            }
            return sb.ToString();
        }

        public Dictionary<string, object> ToJson()
        {
            List<object> rows = new List<object>();
            foreach (Row r in Rows)
            {
                Dictionary<string, object> o = new Dictionary<string, object>();
                o["name"] = r.Name; o["source"] = r.Source; o["db"] = r.Db; o["ok"] = r.Ok;
                rows.Add(o);
            }
            Dictionary<string, object> j = new Dictionary<string, object>();
            j["ok"] = AllOk; j["rows"] = rows; j["warnings"] = new List<object>(Warnings.ToArray()); j["ms"] = Ms;
            return j;
        }
    }

    /* ============================================================
       نقل بيانات 3.x (store.json) إلى القاعدة الجديدة (المرحلة 2)
       ------------------------------------------------------------
       - معاملة واحدة: إما ينتقل كل شيء أو لا شيء.
       - بلا سجل تغييرات (قرار 0017): المكتبة المنقولة نقطة بداية.
       - لا يُغيَّر رقم مالي ولا تصنيف: المبالغ تتحول من دينار إلى درهم
         فقط، والتصنيف يبقى نصه كما هو.
       - ما لا يمكن نقله كما هو (باركود مكرر، سطر بكمية صفر...) يُنقل
         بأقرب شكل سليم، ويُكتب في التنبيهات بالاسم.
       - في الآخر: تقرير مطابقة تُحسب فيه أرقام القاعدة بـ SQL منفصل عن
         أرقام الملف، فالمطابقة حقيقية لا نسخة من نفسها.
       ============================================================ */
    public sealed partial class ShopDb
    {
        public ImportReport Import3x(string storeJson, long userId)
        {
            Stopwatch sw = Stopwatch.StartNew();
            Dictionary<string, object> s;
            try { s = Json.Parse(storeJson) as Dictionary<string, object>; }
            catch (FormatException e) { throw Err("ملف البيانات ليس JSON صالحاً: " + e.Message); }
            if (s == null || !s.ContainsKey("books")) throw Err("هذا ليس ملف بيانات المنظومة 3.x.");

            ImportReport rep = new ImportReport();
            Run("import3x", userId, delegate (Cmd c)
            {
                if (db.Long("SELECT (SELECT COUNT(*) FROM items) + (SELECT COUNT(*) FROM invoices) + (SELECT COUNT(*) FROM customers)", 0) > 0)
                    throw Err("القاعدة الجديدة فيها بيانات. النقل يكون مرة واحدة على قاعدة فارغة.");
                foreach (object[] t in db.Rows("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'log\\_%' ESCAPE '\\'"))
                    db.Exec("DROP TRIGGER \"" + t[0] + "\"");
                new Importer(this, c, s, rep).Run();
                Schema.RebuildTriggers(db);
                RebuildSearch();
                Reconcile(s, rep);
                c.Detail = "نقل بيانات 3.x: " + Json.Arr(s, "books").Count + " كتاب، " + Json.Arr(s, "stationery").Count +
                    " صنف قرطاسية، " + Json.Arr(s, "invoices").Count + " فاتورة" +
                    (rep.Warnings.Count > 0 ? " — " + rep.Warnings.Count + " تنبيه" : "");
            });
            rep.Ms = sw.ElapsedMilliseconds;
            return rep;
        }

        /* ---------- التحويلات ---------- */

        /* دينار (رقم أو نص بأرقام عربية) ← درهم، نصف الدرهم للأعلى */
        internal static long Dh(object v)
        {
            if (v == null) return 0;
            if (v is long) return (long)v * 1000;
            if (v is double) return (long)Math.Round((decimal)(double)v * 1000m, MidpointRounding.AwayFromZero);
            if (v is bool) return 0;
            string t = Digits(Convert.ToString(v, CultureInfo.InvariantCulture));
            decimal d;
            if (decimal.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out d))
                return (long)Math.Round(d * 1000m, MidpointRounding.AwayFromZero);
            return 0;
        }

        internal static long Qty(object v, out bool frac)
        {
            frac = false;
            if (v == null || v is bool) return 0;
            if (v is long) return (long)v;
            double d;
            if (v is double) d = (double)v;
            else if (!double.TryParse(Digits(Convert.ToString(v, CultureInfo.InvariantCulture)), NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return 0;
            long r = (long)Math.Round(d, MidpointRounding.AwayFromZero);
            frac = Math.Abs(d - r) > 1e-9;
            return r;
        }

        /* «١٢٫٥» ← «12.5» */
        static string Digits(string t)
        {
            if (string.IsNullOrEmpty(t)) return "";
            StringBuilder sb = new StringBuilder(t.Length);
            foreach (char ch in t)
            {
                if (ch >= '٠' && ch <= '٩') sb.Append((char)('0' + (ch - '٠')));
                else if (ch >= '۰' && ch <= '۹') sb.Append((char)('0' + (ch - '۰')));
                else if (ch == '٫') sb.Append('.');
                else if (ch != '٬' && ch != ',') sb.Append(ch);
            }
            return sb.ToString().Trim();
        }

        /* «2026-10-24 20:05» ← «2026-10-24 20:05:00» */
        internal static string Stamp3(string at, string def)
        {
            if (string.IsNullOrEmpty(at)) return def;
            at = at.Trim().Replace('T', ' ');
            if (at.Length == 10) return at + " 00:00:00";
            if (at.Length == 16) return at + ":00";
            return at.Length > 19 ? at.Substring(0, 19) : at;
        }

        static string Day3(string d, string def)
        {
            if (string.IsNullOrEmpty(d)) return def;
            return d.Length >= 10 ? d.Substring(0, 10) : d;
        }

        /* ---------- المطابقة ---------- */

        void Reconcile(Dictionary<string, object> s, ImportReport rep)
        {
            List<object> books = Json.Arr(s, "books"), stat = Json.Arr(s, "stationery");
            long shop = 0, room = 0, value = 0;
            foreach (List<object> list in new List<object>[] { books, stat })
                foreach (object o in list)
                {
                    Dictionary<string, object> it = o as Dictionary<string, object>;
                    if (it == null) continue;
                    bool f;
                    long q = Qty(Json.Get(it, "qty"), out f);
                    shop += q;
                    room += StoreQty(it);
                    value += q * Math.Max(Dh(Json.Get(it, "cost")), 0);
                }
            long wh = 0;
            foreach (object o in Json.Arr(s, "warehouses"))
                foreach (object x in Json.Arr(o as Dictionary<string, object>, "stock"))
                {
                    bool f;
                    wh += Qty(Json.Get(x as Dictionary<string, object>, "qty"), out f);
                }
            long debt = 0;
            foreach (object o in Json.Arr(s, "customers")) debt += Dh(Json.Get(o as Dictionary<string, object>, "balance"));
            long sales = 0, rets = 0, net = 0, prof = 0;
            foreach (object o in Json.Arr(s, "invoices"))
            {
                Dictionary<string, object> v = o as Dictionary<string, object>;
                if (v == null) continue;
                if (Json.Str(v, "kind") == "return") rets++; else sales++;
                net += Dh(Json.Get(v, "total"));
                prof += Dh(Json.Get(v, "profit"));
            }
            long pays = 0, payN = 0;
            foreach (object o in Json.Arr(s, "payments")) { payN++; pays += Dh(Json.Get(o as Dictionary<string, object>, "amount")); }
            long purN = 0, pur = 0;
            foreach (object o in Json.Arr(s, "purchases")) { purN++; pur += Dh(Json.Get(o as Dictionary<string, object>, "total")); }
            long consDue = 0;
            foreach (object o in Json.Arr(s, "consignments"))
            {
                Dictionary<string, object> l = o as Dictionary<string, object>;
                bool f;
                consDue += Qty(Json.Get(l, "sold"), out f) * Dh(Json.Get(l, "ownerPrice"));
            }
            foreach (object o in Json.Arr(s, "consPayments")) consDue -= Dh(Json.Get(o as Dictionary<string, object>, "amount"));

            rep.Add("الكتب", N(books.Count), N(db.Long("SELECT COUNT(*) FROM items WHERE kind = 'book'", 0)));
            rep.Add("أصناف القرطاسية", N(stat.Count), N(db.Long("SELECT COUNT(*) FROM items WHERE kind = 'stat'", 0)));
            rep.Add("النسخ في المحل (الرفوف وغرفة الخزين)", N(shop), N(db.Long(
                "SELECT IFNULL(SUM(s.qty), 0) FROM item_stock s JOIN places p ON p.id = s.place_id WHERE p.kind <> 'store'", 0)));
            rep.Add("منها في غرفة الخزين", N(room), N(db.Long(
                "SELECT IFNULL(SUM(s.qty), 0) FROM item_stock s JOIN places p ON p.id = s.place_id WHERE p.kind = 'room'", 0)));
            rep.Add("النسخ في المخازن", N(wh), N(db.Long(
                "SELECT IFNULL(SUM(s.qty), 0) FROM item_stock s JOIN places p ON p.id = s.place_id WHERE p.kind = 'store'", 0)));
            rep.Add("قيمة ما في المحل بسعر الشراء", Money(value), Money(db.Long(
                "SELECT IFNULL(SUM(s.qty * i.cost), 0) FROM item_stock s JOIN places p ON p.id = s.place_id JOIN items i ON i.id = s.item_id WHERE p.kind <> 'store'", 0)));
            rep.Add("الزبائن", N(Json.Arr(s, "customers").Count), N(db.Long("SELECT COUNT(*) FROM customers", 0)));
            rep.Add("مجموع الديون", Money(debt), Money(db.Long("SELECT IFNULL(SUM(balance), 0) FROM customers", 0)));
            rep.Add("فواتير البيع", N(sales), N(db.Long("SELECT COUNT(*) FROM invoices WHERE kind = 'sale'", 0)));
            rep.Add("عمليات الإرجاع", N(rets), N(db.Long("SELECT COUNT(*) FROM invoices WHERE kind = 'return'", 0)));
            rep.Add("صافي المبيعات", Money(net), Money(db.Long("SELECT IFNULL(SUM(total), 0) FROM invoices", 0)));
            rep.Add("صافي الربح", Money(prof), Money(db.Long("SELECT IFNULL(SUM(profit), 0) FROM invoices", 0)));
            rep.Add("تسديدات الديون", N(payN) + " بـ " + Money(pays),
                N(db.Long("SELECT COUNT(*) FROM payments", 0)) + " بـ " + Money(db.Long("SELECT IFNULL(SUM(amount), 0) FROM payments", 0)));
            rep.Add("إدخالات البضاعة", N(purN) + " بـ " + Money(pur),
                N(db.Long("SELECT COUNT(*) FROM purchases", 0)) + " بـ " + Money(db.Long("SELECT IFNULL(SUM(total), 0) FROM purchases", 0)));
            rep.Add("المستحق لأصحاب الكتب على المباع", Money(consDue), Money(db.Long(
                "SELECT IFNULL((SELECT SUM(sold * owner_price) FROM consignments), 0) - IFNULL((SELECT SUM(amount) FROM consignment_payments), 0)", 0)));
            rep.Add("سجل العمليات", N(Json.Arr(s, "log").Count), N(db.Long("SELECT COUNT(*) FROM ops WHERE kind = 'log3'", 0)));
        }

        static string N(long n) { return n.ToString("#,0", CultureInfo.InvariantCulture); }

        /* كما في 3.x: الجزء في غرفة الخزين لا يزيد على الكمية ولا يقل عن صفر */
        internal static long StoreQty(Dictionary<string, object> it)
        {
            bool f;
            long st = Qty(Json.Get(it, "store"), out f), q = Qty(Json.Get(it, "qty"), out f);
            return st > 0 ? Math.Min(st, Math.Max(q, 0)) : 0;
        }

        /* ---------- النقل نفسه ---------- */

        sealed class Importer
        {
            readonly ShopDb d;
            readonly Sqlite db;
            readonly Cmd c;
            readonly Dictionary<string, object> s;
            readonly ImportReport rep;

            readonly Dictionary<string, long> cabinet = new Dictionary<string, long>();
            readonly Dictionary<string, long> shelf = new Dictionary<string, long>();
            long room;
            readonly Dictionary<string, long> warehouse = new Dictionary<string, long>();
            readonly Dictionary<string, long> item = new Dictionary<string, long>();      // "book:id" / "stat:id"
            readonly Dictionary<string, long> itemAny = new Dictionary<string, long>();   // id وحده
            readonly Dictionary<long, long> homeOf = new Dictionary<long, long>();
            readonly Dictionary<string, long> supplier = new Dictionary<string, long>();
            readonly Dictionary<string, long> customer = new Dictionary<string, long>();
            readonly Dictionary<string, long> consignor = new Dictionary<string, long>();
            readonly Dictionary<long, long> invoiceByNo = new Dictionary<long, long>();
            long maxNo;

            public Importer(ShopDb shop, Cmd cmd, Dictionary<string, object> store, ImportReport r)
            {
                d = shop; db = shop.db; c = cmd; s = store; rep = r;
            }

            void Warn(string w) { rep.Warnings.Add(w); }

            static Dictionary<string, object> O(object v) { return v as Dictionary<string, object>; }

            public void Run()
            {
                Settings();
                Counters();
                Places();
                Suppliers();
                Items("book", Json.Arr(s, "books"));
                Items("stat", Json.Arr(s, "stationery"));
                WarehouseStock();
                Customers();
                Invoices();
                Payments();
                Purchases();
                Consignment();
                Closings();
                Counts();
                Messages();
                Log();
                db.Run("UPDATE counters SET value = MAX(value, ?) WHERE name = 'invoice'", maxNo);
            }

            /* الإعدادات كما هي، كل قسم في صف. ما لا نعرفه يُحفظ أيضاً فلا يضيع شيء */
            void Settings()
            {
                string[] known = { "meta", "branch", "sync", "notify", "phoneDone" };
                string[] handled = { "consignors", "consignments", "consPayments", "closings", "publishers", "remotes", "warehouses",
                    "outbox", "books", "stationery", "customers", "suppliers", "invoices", "payments", "purchases", "log",
                    "counters", "counts", "countSession" };
                foreach (KeyValuePair<string, object> kv in s)
                {
                    bool k = Array.IndexOf(known, kv.Key) >= 0;
                    if (!k && Array.IndexOf(handled, kv.Key) >= 0) continue;
                    if (kv.Value == null) continue;
                    db.Run("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        k ? kv.Key : "x3." + kv.Key, Json.Write(kv.Value));
                }
                Dictionary<string, object> meta = Json.Obj(s, "meta");
                foreach (string kind in new string[] { "book", "stat" })
                {
                    List<string> seen = new List<string>();
                    int sort = 0;
                    foreach (object o in Json.Arr(meta, kind == "book" ? "bookCats" : "statCats"))
                    {
                        string n = (Convert.ToString(o, CultureInfo.InvariantCulture) ?? "").Trim();
                        if (n.Length == 0 || seen.Contains(n)) continue;
                        seen.Add(n);
                        db.Run("INSERT INTO categories(kind, name, sort) VALUES(?, ?, ?)", kind, n, ++sort);
                    }
                }
                foreach (object o in Json.Arr(s, "publishers"))
                {
                    Dictionary<string, object> p = O(o);
                    string name = Json.Str(p, "name").Trim();
                    if (name.Length == 0) continue;
                    if (db.Long("SELECT COUNT(*) FROM publishers WHERE name = ?", 0, name) > 0) { Warn("دار نشر مكررة «" + name + "»: أُبقيت الأولى"); continue; }
                    long bp = (long)Math.Round(Json.Num(p, "rate", 0) * 10000, MidpointRounding.AwayFromZero);
                    db.Run("INSERT INTO publishers(name, rate_bp, mode, phone, note, created_at, old_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
                        name, Math.Min(Math.Max(bp, 0), 10000), Json.Str(p, "mode").Length > 0 ? Json.Str(p, "mode") : "margin",
                        Json.Str(p, "phone"), Json.Str(p, "note"), c.At, Json.Str(p, "id"));
                }
            }

            void Counters()
            {
                Dictionary<string, object> ct = Json.Obj(s, "counters");
                db.Run("UPDATE counters SET value = ? WHERE name = 'book'", Math.Max(Json.Long(ct, "book", 0), 0));
                db.Run("UPDATE counters SET value = ? WHERE name = 'stat'", Math.Max(Json.Long(ct, "stat", 0), 0));
                db.Run("UPDATE counters SET value = ? WHERE name = 'invoice'", Math.Max(Json.Long(ct, "invoice", 0), 0));
            }

            /* الخزائن ورفوفها من الإعدادات (كما تعرضها 3.x)، وغرفة الخزين، والمخازن */
            void Places()
            {
                Dictionary<string, object> meta = Json.Obj(s, "meta");
                long shelves = Math.Max(Json.Long(meta, "shelves", 6), 1);
                foreach (object o in Json.Arr(meta, "libraries"))
                {
                    string lib = (Convert.ToString(o, CultureInfo.InvariantCulture) ?? "").Trim();
                    if (lib.Length == 0 || cabinet.ContainsKey(lib)) continue;
                    long cab = Cabinet(lib);
                    for (int n = 1; n <= shelves; n++) Shelf(lib, n.ToString(CultureInfo.InvariantCulture), cab);
                }
                room = db.Insert("INSERT INTO places(parent_id, kind, name, code, sort, created_at) VALUES(1, 'room', 'غرفة الخزين', 'خزين', 900, ?)", c.At);
                int k = 0;
                foreach (object o in Json.Arr(s, "warehouses"))
                {
                    Dictionary<string, object> w = O(o);
                    string id = Json.Str(w, "id");
                    long p = db.Insert("INSERT INTO places(parent_id, kind, name, code, sort, phone, address, note, created_at) VALUES(NULL, 'store', ?, '', ?, ?, ?, ?, ?)",
                        Json.Str(w, "name").Length > 0 ? Json.Str(w, "name") : "مخزن", 1000 + (++k), Json.Str(w, "phone"), Json.Str(w, "place"), Json.Str(w, "note"), c.At);
                    if (id.Length > 0) warehouse[id] = p;
                }
            }

            long Cabinet(string lib)
            {
                long id;
                if (cabinet.TryGetValue(lib, out id)) return id;
                id = db.Insert("INSERT INTO places(parent_id, kind, name, code, sort, created_at) VALUES(1, 'cabinet', ?, ?, ?, ?)",
                    "خزانة " + lib, lib, cabinet.Count + 1, c.At);
                cabinet[lib] = id;
                return id;
            }

            long Shelf(string lib, string n, long cab)
            {
                long id;
                string key = lib + "/" + n;
                if (shelf.TryGetValue(key, out id)) return id;
                int sort;
                int.TryParse(n, out sort);
                id = db.Insert("INSERT INTO places(parent_id, kind, name, code, sort, created_at) VALUES(?, 'shelf', ?, ?, ?, ?)",
                    cab, "رف " + n, n, sort, c.At);
                shelf[key] = id;
                return id;
            }

            void Suppliers()
            {
                foreach (object o in Json.Arr(s, "suppliers"))
                {
                    Dictionary<string, object> p = O(o);
                    string name = Json.Str(p, "name").Trim();
                    if (name.Length == 0) name = "(مورّد بلا اسم)";
                    long id = db.Insert("INSERT INTO suppliers(name, phone, city, note, created_at, old_id) VALUES(?, ?, ?, ?, ?, ?)",
                        name, Json.Str(p, "phone"), Json.Str(p, "city"), Json.Str(p, "note"), c.At, Json.Str(p, "id"));
                    supplier[Json.Str(p, "id")] = id;
                }
            }

            void Items(string kind, List<object> list)
            {
                Dictionary<string, string> barcodes = new Dictionary<string, string>();
                foreach (object[] r in db.Rows("SELECT barcode, title FROM items WHERE barcode <> ''")) barcodes[(string)r[0]] = (string)r[1];
                foreach (object o in list)
                {
                    Dictionary<string, object> it = O(o);
                    if (it == null) continue;
                    string oid = Json.Str(it, "id");
                    string title = Json.Str(it, kind == "book" ? "title" : "name").Trim();
                    if (title.Length == 0) { title = "(بلا اسم " + Json.Str(it, "code") + ")"; Warn("صنف بلا اسم، رمزه " + Json.Str(it, "code") + ": سُمّي «" + title + "»"); }

                    string code = Json.Str(it, "code").Trim();
                    if (code.Length == 0) code = d.NextItemCode(kind);
                    else if (db.Long("SELECT COUNT(*) FROM items WHERE code = ?", 0, code) > 0)
                    {
                        string nc = d.NextItemCode(kind);
                        Warn("الرمز " + code + " مكرر: أُعطي «" + title + "» الرمز " + nc);
                        code = nc;
                    }
                    string bc = Json.Str(it, "barcode").Trim();
                    if (bc.Length > 0 && barcodes.ContainsKey(bc))
                    {
                        Warn("الباركود " + bc + " مكرر: بقي على «" + barcodes[bc] + "» وأُزيل من «" + title + "»");
                        bc = "";
                    }
                    if (bc.Length > 0) barcodes[bc] = title;

                    long price = Dh(Json.Get(it, "price")), priceW = Dh(Json.Get(it, "priceW")), cost = Dh(Json.Get(it, "cost"));
                    bool frac;
                    long min = Qty(Json.Get(it, "min"), out frac);
                    if (price < 0 || priceW < 0 || cost < 0 || min < 0)
                    {
                        Warn("قيمة سالبة في «" + title + "» صارت صفراً");
                        price = Math.Max(price, 0); priceW = Math.Max(priceW, 0); cost = Math.Max(cost, 0); min = Math.Max(min, 0);
                    }
                    long home = 1;
                    if (kind == "book")
                    {
                        string lib = Json.Str(it, "lib").Trim(), sh = Json.Str(it, "shelf").Trim();
                        if (lib.Length > 0) home = sh.Length > 0 ? Shelf(lib, sh, Cabinet(lib)) : Cabinet(lib);
                    }
                    string sup = Json.Str(it, "supplierId");
                    long supId;
                    object supRef = sup.Length > 0 && supplier.TryGetValue(sup, out supId) ? (object)supId : null;
                    string created = Stamp3(Json.Str(it, "created"), c.At);

                    long id = db.Insert("INSERT INTO items(kind, code, title, author, brand, publisher, barcode, cat, cat_full, unit, loc_note, " +
                        "home_place_id, supplier_id, price, price_w, cost, min_qty, note, last_sold, sold_total, label_printed, created_at, updated_at, old_id) " +
                        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        kind, code, title, kind == "book" ? Json.Str(it, "author") : "", kind == "stat" ? Json.Str(it, "brand") : "",
                        Json.Str(it, "publisher"), bc, Json.Str(it, "cat"), Json.Str(it, "catFull"), Json.Str(it, "unit"),
                        kind == "stat" ? Json.Str(it, "loc") : "", home, supRef, price, priceW, cost, min, Json.Str(it, "note"),
                        Day3(Json.Str(it, "lastSold"), ""), Math.Max(Qty(Json.Get(it, "soldTotal"), out frac), 0),
                        Json.Str(it, "labelPrinted"), created, Stamp3(Json.Str(it, "updated"), created), oid);
                    item[kind + ":" + oid] = id;
                    if (!itemAny.ContainsKey(oid)) itemAny[oid] = id;
                    homeOf[id] = home;

                    long qty = Qty(Json.Get(it, "qty"), out frac);
                    if (frac) Warn("كمية بكسر في «" + title + "» قُرّبت إلى " + qty);
                    long st = StoreQty(it);
                    d.AddStock(c, id, home, qty - st, "import", "", 0);
                    d.AddStock(c, id, room, st, "import", "", 0);
                }
            }

            long Item(string type, string id)
            {
                long v;
                if (item.TryGetValue((type == "stat" ? "stat" : "book") + ":" + id, out v)) return v;
                if (itemAny.TryGetValue(id, out v)) return v;
                return 0;
            }

            void WarehouseStock()
            {
                foreach (object o in Json.Arr(s, "warehouses"))
                {
                    Dictionary<string, object> w = O(o);
                    long place;
                    if (!warehouse.TryGetValue(Json.Str(w, "id"), out place)) continue;
                    foreach (object x in Json.Arr(w, "stock"))
                    {
                        Dictionary<string, object> e = O(x);
                        long it = Item(Json.Str(e, "type"), Json.Str(e, "itemId"));
                        bool frac;
                        long q = Qty(Json.Get(e, "qty"), out frac);
                        if (it == 0) { if (q != 0) Warn("في «" + Json.Str(w, "name") + "» " + q + " قطعة لصنف محذوف: لم تُنقل"); continue; }
                        d.AddStock(c, it, place, q, "import", "", 0);
                    }
                }
            }

            void Customers()
            {
                foreach (object o in Json.Arr(s, "customers"))
                {
                    Dictionary<string, object> p = O(o);
                    string name = Json.Str(p, "name").Trim();
                    if (name.Length == 0) name = "(زبون بلا اسم)";
                    long bal = Dh(Json.Get(p, "balance"));
                    string created = Stamp3(Json.Str(p, "created"), c.At);
                    long id = db.Insert("INSERT INTO customers(name, phone, note, wholesale, balance, created_at, updated_at, old_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                        name, Json.Str(p, "phone"), Json.Str(p, "note"), Json.Bool(p, "wholesale"), bal, created, created, Json.Str(p, "id"));
                    if (bal != 0)
                        db.Run("INSERT INTO customer_moves(op_id, at, customer_id, delta, reason) VALUES(?, ?, ?, ?, 'import')", c.OpId, c.At, id, bal);
                    customer[Json.Str(p, "id")] = id;
                }
            }

            object CustomerRef(string id, string where)
            {
                if (id.Length == 0) return null;
                long v;
                if (customer.TryGetValue(id, out v)) return v;
                Warn(where + ": الزبون غير موجود في الملف، فنُقلت بلا زبون");
                return null;
            }

            /* بالترتيب من الأقدم: الإرجاع يجد فاتورته الأصلية قبله */
            void Invoices()
            {
                List<Dictionary<string, object>> all = new List<Dictionary<string, object>>();
                foreach (object o in Json.Arr(s, "invoices")) if (O(o) != null) all.Add(O(o));
                all.Sort(delegate (Dictionary<string, object> a, Dictionary<string, object> b)
                {
                    int x = Json.Long(a, "no", 0).CompareTo(Json.Long(b, "no", 0));
                    return x != 0 ? x : string.CompareOrdinal(Json.Str(a, "at"), Json.Str(b, "at"));
                });
                foreach (Dictionary<string, object> v in all) maxNo = Math.Max(maxNo, Json.Long(v, "no", 0));
                List<Dictionary<string, object>> renumber = new List<Dictionary<string, object>>();
                foreach (Dictionary<string, object> v in all)
                {
                    long no = Json.Long(v, "no", 0);
                    if (no <= 0 || invoiceByNo.ContainsKey(no)) { renumber.Add(v); continue; }
                    Invoice(v, no);
                }
                foreach (Dictionary<string, object> v in renumber)
                {
                    long no = ++maxNo;
                    Warn("فاتورة برقم مكرر أو بلا رقم (" + Json.Long(v, "no", 0) + "، " + Json.Str(v, "at") + "): أخذت الرقم " + no);
                    Invoice(v, no);
                }
            }

            void Invoice(Dictionary<string, object> v, long no)
            {
                string kind = Json.Str(v, "kind") == "return" ? "return" : "sale";
                string where = (kind == "return" ? "الإرجاع " : "الفاتورة ") + no;
                List<object> lines = Json.Arr(v, "items");
                List<object[]> keep = new List<object[]>();
                foreach (object o in lines)
                {
                    Dictionary<string, object> l = O(o);
                    if (l == null) continue;
                    bool frac;
                    long q = Qty(Json.Get(l, "qty"), out frac);
                    if (q <= 0) { Warn(where + ": سطر «" + Json.Str(l, "name") + "» بكمية " + Json.Str(l, "qty") + " لم يُنقل"); continue; }
                    if (frac) Warn(where + ": كمية بكسر في «" + Json.Str(l, "name") + "» قُرّبت إلى " + q);
                    long it = Item(Json.Str(l, "type"), Json.Str(l, "id"));
                    keep.Add(new object[] { it > 0 ? (object)it : null, Json.Str(l, "type") == "stat" ? "stat" : "book",
                        Json.Str(l, "name"), q, Dh(Json.Get(l, "price")), Dh(Json.Get(l, "cost")) });
                }
                if (keep.Count == 0) { Warn(where + " بلا أسطر صالحة: لم تُنقل (قيمتها " + Money(Dh(Json.Get(v, "total"))) + ")"); return; }

                string method = Json.Str(v, "method");
                if (method != "cash" && method != "card" && method != "credit") { Warn(where + ": طريقة دفع «" + method + "» سُجّلت نقداً"); method = "cash"; }
                object cust = CustomerRef(Json.Str(v, "customerId"), where);
                long total = Dh(Json.Get(v, "total"));
                long cashBack = Dh(Json.Get(v, "cashBack")), debtCut = Dh(Json.Get(v, "debtCut"));
                /* إرجاع من نسخة قديمة بلا debtCut: 3.x وقتها أنقص الدين بقيمته كلها إن
                   كان له زبون، وإلا ردّها نقداً. نسجّل ما حدث فعلاً */
                if (kind == "return" && !v.ContainsKey("debtCut"))
                {
                    if (cust != null) { debtCut = Math.Abs(total); cashBack = 0; }
                    else { cashBack = Math.Abs(total); debtCut = 0; }
                }
                object refId = null;
                long refNo = Json.Long(v, "refNo", 0);
                if (kind == "return" && refNo > 0)
                {
                    long r;
                    if (invoiceByNo.TryGetValue(refNo, out r)) refId = r;
                    else Warn(where + ": فاتورته الأصلية " + refNo + " غير موجودة (ربما أُرشفت أو حُذفت)");
                }
                string at = Stamp3(Json.Str(v, "at"), c.At);
                long id = db.Insert("INSERT INTO invoices(no, kind, ref_id, date, at, subtotal, discount, total, profit, method, mode, customer_id, " +
                    "paid, due, cash_back, debt_cut, source, device, phone_id, note, edited_at, old_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    no, kind, refId, Day3(Json.Str(v, "date"), at.Substring(0, 10)), at,
                    Dh(Json.Get(v, "subtotal")), Dh(Json.Get(v, "discount")), total, Dh(Json.Get(v, "profit")), method,
                    Json.Str(v, "mode") == "wholesale" ? "wholesale" : "retail", cust, Dh(Json.Get(v, "paid")), Dh(Json.Get(v, "due")),
                    cashBack, debtCut, Json.Str(v, "source").Length > 0 ? Json.Str(v, "source") : "pos", Json.Str(v, "device"),
                    PhoneId(Json.Str(v, "phoneId"), where), Json.Str(v, "note"), Stamp3(Json.Str(v, "editedAt"), ""), Json.Str(v, "id"));
                invoiceByNo[no] = id;
                for (int i = 0; i < keep.Count; i++)
                {
                    object[] l = keep[i];
                    db.Run("INSERT INTO invoice_lines(invoice_id, line_no, item_id, kind, name, qty, price, cost) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                        id, i + 1, l[0], l[1], l[2], l[3], l[4], l[5]);
                }
            }

            string PhoneId(string p, string where)
            {
                if (p.Length == 0) return "";
                if (db.Long("SELECT COUNT(*) FROM invoices WHERE phone_id = ?", 0, p) == 0) return p;
                Warn(where + ": طلب التلفون " + p + " مسجّل في فاتورة أخرى قبلها");
                return "";
            }

            void Payments()
            {
                foreach (object o in Json.Arr(s, "payments"))
                {
                    Dictionary<string, object> p = O(o);
                    long amt = Dh(Json.Get(p, "amount"));
                    long cu;
                    if (!customer.TryGetValue(Json.Str(p, "customerId"), out cu)) { Warn("تسديد بـ " + Money(amt) + " لزبون غير موجود في الملف: لم يُنقل"); continue; }
                    if (amt <= 0) { Warn("تسديد بمبلغ " + Money(amt) + ": لم يُنقل"); continue; }
                    string at = Stamp3(Json.Str(p, "at"), c.At);
                    db.Run("INSERT INTO payments(customer_id, amount, date, at, note, old_id) VALUES(?, ?, ?, ?, ?, ?)",
                        cu, amt, Day3(Json.Str(p, "date"), at.Substring(0, 10)), at, Json.Str(p, "note"), Json.Str(p, "id"));
                }
            }

            void Purchases()
            {
                foreach (object o in Json.Arr(s, "purchases"))
                {
                    Dictionary<string, object> p = O(o);
                    long sup;
                    object supRef = supplier.TryGetValue(Json.Str(p, "supplierId"), out sup) ? (object)sup : null;
                    string at = Stamp3(Json.Str(p, "at"), c.At);
                    long id = db.Insert("INSERT INTO purchases(date, at, supplier_id, note, total, old_id) VALUES(?, ?, ?, ?, ?, ?)",
                        Day3(Json.Str(p, "date"), at.Substring(0, 10)), at, supRef, Json.Str(p, "note"), Dh(Json.Get(p, "total")), Json.Str(p, "id"));
                    int n = 0;
                    foreach (object x in Json.Arr(p, "lines"))
                    {
                        Dictionary<string, object> l = O(x);
                        bool frac;
                        long q = Qty(Json.Get(l, "qty"), out frac), st = Math.Min(Math.Max(Qty(Json.Get(l, "st"), out frac), 0), Math.Max(q, 0));
                        if (q <= 0) continue;
                        long it = Item(Json.Str(l, "type"), Json.Str(l, "id"));
                        long cost = Math.Max(Dh(Json.Get(l, "cost")), 0);
                        object home = it > 0 ? (object)homeOf[it] : null;
                        if (q - st > 0)
                            db.Run("INSERT INTO purchase_lines(purchase_id, line_no, item_id, name, qty, cost, place_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
                                id, ++n, it > 0 ? (object)it : null, Json.Str(l, "name"), q - st, cost, home);
                        if (st > 0)
                            db.Run("INSERT INTO purchase_lines(purchase_id, line_no, item_id, name, qty, cost, place_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
                                id, ++n, it > 0 ? (object)it : null, Json.Str(l, "name"), st, cost, room);
                    }
                }
            }

            void Consignment()
            {
                foreach (object o in Json.Arr(s, "consignors"))
                {
                    Dictionary<string, object> p = O(o);
                    long id = db.Insert("INSERT INTO consignors(name, phone, note, created_at, old_id) VALUES(?, ?, ?, ?, ?)",
                        Json.Str(p, "name").Length > 0 ? Json.Str(p, "name") : "(بلا اسم)", Json.Str(p, "phone"), Json.Str(p, "note"),
                        Stamp3(Json.Str(p, "at"), c.At), Json.Str(p, "id"));
                    consignor[Json.Str(p, "id")] = id;
                }
                Dictionary<long, bool> used = new Dictionary<long, bool>();
                foreach (object o in Json.Arr(s, "consignments"))
                {
                    Dictionary<string, object> l = O(o);
                    long owner;
                    if (!consignor.TryGetValue(Json.Str(l, "ownerId"), out owner)) { Warn("كتاب على المباع «" + Json.Str(l, "title") + "» بلا صاحب: لم يُنقل"); continue; }
                    long it = Item(Json.Str(l, "type"), Json.Str(l, "itemId"));
                    if (it > 0 && used.ContainsKey(it)) { Warn("سطران على المباع للصنف نفسه «" + Json.Str(l, "title") + "»: الثاني بلا ربط بالصنف"); it = 0; }
                    if (it > 0) used[it] = true;
                    bool frac;
                    db.Run("INSERT INTO consignments(consignor_id, item_id, kind, title, author, code, qty, sold, returned, price, owner_price, date, note, old_id) " +
                        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", owner, it > 0 ? (object)it : null,
                        Json.Str(l, "type") == "stat" ? "stat" : "book", Json.Str(l, "title"), Json.Str(l, "author"), Json.Str(l, "code"),
                        Math.Max(Qty(Json.Get(l, "qty"), out frac), 0), Math.Max(Qty(Json.Get(l, "sold"), out frac), 0),
                        Math.Max(Qty(Json.Get(l, "returned"), out frac), 0), Dh(Json.Get(l, "price")), Dh(Json.Get(l, "ownerPrice")),
                        Day3(Json.Str(l, "at"), c.Date), Json.Str(l, "note"), Json.Str(l, "id"));
                }
                foreach (object o in Json.Arr(s, "consPayments"))
                {
                    Dictionary<string, object> p = O(o);
                    long owner, amt = Dh(Json.Get(p, "amount"));
                    if (!consignor.TryGetValue(Json.Str(p, "ownerId"), out owner) || amt <= 0) { Warn("تسديد على المباع بـ " + Money(amt) + " لم يُنقل"); continue; }
                    string at = Stamp3(Json.Str(p, "at"), c.At);
                    db.Run("INSERT INTO consignment_payments(consignor_id, amount, date, at, note, from_drawer, old_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
                        owner, amt, Day3(Json.Str(p, "date"), at.Substring(0, 10)), at, Json.Str(p, "note"),
                        !p.ContainsKey("fromDrawer") || Json.Bool(p, "fromDrawer"), Json.Str(p, "id"));
                }
            }

            void Closings()
            {
                foreach (object o in Json.Arr(s, "closings"))
                {
                    Dictionary<string, object> p = O(o);
                    long exp = Dh(Json.Get(p, "expected")), cnt = Dh(Json.Get(p, "counted"));
                    db.Run("INSERT INTO day_closings(date, kind, expected, counted, diff, at, old_id) VALUES(?, ?, ?, ?, ?, ?, ?) " +
                        "ON CONFLICT(date) DO NOTHING", Day3(Json.Str(p, "date"), c.Date), Json.Str(p, "kind").Length > 0 ? Json.Str(p, "kind") : "day",
                        exp, cnt, cnt - exp, Stamp3(Json.Str(p, "at"), c.At), Json.Str(p, "id"));
                }
            }

            void Counts()
            {
                foreach (object o in Json.Arr(s, "counts"))
                {
                    Dictionary<string, object> p = O(o);
                    bool frac;
                    string done = Stamp3(Json.Str(p, "doneAt"), c.At);
                    long id = db.Insert("INSERT INTO count_sessions(started_at, done_at, status, scope, scope_value, n_items, done, ok, less, more, loss_qty, loss_val, old_id) " +
                        "VALUES(?, ?, 'applied', ?, '', ?, ?, ?, ?, ?, ?, ?, ?)", Stamp3(Json.Str(p, "at"), c.At), done,
                        Json.Str(p, "scope").Length > 0 ? Json.Str(p, "scope") : "all", Json.Long(p, "total", 0), Json.Long(p, "done", 0),
                        Json.Long(p, "ok", 0), Json.Long(p, "less", 0), Json.Long(p, "more", 0), Qty(Json.Get(p, "lossQty"), out frac),
                        Dh(Json.Get(p, "lossVal")), Json.Str(p, "id"));
                    foreach (object x in Json.Arr(p, "lines"))
                    {
                        Dictionary<string, object> l = O(x);
                        db.Run("INSERT INTO count_entries(session_id, item_id, name, base_qty, counted_qty, cost, counted_at) VALUES(?, NULL, ?, ?, ?, ?, ?)",
                            id, Json.Str(l, "name"), Qty(Json.Get(l, "rec"), out frac), Math.Max(Qty(Json.Get(l, "got"), out frac), 0),
                            Dh(Json.Get(l, "cost")), done);
                    }
                }
                Dictionary<string, object> cs = Json.Obj(s, "countSession");
                if (cs == null) return;
                string scope = Json.Str(cs, "scope"), value = "";
                if (scope == "lib")
                {
                    long cab;
                    scope = "place";
                    value = cabinet.TryGetValue(Json.Str(cs, "lib"), out cab) ? cab.ToString(CultureInfo.InvariantCulture) : "1";
                }
                else if (scope == "cat") value = Json.Str(cs, "cat");
                else if (scope != "books" && scope != "stat") scope = "all";
                string start = Stamp3(Json.Str(cs, "at"), c.At);
                long sid = db.Insert("INSERT INTO count_sessions(started_at, status, scope, scope_value, n_items, old_id) VALUES(?, 'open', ?, ?, ?, ?)",
                    start, scope, value, Json.Long(cs, "n", 0), Json.Str(cs, "id"));
                Dictionary<string, object> counted = Json.Obj(cs, "counted"), bases = Json.Obj(cs, "base");
                if (counted == null) return;
                foreach (KeyValuePair<string, object> kv in counted)
                {
                    long it = Item("", kv.Key);
                    if (it == 0) { Warn("الجرد المفتوح: صنف معدود لم يعد موجوداً"); continue; }
                    bool frac;
                    long got = Math.Max(Qty(kv.Value, out frac), 0);
                    long baseQty = bases != null && bases.ContainsKey(kv.Key) ? Qty(bases[kv.Key], out frac) : d.ShopQty0(it);
                    ItemRow row = d.LoadItem(it);
                    db.Run("INSERT INTO count_entries(session_id, item_id, name, base_qty, counted_qty, cost, counted_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
                        sid, it, row.Title, baseQty, got, row.Cost, start);
                }
                Warn("كان هناك جرد مفتوح (" + counted.Count + " صنف معدود): نُقل مفتوحاً كما هو");
            }

            void Messages()
            {
                foreach (object o in Json.Arr(s, "outbox"))
                {
                    Dictionary<string, object> m = O(o);
                    string uid = Json.Str(m, "id");
                    if (uid.Length == 0) uid = "x3-" + Guid.NewGuid().ToString("N");
                    db.Run("INSERT INTO branch_messages(uid, kind, from_branch, to_branch, ref, status, note, lines, at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) " +
                        "ON CONFLICT(uid) DO NOTHING", uid, Json.Str(m, "kind"), Json.Str(m, "from"), Json.Str(m, "to"), Json.Str(m, "ref"),
                        Json.Str(m, "status"), Json.Str(m, "note"), Json.Write(Json.Arr(m, "lines")), Stamp3(Json.Str(m, "at"), c.At));
                }
            }

            /* سجل العمليات القديم بالترتيب من الأقدم، بأرقام بعد أمر النقل نفسه */
            void Log()
            {
                List<object> log = Json.Arr(s, "log");
                long next = c.OpId;
                for (int i = log.Count - 1; i >= 0; i--)
                {
                    Dictionary<string, object> l = O(log[i]);
                    if (l == null) continue;
                    string detail = Json.Str(l, "action") + (Json.Str(l, "detail").Length > 0 ? ": " + Json.Str(l, "detail") : "");
                    db.Run("INSERT INTO ops(id, at, user_id, kind, detail, old_id) VALUES(?, ?, NULL, 'log3', ?, ?)",
                        ++next, Stamp3(Json.Str(l, "at"), c.At), detail, Json.Str(l, "id"));
                }
            }
        }
    }
}
