using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Qirtasiya.Data;

namespace Qirtasiya.Engine
{
    /* القراءة: صفحة صفحة من القاعدة (قرار 0005)، والحسابات الثقيلة بـ SQL */
    public sealed partial class Api
    {
        /* {"a": 1, "b": 2} من أزواج */
        static Dictionary<string, object> O(params object[] kv)
        {
            Dictionary<string, object> o = new Dictionary<string, object>();
            for (int i = 0; i + 1 < kv.Length; i += 2) o[(string)kv[i]] = kv[i + 1];
            return o;
        }

        List<Dictionary<string, object>> Rows(string sql, string[] names, params object[] args)
        {
            List<object[]> rows = db.Read<List<object[]>>(delegate (Sqlite c) { return c.Rows(sql, args); });
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>(rows.Count);
            foreach (object[] r in rows)
            {
                Dictionary<string, object> o = new Dictionary<string, object>();
                for (int i = 0; i < names.Length && i < r.Length; i++) o[names[i]] = r[i];
                list.Add(o);
            }
            return list;
        }

        object Setting(string key)
        {
            string v = db.GetSetting(key);
            if (v == null) return null;
            try { return Json.Parse(v); }
            catch (FormatException) { return v; }
        }

        /* ---------- الأصناف ---------- */

        static Dictionary<string, object> ItemJson(ItemRow it, long qty, bool cost)
        {
            Dictionary<string, object> o = O("id", it.Id, "kind", it.Kind, "code", it.Code, "title", it.Title, "author", it.Author,
                "brand", it.Brand, "publisher", it.Publisher, "barcode", it.Barcode, "cat", it.Cat, "catFull", it.CatFull,
                "unit", it.Unit, "locNote", it.LocNote, "homePlaceId", it.HomePlaceId, "supplierId", it.SupplierId,
                "price", it.Price, "priceW", it.PriceW, "min", it.Min, "note", it.Note, "lastSold", it.LastSold,
                "soldTotal", it.SoldTotal, "labelPrinted", it.LabelPrinted, "createdAt", it.CreatedAt, "updatedAt", it.UpdatedAt,
                "active", it.Active, "qty", qty);
            if (cost) o["cost"] = it.Cost;
            return o;
        }

        /* بيانات الصنف من الطلب. في التعديل: ما لم يُرسل يبقى كما كان، فلا
           يمسح بائعٌ لا يرى سعر الشراء سعرَ الشراء بإرساله فارغاً. */
        static ItemInput ItemFrom(Ctx c, ItemRow old)
        {
            ItemInput d = new ItemInput();
            if (old != null)
            {
                d.Kind = old.Kind; d.Code = old.Code; d.Title = old.Title; d.Author = old.Author; d.Brand = old.Brand;
                d.Publisher = old.Publisher; d.Barcode = old.Barcode; d.Cat = old.Cat; d.CatFull = old.CatFull; d.Unit = old.Unit;
                d.LocNote = old.LocNote; d.Note = old.Note; d.Price = old.Price; d.PriceW = old.PriceW; d.Cost = old.Cost;
                d.Min = old.Min; d.HomePlaceId = old.HomePlaceId; d.SupplierId = old.SupplierId;
            }
            if (c.Has("kind") && old == null) d.Kind = c.Str("kind");
            if (c.Has("code")) d.Code = c.Str("code");
            if (c.Has("title")) d.Title = c.Str("title");
            if (c.Has("author")) d.Author = c.Str("author");
            if (c.Has("brand")) d.Brand = c.Str("brand");
            if (c.Has("publisher")) d.Publisher = c.Str("publisher");
            if (c.Has("barcode")) d.Barcode = c.Str("barcode");
            if (c.Has("cat")) d.Cat = c.Str("cat");
            if (c.Has("catFull")) d.CatFull = c.Str("catFull");
            if (c.Has("unit")) d.Unit = c.Str("unit");
            if (c.Has("locNote")) d.LocNote = c.Str("locNote");
            if (c.Has("note")) d.Note = c.Str("note");
            if (c.Has("price")) d.Price = c.Long("price");
            if (c.Has("priceW")) d.PriceW = c.Long("priceW");
            if (c.Has("cost") && c.S.Can("view_cost")) d.Cost = c.Long("cost");
            if (c.Has("min")) d.Min = c.Long("min");
            if (c.Has("homePlaceId")) d.HomePlaceId = c.Long("homePlaceId");
            if (c.Has("supplierId")) d.SupplierId = c.Long("supplierId");
            return d;
        }

        const string QtyExpr = "(SELECT IFNULL(SUM(s.qty), 0) FROM item_stock s JOIN places p ON p.id = s.place_id " +
            "WHERE s.item_id = i.id AND p.kind <> 'store')";

        /* صفحة أصناف. q يبحث في الاسم والمؤلف والرمز والباركود (بحث بسيط؛
           البحث المتسامح بالفهرس في المرحلة 3). */
        object ItemsPage(Ctx c)
        {
            StringBuilder where = new StringBuilder("i.active = 1");
            List<object> args = new List<object>();
            string q = c.Str("q").Trim();
            if (q.Length > 0)
            {
                where.Append(" AND (i.title LIKE ? OR i.author LIKE ? OR i.code = ? COLLATE NOCASE OR i.barcode = ?)");
                string like = "%" + q.Replace("%", "").Replace("_", "") + "%";
                args.Add(like); args.Add(like); args.Add(q); args.Add(q);
            }
            if (c.Str("kind").Length > 0) { where.Append(" AND i.kind = ?"); args.Add(c.Str("kind")); }
            if (c.Has("cat")) { where.Append(" AND i.cat = ?"); args.Add(c.Str("cat")); }
            if (c.Has("placeId"))
            {
                where.Append(" AND i.home_place_id IN (WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT p.id FROM places p JOIN t ON p.parent_id = t.id) SELECT id FROM t)");
                args.Add(c.Long("placeId"));
            }
            string order;
            switch (c.Str("sort"))
            {
                case "title": order = "i.title, i.id"; break;
                case "new": order = "i.id DESC"; break;
                case "qty": order = QtyExpr + ", i.id"; break;
                default: order = "i.id"; break;
            }
            long total = db.Read<long>(delegate (Sqlite s) { return s.Long("SELECT COUNT(*) FROM items i WHERE " + where, 0, args.ToArray()); });
            List<object> page = new List<object>(args);
            page.Add(Limit(c, 100));
            page.Add(Math.Max(c.Long("offset", 0), 0));
            List<object[]> rows = db.Read<List<object[]>>(delegate (Sqlite s)
            {
                return s.Rows("SELECT i.id, " + QtyExpr + " FROM items i WHERE " + where + " ORDER BY " + order + " LIMIT ? OFFSET ?", page.ToArray());
            });
            bool cost = c.S.Can("view_cost");
            List<object> items = new List<object>();
            foreach (object[] r in rows) items.Add(ItemJson(db.GetItem((long)r[0]), (long)r[1], cost));
            return O("total", total, "items", items);
        }

        /* نفد (صفر أو أقل في المحل) وقارب على النفاد (عند حدّ التنبيه أو تحته) */
        object Alerts(long limit)
        {
            const string sql = "SELECT i.id, i.kind, i.code, i.title, i.min_qty, IFNULL(q.qty, 0) AS qty, IFNULL(w.qty, 0) FROM items i " +
                "LEFT JOIN (SELECT s.item_id, SUM(s.qty) AS qty FROM item_stock s JOIN places p ON p.id = s.place_id WHERE p.kind <> 'store' GROUP BY s.item_id) q ON q.item_id = i.id " +
                "LEFT JOIN (SELECT s.item_id, SUM(s.qty) AS qty FROM item_stock s JOIN places p ON p.id = s.place_id WHERE p.kind = 'store' GROUP BY s.item_id) w ON w.item_id = i.id " +
                "WHERE i.active = 1 AND {0} ORDER BY IFNULL(q.qty, 0), i.title LIMIT ?";
            string[] names = { "id", "kind", "code", "title", "min", "qty", "inStores" };
            return O("out", Rows(string.Format(sql, "IFNULL(q.qty, 0) <= 0"), names, Math.Min(Math.Max(limit, 1), 2000)),
                "low", Rows(string.Format(sql, "i.min_qty > 0 AND IFNULL(q.qty, 0) > 0 AND IFNULL(q.qty, 0) <= i.min_qty"), names, Math.Min(Math.Max(limit, 1), 2000)));
        }

        object Stale(long days, long limit)
        {
            string since = ShopDb.Day(clock().AddDays(-Math.Max(days, 1)));
            return Rows("SELECT i.id, i.kind, i.code, i.title, i.last_sold, " + QtyExpr + " AS qty FROM items i " +
                "WHERE i.active = 1 AND (i.last_sold = '' OR i.last_sold < ?) AND i.created_at < ? AND " + QtyExpr + " > 0 " +
                "ORDER BY i.last_sold, i.title LIMIT ?", new string[] { "id", "kind", "code", "title", "lastSold", "qty" },
                since, since, Math.Min(Math.Max(limit, 1), 2000));
        }

        /* ---------- الزبائن ---------- */

        object CustomerJson(long id, bool cost)
        {
            List<Dictionary<string, object>> c = Rows("SELECT id, name, phone, note, wholesale, balance, active, created_at FROM customers WHERE id = ?",
                new string[] { "id", "name", "phone", "note", "wholesale", "balance", "active", "createdAt" }, id);
            if (c.Count == 0) throw new ShopException("الزبون غير موجود.");
            c[0]["invoices"] = Rows("SELECT id, no, kind, at, total, paid, due, cash_back, debt_cut, method, deleted_at FROM invoices WHERE customer_id = ? ORDER BY id DESC LIMIT 200",
                new string[] { "id", "no", "kind", "at", "total", "paid", "due", "cashBack", "debtCut", "method", "deletedAt" }, id);
            c[0]["payments"] = Rows("SELECT id, amount, date, at, note FROM payments WHERE customer_id = ? ORDER BY id DESC LIMIT 200",
                new string[] { "id", "amount", "date", "at", "note" }, id);
            return c[0];
        }

        /* ---------- الفواتير ---------- */

        static Dictionary<string, object> InvoiceJson(InvoiceRow v, bool cost)
        {
            List<object> lines = new List<object>();
            foreach (InvoiceLineRow l in v.Lines)
            {
                Dictionary<string, object> o = O("id", l.Id, "lineNo", l.LineNo, "itemId", l.ItemId, "kind", l.Kind, "name", l.Name,
                    "qty", l.Qty, "price", l.Price, "srcLineId", l.SrcLineId);
                if (cost) o["cost"] = l.Cost;
                lines.Add(o);
            }
            Dictionary<string, object> j = O("id", v.Id, "no", v.No, "kind", v.Kind, "refId", v.RefId, "date", v.Date, "at", v.At,
                "subtotal", v.Subtotal, "discount", v.Discount, "total", v.Total, "method", v.Method, "mode", v.Mode,
                "customerId", v.CustomerId, "paid", v.Paid, "due", v.Due, "cashBack", v.CashBack, "debtCut", v.DebtCut,
                "source", v.Source, "device", v.Device, "phoneId", v.PhoneId, "note", v.Note, "editedAt", v.EditedAt,
                "deletedAt", v.DeletedAt, "deleteReason", v.DeleteReason, "lines", lines);
            if (cost) j["profit"] = v.Profit;
            return j;
        }

        object InvoicesPage(Ctx c)
        {
            StringBuilder where = new StringBuilder("1 = 1");
            List<object> args = new List<object>();
            if (!c.Bool("includeDeleted")) where.Append(" AND v.deleted_at = ''");
            if (c.Str("from").Length > 0) { where.Append(" AND v.date >= ?"); args.Add(c.Str("from")); }
            if (c.Str("to").Length > 0) { where.Append(" AND v.date <= ?"); args.Add(c.Str("to")); }
            if (c.Has("customerId")) { where.Append(" AND v.customer_id = ?"); args.Add(c.Long("customerId")); }
            if (c.Has("no")) { where.Append(" AND v.no = ?"); args.Add(c.Long("no")); }
            List<object> page = new List<object>(args);
            page.Add(Limit(c, 100));
            page.Add(Math.Max(c.Long("offset", 0), 0));
            bool cost = c.S.Can("view_cost");
            List<Dictionary<string, object>> rows = Rows("SELECT v.id, v.no, v.kind, v.date, v.at, v.total, v.profit, v.method, v.paid, v.due, " +
                "IFNULL(cu.name, ''), v.source, v.deleted_at, (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = v.id) FROM invoices v " +
                "LEFT JOIN customers cu ON cu.id = v.customer_id WHERE " + where + " ORDER BY v.id DESC LIMIT ? OFFSET ?",
                new string[] { "id", "no", "kind", "date", "at", "total", "profit", "method", "paid", "due", "customer", "source", "deletedAt", "lines" },
                page.ToArray());
            if (!cost) foreach (Dictionary<string, object> r in rows) r.Remove("profit");
            long total = db.Read<long>(delegate (Sqlite s) { return s.Long("SELECT COUNT(*) FROM invoices v WHERE " + where, 0, args.ToArray()); });
            return O("total", total, "invoices", rows);
        }

        static Dictionary<string, object> ResultJson(InvoiceResult r)
        {
            return O("id", r.Id, "no", r.No, "total", r.Total, "due", r.Due, "cashBack", r.CashBack, "debtCut", r.DebtCut,
                "over", r.Over, "duplicate", r.Duplicate, "fromRoom", new List<object>(r.FromRoom.ToArray()));
        }

        /* مبيعات كل يوم في فترة: العدد والصافي (والربح لمن يراه) */
        object ReportRange(string from, string to, bool cost)
        {
            if (from.Length == 0) from = ShopDb.Day(clock());
            if (to.Length == 0) to = from;
            List<Dictionary<string, object>> days = Rows(
                "SELECT date, SUM(kind = 'sale'), SUM(kind = 'return'), SUM(total), SUM(profit), " +
                "SUM(CASE WHEN kind = 'sale' AND method = 'cash' THEN total ELSE 0 END), " +
                "SUM(CASE WHEN kind = 'sale' AND method = 'card' THEN total ELSE 0 END), " +
                "SUM(CASE WHEN kind = 'sale' AND method = 'credit' THEN due ELSE 0 END) " +
                "FROM invoices WHERE date BETWEEN ? AND ? AND deleted_at = '' GROUP BY date ORDER BY date",
                new string[] { "date", "sales", "returns", "net", "profit", "cash", "card", "credit" }, from, to);
            if (!cost) foreach (Dictionary<string, object> d in days) d.Remove("profit");
            return O("from", from, "to", to, "days", days);
        }
    }
}
