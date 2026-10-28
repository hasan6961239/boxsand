using System;
using System.Collections.Generic;
using System.Globalization;
using Qirtasiya.Data;

namespace Qirtasiya.Engine
{
    public sealed partial class Api
    {
        void Register()
        {
            /* ---------- الحساب ---------- */
            Add("me", AnyUser, delegate (Ctx c) { return MeNow(c.S); });
            Add("me.password", AnyUser, delegate (Ctx c) { db.ChangeOwnPassword(c.User, c.Str("current"), c.Str("next")); return null; });
            Add("perms.list", "users", delegate (Ctx c)
            {
                List<object> l = new List<object>();
                for (int i = 0; i < PermList.GetLength(0); i++) l.Add(O("key", PermList[i, 0], "label", PermList[i, 1]));
                return l;
            });
            Add("users.list", "users", delegate (Ctx c)
            {
                return Rows("SELECT u.id, u.name, u.login, u.role, u.active, u.pass_hash <> '' AS has_password, u.locked_until, " +
                    "(SELECT group_concat(perm) FROM user_perms p WHERE p.user_id = u.id) FROM users u ORDER BY u.id",
                    new string[] { "id", "name", "login", "role", "active", "hasPassword", "lockedUntil", "perms" });
            });
            Add("user.add", "users", delegate (Ctx c)
            {
                List<string> perms = c.Has("perms") ? c.Strs("perms") : null;
                CheckPerms(perms);
                return db.AddUser(c.Str("name"), c.Str("login"), c.Str("password"), c.Has("role") ? c.Str("role") : "staff", perms, c.User);
            });
            Add("user.password", "users", delegate (Ctx c) { db.SetPassword(c.Long("id"), c.Str("password"), c.User); return null; });
            Add("user.perms", "users", delegate (Ctx c)
            {
                List<string> perms = c.Strs("perms");
                CheckPerms(perms);
                db.SetPerms(c.Long("id"), perms, c.User);
                RefreshSessions(c.Long("id"));
                return null;
            });
            Add("user.active", "users", delegate (Ctx c)
            {
                db.SetUserActive(c.Long("id"), c.Bool("active"), c.User);
                RefreshSessions(c.Long("id"));
                return null;
            });

            /* ---------- المحل والإعدادات ---------- */
            /* اسم المحل وبيانات الإيصال: يحتاجها كل بائع. الربط والإشعارات لا (فيها مفاتيح) */
            Add("shop.info", AnyUser, delegate (Ctx c) { return O("meta", Setting("meta"), "branch", Setting("branch"), "demo", Setting("demo")); });
            Add("settings.get", "settings", delegate (Ctx c) { return Setting(c.Str("key")); });
            Add("setting.set", "settings", delegate (Ctx c)
            {
                if (c.Str("key").Length == 0) throw new ShopException("اسم الإعداد ناقص.");
                /* علامة التجربة تسمح بمسح القاعدة كلها: لا تُوضع على بيانات حقيقية */
                if (c.Str("key") == "demo") throw new ShopException("علامة «نسخة تجربة» لا تُغيَّر من هنا.");
                object v;
                c.R.TryGetValue("value", out v);
                db.SetSetting(c.Str("key"), Json.Write(v), c.User);
                return null;
            });
            Add("health", "settings", delegate (Ctx c)
            {
                OpenReport r = db.Report;
                Dictionary<string, object> o = O("file", r.FilePath, "sqlite", r.SqliteVersion, "version", (long)r.VersionNow,
                    "check", r.Check, "checkMs", r.CheckMs, "readOnly", r.ReadOnly, "readOnlyReason", r.ReadOnlyReason,
                    "backupBeforeUpgrade", r.BackupFile, "upgrades", new List<object>(r.Upgrades.ToArray()));
                if (c.Bool("full")) o["problems"] = new List<object>(db.FullCheck().ToArray());
                return o;
            });

            /* ---------- الأماكن ---------- */
            Add("places.list", "view_stock", delegate (Ctx c)
            {
                return Rows("SELECT id, IFNULL(parent_id, 0), kind, name, code, sort, phone, address, note FROM places WHERE active = 1 ORDER BY sort, id",
                    new string[] { "id", "parentId", "kind", "name", "code", "sort", "phone", "address", "note" });
            });
            Add("place.add", "places", delegate (Ctx c) { return db.AddPlace(c.Long("parentId", 0), c.Str("kind"), c.Str("name"), c.Str("code"), c.User); });
            Add("place.edit", "places", delegate (Ctx c)
            {
                db.UpdatePlace(c.Long("id"), c.Str("name"), c.Str("code"), c.Str("phone"), c.Str("address"), c.Str("note"), c.User);
                return null;
            });
            Add("place.delete", "places", delegate (Ctx c) { db.DeletePlace(c.Long("id"), c.User); return null; });

            /* ---------- الموردون ودور النشر والتصنيفات ---------- */
            Add("categories.list", "search", delegate (Ctx c) { return new List<object>(db.Categories(c.Str("kind")).ToArray()); });
            Add("categories.set", "settings", delegate (Ctx c) { db.SetCategories(c.Str("kind"), c.Strs("names"), c.User); return null; });
            Add("suppliers.list", "edit_items", delegate (Ctx c)
            {
                return Rows("SELECT id, name, phone, city, note FROM suppliers WHERE active = 1 ORDER BY name",
                    new string[] { "id", "name", "phone", "city", "note" });
            });
            Add("supplier.add", "suppliers", delegate (Ctx c) { return db.AddSupplier(c.Str("name"), c.Str("phone"), c.Str("city"), c.Str("note"), c.User); });
            Add("supplier.edit", "suppliers", delegate (Ctx c)
            {
                db.UpdateSupplier(c.Long("id"), c.Str("name"), c.Str("phone"), c.Str("city"), c.Str("note"), c.User);
                return null;
            });
            Add("supplier.delete", "suppliers", delegate (Ctx c) { db.DeleteSupplier(c.Long("id"), c.User); return null; });
            Add("publishers.list", "edit_items", delegate (Ctx c)
            {
                return Rows("SELECT p.id, p.name, p.rate_bp, p.mode, p.phone, p.note, " +
                    "(SELECT COUNT(*) FROM items i WHERE i.active = 1 AND i.publisher = p.name) FROM publishers p ORDER BY p.name",
                    new string[] { "id", "name", "rateBp", "mode", "phone", "note", "books" });
            });
            Add("suppliers.page", "suppliers", delegate (Ctx c)
            {
                List<Dictionary<string, object>> rows = Rows("SELECT s.id, s.name, s.phone, s.city, s.note, " +
                    "(SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id), IFNULL((SELECT SUM(total) FROM purchases p WHERE p.supplier_id = s.id), 0), " +
                    "(SELECT MAX(date) FROM purchases p WHERE p.supplier_id = s.id) FROM suppliers s WHERE s.active = 1 ORDER BY s.name",
                    new string[] { "id", "name", "phone", "city", "note", "purchases", "total", "last" });
                if (!c.S.Can("view_cost")) foreach (Dictionary<string, object> r in rows) r.Remove("total");
                return rows;
            });
            Add("publisher.save", "suppliers", delegate (Ctx c)
            {
                return db.SavePublisher(c.Long("id", 0), c.Str("name"), c.Long("rateBp", 0), c.Str("phone"), c.Str("note"), c.User);
            });
            Add("publisher.delete", "suppliers", delegate (Ctx c) { db.DeletePublisher(c.Long("id"), c.User); return null; });

            /* ---------- الأصناف ---------- */
            Add("item.get", "view_stock", delegate (Ctx c)
            {
                ItemRow it = db.GetItem(c.Long("id"));
                if (it == null) throw new ShopException("الصنف غير موجود.");
                Dictionary<string, object> o = ItemJson(it, db.ShopQty(it.Id), c.S.Can("view_cost"));
                o["stock"] = Rows("SELECT s.place_id, p.name, p.kind, s.qty FROM item_stock s JOIN places p ON p.id = s.place_id " +
                    "WHERE s.item_id = ? AND s.qty <> 0 ORDER BY p.sort, p.id", new string[] { "placeId", "place", "kind", "qty" }, it.Id);
                return o;
            });
            Add("item.find", "search", delegate (Ctx c)
            {
                ItemRow it = c.Str("barcode").Length > 0 ? db.FindByBarcode(c.Str("barcode")) : db.FindByCode(c.Str("code"));
                if (it == null || !it.Active) return null;
                return ItemJson(it, db.ShopQty(it.Id), c.S.Can("view_cost"));
            });
            Add("items.page", "search", delegate (Ctx c) { return ItemsPage(c); });
            Add("search", "search", delegate (Ctx c) { return SearchBox(c); });
            Add("item.add", "edit_items", delegate (Ctx c)
            {
                ItemInput d = ItemFrom(c, null);
                return db.AddItem(d, c.Long("qty", 0), c.Long("placeId", 0), c.User);
            });
            Add("item.edit", "edit_items", delegate (Ctx c)
            {
                ItemRow old = db.GetItem(c.Long("id"));
                if (old == null || !old.Active) throw new ShopException("الصنف غير موجود (ربما حُذف).");
                ItemInput d = ItemFrom(c, old);
                bool prices = d.Price != old.Price || d.PriceW != old.PriceW || d.Cost != old.Cost;
                if (prices && !c.S.Can("edit_prices")) throw new ShopException("لا تملك صلاحية: " + PermLabel("edit_prices"));
                db.UpdateItem(old.Id, d, c.User);
                return null;
            });
            Add("item.delete", "edit_items", delegate (Ctx c) { db.DeleteItem(c.Long("id"), c.User); return null; });
            Add("labels.printed", "edit_items", delegate (Ctx c) { return (long)db.MarkLabelsPrinted(c.Ids("ids"), c.Str("date"), c.User); });
            Add("labels.unprint", "edit_items", delegate (Ctx c) { return (long)db.UnmarkLabels(c.Ids("ids"), c.User); });
            Add("labels.barcodes", "edit_items", delegate (Ctx c)
            {
                List<object> made = new List<object>();
                foreach (KeyValuePair<long, string> kv in db.AssignBarcodes(c.Ids("ids"), (int)c.Long("maxDigits", 8), c.Str("prefix"), c.User))
                    made.Add(O("id", kv.Key, "barcode", kv.Value));
                return made;
            });
            Add("stock.adjust", "edit_items", delegate (Ctx c)
            {
                return db.AdjustStock(c.Long("itemId"), c.Long("placeId", 0), c.Long("delta"), c.Str("note"), c.User);
            });
            Add("stock.move", "move_stock", delegate (Ctx c)
            {
                return db.MoveStock(c.Long("itemId"), c.Long("from"), c.Long("to"), c.Long("qty"), c.User);
            });
            Add("alerts", "view_stock", delegate (Ctx c) { return Alerts(c.Long("limit", 500), c.S.Can("view_cost")); });
            Add("stale", "reports", delegate (Ctx c) { return Stale(c.Long("days", 150), c.Long("limit", 500), c.S.Can("view_cost")); });

            /* ---------- الزبائن والديون ---------- */
            Add("customers.list", "sell", delegate (Ctx c)
            {
                return Rows("SELECT id, name, phone, balance, wholesale, note FROM customers WHERE active = 1 ORDER BY name",
                    new string[] { "id", "name", "phone", "balance", "wholesale", "note" });
            });
            Add("customer.get", "customers", delegate (Ctx c) { return CustomerJson(c.Long("id"), c.S.Can("view_cost")); });
            Add("customer.add", "customers", delegate (Ctx c)
            {
                long opening = c.Long("opening", 0);
                if (opening != 0 && !c.S.Can("debts")) throw new ShopException("لا تملك صلاحية: " + PermLabel("debts"));
                return db.AddCustomer(c.Str("name"), c.Str("phone"), c.Str("note"), c.Bool("wholesale"), opening, c.User);
            });
            Add("customer.edit", "customers", delegate (Ctx c)
            {
                db.UpdateCustomer(c.Long("id"), c.Str("name"), c.Str("phone"), c.Str("note"), c.Bool("wholesale"), c.User);
                return null;
            });
            Add("customer.delete", "customers", delegate (Ctx c) { db.DeleteCustomer(c.Long("id"), c.User); return null; });
            Add("customer.balance", "debts", delegate (Ctx c) { db.SetBalance(c.Long("id"), c.Long("balance"), c.Str("why"), c.User); return null; });
            Add("payment.add", "debts", delegate (Ctx c)
            {
                return db.Pay(c.Long("customerId"), c.Long("amount"), c.Str("date"), c.Str("note"), c.User);
            });

            /* ---------- البيع والفواتير ---------- */
            Add("sale", "sell", delegate (Ctx c)
            {
                SaleInput s = new SaleInput();
                foreach (Dictionary<string, object> l in c.List("lines"))
                    s.Lines.Add(new SaleLine(Ctx.L(l, "itemId", 0), Ctx.L(l, "qty", 0), Ctx.L(l, "price", -1)));
                s.Discount = c.Long("discount", 0);
                s.Method = c.Has("method") ? c.Str("method") : "cash";
                s.Mode = c.Has("mode") ? c.Str("mode") : "retail";
                s.CustomerId = c.Long("customerId", 0);
                s.Paid = c.Long("paid", 0);
                s.Date = c.Str("date"); s.At = c.Str("at");
                s.Source = c.Has("source") ? c.Str("source") : "pos";
                s.Device = c.Str("device"); s.PhoneId = c.Str("phoneId"); s.Note = c.Str("note");
                FillPrices(s.Lines, s.Mode);
                return ResultJson(db.Sell(s, c.User));
            });
            Add("return", "returns", delegate (Ctx c)
            {
                List<ReturnLine> ls = new List<ReturnLine>();
                foreach (Dictionary<string, object> l in c.List("lines")) ls.Add(new ReturnLine(Ctx.L(l, "lineId", 0), Ctx.L(l, "qty", 0)));
                return ResultJson(db.Return(c.Long("invoiceId"), ls, c.Str("note"), c.User));
            });
            Add("invoice.edit", "edit_invoice", delegate (Ctx c)
            {
                List<SaleLine> ls = new List<SaleLine>();
                foreach (Dictionary<string, object> l in c.List("lines"))
                    ls.Add(new SaleLine(Ctx.L(l, "itemId", 0), Ctx.L(l, "qty", 0), Ctx.L(l, "price", -1)));
                FillPrices(ls, "retail");
                return ResultJson(db.EditInvoice(c.Long("id"), ls, c.Long("discount", 0), c.Has("method") ? c.Str("method") : "cash",
                    c.Long("customerId", 0), c.Long("paid", 0), !c.Has("restock") || c.Bool("restock"), c.User));
            });
            Add("invoice.delete", "delete_invoice", delegate (Ctx c)
            {
                db.DeleteInvoice(c.Long("id"), !c.Has("restock") || c.Bool("restock"), c.Str("reason"), c.User);
                return null;
            });
            Add("invoice.get", "sell", delegate (Ctx c)
            {
                InvoiceRow v = c.Has("no") ? db.GetInvoiceByNo(c.Long("no")) : db.GetInvoice(c.Long("id"));
                if (v == null) throw new ShopException("الفاتورة غير موجودة.");
                Dictionary<string, object> j = InvoiceJson(v, c.S.Can("view_cost"));
                AddReturned(j);
                return j;
            });
            Add("invoices.page", "sell", delegate (Ctx c) { return InvoicesPage(c); });
            Add("day.close", "closing", delegate (Ctx c)
            {
                /* النقد المفروض يحسبه المحرك لحظة الإقفال (إن لم يُرسل)، بحساب 3.x */
                string date = c.Str("date").Length > 0 ? c.Str("date") : ShopDb.Day(clock());
                long expected = c.Has("expected") ? c.Long("expected") : ExpectedCash(date);
                db.CloseDay(date, expected, c.Long("counted"), c.Str("note"), c.User);
                return O("date", date, "expected", expected, "counted", c.Long("counted"), "diff", c.Long("counted") - expected);
            });
            Add("report.range", "reports", delegate (Ctx c) { return ReportRange(c.Str("from"), c.Str("to"), c.S.Can("view_cost")); });

            /* ---------- إدخال البضاعة ---------- */
            Add("receive", "receive", delegate (Ctx c)
            {
                List<ReceiveLine> ls = new List<ReceiveLine>();
                foreach (Dictionary<string, object> l in c.List("lines"))
                    ls.Add(new ReceiveLine(Ctx.L(l, "itemId", 0), Ctx.L(l, "qty", 0), Ctx.L(l, "cost", 0), Ctx.L(l, "placeId", 0)));
                return db.Receive(c.Long("supplierId", 0), c.Str("date"), c.Str("note"), ls, c.User);
            });
            Add("purchases.page", "receive", delegate (Ctx c)
            {
                List<Dictionary<string, object>> rows = Rows("SELECT p.id, p.date, p.at, IFNULL(s.name, ''), p.note, p.total, " +
                    "(SELECT COUNT(*) FROM purchase_lines l WHERE l.purchase_id = p.id), (SELECT IFNULL(SUM(qty), 0) FROM purchase_lines l WHERE l.purchase_id = p.id) " +
                    "FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.id DESC LIMIT ? OFFSET ?",
                    new string[] { "id", "date", "at", "supplier", "note", "total", "lines", "pieces" }, Limit(c, 100), c.Long("offset", 0));
                /* التكلفة سعر شراء: لمن يملك view_cost وحده */
                if (!c.S.Can("view_cost")) foreach (Dictionary<string, object> r in rows) r.Remove("total");
                return rows;
            });
            Add("purchase.get", "receive", delegate (Ctx c)
            {
                List<Dictionary<string, object>> p = Rows("SELECT p.id, p.date, p.at, IFNULL(s.name, ''), p.note, p.total FROM purchases p " +
                    "LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?", new string[] { "id", "date", "at", "supplier", "note", "total" }, c.Long("id"));
                if (p.Count == 0) throw new ShopException("الإدخال غير موجود.");
                bool cost = c.S.Can("view_cost");
                List<Dictionary<string, object>> lines = Rows("SELECT item_id, name, qty, cost, place_id FROM purchase_lines WHERE purchase_id = ? ORDER BY line_no",
                    new string[] { "itemId", "name", "qty", "cost", "placeId" }, c.Long("id"));
                if (!cost) { p[0].Remove("total"); foreach (Dictionary<string, object> l in lines) l.Remove("cost"); }
                p[0]["lines"] = lines;
                return p[0];
            });

            /* ---------- الكتب على المباع ---------- */
            Add("consignors.list", "consign", delegate (Ctx c)
            {
                /* due: المستحق له الآن (ما بِيع بسعره ناقص ما سُدّد)، كما في 3.x */
                List<Dictionary<string, object>> rows = Rows("SELECT o.id, o.name, o.phone, o.note, " +
                    "IFNULL((SELECT SUM(sold * owner_price) FROM consignments l WHERE l.consignor_id = o.id), 0) - " +
                    "IFNULL((SELECT SUM(amount) FROM consignment_payments p WHERE p.consignor_id = o.id), 0), " +
                    "IFNULL((SELECT SUM(MAX(qty - sold - returned, 0)) FROM consignments l WHERE l.consignor_id = o.id), 0), " +
                    "(SELECT COUNT(*) FROM consignments l WHERE l.consignor_id = o.id), " +
                    "IFNULL((SELECT SUM(qty) FROM consignments l WHERE l.consignor_id = o.id), 0), " +
                    "IFNULL((SELECT SUM(sold) FROM consignments l WHERE l.consignor_id = o.id), 0), " +
                    "IFNULL((SELECT SUM(sold * (price - owner_price)) FROM consignments l WHERE l.consignor_id = o.id), 0) " +
                    "FROM consignors o ORDER BY o.name", new string[] { "id", "name", "phone", "note", "due", "left", "titles", "qty", "sold", "myProfit" });
                if (!c.S.Can("view_cost")) foreach (Dictionary<string, object> r in rows) r.Remove("myProfit");
                return rows;
            });
            Add("consignor.get", "consign", delegate (Ctx c)
            {
                List<Dictionary<string, object>> o = Rows("SELECT id, name, phone, note FROM consignors WHERE id = ?", new string[] { "id", "name", "phone", "note" }, c.Long("id"));
                if (o.Count == 0) throw new ShopException("صاحب البضاعة غير موجود.");
                o[0]["lines"] = Rows("SELECT l.id, IFNULL(l.item_id, 0), l.kind, l.title, l.author, l.code, l.qty, l.sold, l.returned, MAX(l.qty - l.sold - l.returned, 0), " +
                    "l.price, l.owner_price, l.date, IFNULL(i.home_place_id, 0) FROM consignments l LEFT JOIN items i ON i.id = l.item_id WHERE l.consignor_id = ? ORDER BY l.id",
                    new string[] { "id", "itemId", "kind", "title", "author", "code", "qty", "sold", "returned", "left", "price", "ownerPrice", "date", "homePlaceId" }, c.Long("id"));
                o[0]["payments"] = Rows("SELECT id, amount, date, at, note, from_drawer FROM consignment_payments WHERE consignor_id = ? ORDER BY id DESC",
                    new string[] { "id", "amount", "date", "at", "note", "fromDrawer" }, c.Long("id"));
                return o[0];
            });
            Add("consignor.edit", "consign", delegate (Ctx c)
            {
                db.UpdateConsignor(c.Long("id"), c.Str("name"), c.Str("phone"), c.Str("note"), c.User);
                return null;
            });
            Add("consign.in", "consign", delegate (Ctx c)
            {
                List<ConsignLine> ls = new List<ConsignLine>();
                foreach (Dictionary<string, object> l in c.List("lines"))
                {
                    ConsignLine x = new ConsignLine();
                    x.Kind = Json.Str(l, "kind") == "stat" ? "stat" : "book";
                    x.Title = Json.Str(l, "title"); x.Author = Json.Str(l, "author"); x.Code = Json.Str(l, "code");
                    x.Unit = Json.Str(l, "unit"); x.LocNote = Json.Str(l, "locNote");
                    x.Qty = Ctx.L(l, "qty", 0); x.Price = Ctx.L(l, "price", 0); x.OwnerPrice = Ctx.L(l, "ownerPrice", 0);
                    x.PlaceId = Ctx.L(l, "placeId", 1);
                    ls.Add(x);
                }
                return db.ConsignReceive(c.Long("consignorId", 0), c.Str("name"), c.Str("phone"), c.Str("date"), c.Str("note"), ls, c.User);
            });
            Add("consign.back", "consign", delegate (Ctx c) { return db.ConsignGiveBack(c.Long("id"), c.Long("qty"), c.User); });
            Add("consign.pay", "consign", delegate (Ctx c)
            {
                return db.ConsignPay(c.Long("consignorId"), c.Long("amount"), c.Str("date"), c.Str("note"), !c.Has("fromDrawer") || c.Bool("fromDrawer"), c.User);
            });

            /* ---------- الجرد ---------- */
            Add("count.start", "count", delegate (Ctx c) { return db.CountStart(c.Has("scope") ? c.Str("scope") : "all", c.Str("value"), c.User); });
            Add("count.set", "count", delegate (Ctx c)
            {
                /* مسحة بالقارئ: add بدل العدد، والرد العدد الجديد */
                if (c.Has("add")) return db.CountAdd(c.Long("sessionId"), c.Long("itemId"), c.Long("add"), c.User);
                long? n = c.Has("counted") ? (long?)c.Long("counted") : null;
                db.CountSet(c.Long("sessionId"), c.Long("itemId"), n, c.User);
                return null;
            });
            Add("count.apply", "count", delegate (Ctx c)
            {
                CountResult r = db.CountApply(c.Long("sessionId"), c.User);
                return O("total", r.Total, "done", r.Done, "ok", r.Ok, "less", r.Less, "more", r.More,
                    "lossQty", r.LossQty, "lossVal", c.S.Can("view_cost") ? (object)r.LossVal : null, "fixed", r.Fixed);
            });
            Add("count.cancel", "count", delegate (Ctx c) { db.CountCancel(c.Long("sessionId"), c.User); return null; });
            Add("count.current", "count", delegate (Ctx c)
            {
                List<Dictionary<string, object>> s = Rows("SELECT id, started_at, scope, scope_value, n_items FROM count_sessions WHERE status = 'open'",
                    new string[] { "id", "startedAt", "scope", "value", "items" });
                if (s.Count == 0) return null;
                s[0]["entries"] = Rows("SELECT item_id, name, base_qty, counted_qty, counted_at FROM count_entries WHERE session_id = ? ORDER BY id",
                    new string[] { "itemId", "name", "base", "counted", "at" }, s[0]["id"]);
                return s[0];
            });

            /* ---------- سجل العمليات ---------- */
            Add("ops.page", "log", delegate (Ctx c)
            {
                long before = c.Long("before", long.MaxValue);
                return Rows("SELECT o.id, o.at, IFNULL(u.name, ''), o.kind, o.detail, o.ref_type, o.ref_id, o.before, o.after FROM ops o " +
                    "LEFT JOIN users u ON u.id = o.user_id WHERE o.id < ? ORDER BY o.id DESC LIMIT ?",
                    new string[] { "id", "at", "user", "kind", "detail", "refType", "refId", "before", "after" }, before, Limit(c, 100));
            });

            RegisterSync();
            RegisterShop();
            RegisterStock();
            RegisterReports();
            RegisterX3();
        }

        /* سطر بلا سعر: سعر الصنف الحالي (الجملة في بيع الجملة إن كان له سعر جملة) */
        void FillPrices(List<SaleLine> lines, string mode)
        {
            foreach (SaleLine l in lines)
            {
                if (l.Price >= 0) continue;
                ItemRow it = db.GetItem(l.ItemId);
                if (it == null) continue;
                l.Price = mode == "wholesale" && it.PriceW > 0 ? it.PriceW : it.Price;
            }
        }

        static void CheckPerms(List<string> perms)
        {
            if (perms == null) return;
            foreach (string p in perms) if (!KnownPerm(p)) throw new ShopException("صلاحية غير معروفة: " + p);
        }

        static long Limit(Ctx c, long def)
        {
            long l = c.Long("limit", def);
            return Math.Min(Math.Max(l, 1), 500);
        }
    }
}
