using System;
using System.Collections.Generic;
using System.Text;
using Qirtasiya.Data;

namespace Qirtasiya.Engine
{
    /* ============================================================
       شاشات 4.0 للمخزون: الأماكن والمخازن، جرد المخزون الفعلي، الراكدة
       ------------------------------------------------------------
       - ما في كل مكان (المحل، غرف الخزين، المخازن) صنفاً صنفاً.
       - الجرد صفحة صفحة من المحرك: النطاق قد يكون 20 ألف صنف.
       ============================================================ */
    public sealed partial class Api
    {
        void RegisterStock()
        {
            Add("places.summary", "view_stock", delegate (Ctx c) { return PlacesSummary(c.S.Can("view_cost")); });
            Add("place.items", "view_stock", delegate (Ctx c) { return PlaceItems(c); });
            Add("count.page", "count", delegate (Ctx c) { return CountPage(c); });
            Add("count.rest", "count", delegate (Ctx c) { return db.CountRest(c.Long("sessionId"), c.User); });
            Add("counts.page", "count", delegate (Ctx c)
            {
                List<Dictionary<string, object>> rows = Rows("SELECT id, started_at, done_at, scope, scope_value, n_items, done, ok, less, more, loss_qty, loss_val " +
                    "FROM count_sessions WHERE status = 'applied' ORDER BY id DESC LIMIT ?",
                    new string[] { "id", "startedAt", "doneAt", "scope", "value", "total", "done", "ok", "less", "more", "lossQty", "lossVal" }, Limit(c, 20));
                if (!c.S.Can("view_cost")) foreach (Dictionary<string, object> r in rows) r.Remove("lossVal");
                return rows;
            });
            Add("count.get", "count", delegate (Ctx c)
            {
                return Rows("SELECT item_id, name, base_qty, counted_qty, counted_qty - base_qty FROM count_entries WHERE session_id = ? AND counted_qty <> base_qty ORDER BY name",
                    new string[] { "itemId", "name", "rec", "got", "diff" }, c.Long("id"));
            });
        }

        const string SubPlaces = "(WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT p.id FROM places p JOIN t ON p.parent_id = t.id) SELECT id FROM t)";

        /* لكل مكان: كم صنفاً فيه وكم قطعة (وقيمتها بسعر الشراء لمن يراه). الشاشة تجمع الفروع */
        object PlacesSummary(bool cost)
        {
            List<Dictionary<string, object>> rows = Rows("SELECT s.place_id, COUNT(*), SUM(s.qty), SUM(s.qty * i.cost) FROM item_stock s " +
                "JOIN items i ON i.id = s.item_id AND i.active = 1 WHERE s.qty <> 0 GROUP BY s.place_id",
                new string[] { "id", "items", "pieces", "value" });
            if (!cost) foreach (Dictionary<string, object> r in rows) r.Remove("value");
            return rows;
        }

        /* ما في مكان (وما تحته) صنفاً صنفاً، بكميته هناك. مع q: بترتيب البحث */
        object PlaceItems(Ctx c)
        {
            long place = c.Long("placeId");
            bool sub = !c.Has("sub") || c.Bool("sub");
            string at = sub ? "s.place_id IN " + SubPlaces : "s.place_id = ?";
            string has = "EXISTS (SELECT 1 FROM item_stock s WHERE s.item_id = i.id AND s.qty <> 0 AND " + at + ")";
            long limit = Limit(c, 100), offset = Math.Max(c.Long("offset", 0), 0);
            bool cost = c.S.Can("view_cost");
            List<long> ids = new List<long>();
            long total;
            string q = c.Str("q").Trim();
            if (q.Length > 0)
            {
                SearchOptions o = new SearchOptions();
                o.Channel = c.S.Token + "|place.items";
                o.Filter = "i.active = 1 AND " + has;
                o.FilterArgs = new object[] { place };
                long found;
                bool more;
                SearchResult r = db.SearchWindow(q, o, (int)Math.Min(offset + limit, int.MaxValue), out found, out more);
                if (r.Cancelled) return O("cancelled", true);
                for (int i = (int)Math.Min(offset, r.Ids.Count); i < Math.Min(offset + limit, r.Ids.Count); i++) ids.Add(r.Ids[i]);
                total = found;
            }
            else
            {
                total = db.Read<long>(delegate (Sqlite s) { return s.Long("SELECT COUNT(*) FROM items i WHERE i.active = 1 AND " + has, 0, place); });
                foreach (object[] r in db.Read<List<object[]>>(delegate (Sqlite s)
                {
                    return s.Rows("SELECT i.id FROM items i WHERE i.active = 1 AND " + has + " ORDER BY i.title, i.id LIMIT ? OFFSET ?", place, limit, offset);
                })) ids.Add((long)r[0]);
            }
            List<object> items = new List<object>();
            foreach (long id in ids)
            {
                ItemRow it = db.GetItem(id);
                if (it == null) continue;
                Dictionary<string, object> o = ItemJson(it, db.ShopQty(id), cost);
                o["placeQty"] = db.Read<long>(delegate (Sqlite s)
                {
                    return s.Long("SELECT IFNULL(SUM(s.qty), 0) FROM item_stock s WHERE s.item_id = ? AND " + at, 0, id, place);
                });
                items.Add(o);
            }
            return O("total", total, "items", items);
        }

        /* الجرد المفتوح: أصناف النطاق بالمسجَّل (وقت العدّ، أو الآن إن لم يُعدّ) والمعدود والفرق،
           غير المعدود أولاً ثم الأكبر فرقاً، وملخّصه كله */
        object CountPage(Ctx c)
        {
            List<object[]> ss = db.Read<List<object[]>>(delegate (Sqlite s)
            {
                return s.Rows("SELECT id, started_at, scope, scope_value, n_items FROM count_sessions WHERE status = 'open'");
            });
            if (ss.Count == 0) return null;
            long sid = (long)ss[0][0];
            object arg;
            string where = db.ScopeWhere((string)ss[0][2], (string)ss[0][3], out arg);
            bool cost = c.S.Can("view_cost");
            Dictionary<string, object> o = O("id", sid, "startedAt", ss[0][1], "scope", ss[0][2], "value", ss[0][3], "total", ss[0][4]);

            db.Read<object>(delegate (Sqlite s)
            {
                object[] r = s.Rows("SELECT COUNT(*), SUM(counted_qty = base_qty), SUM(counted_qty < base_qty), SUM(counted_qty > base_qty), " +
                    "SUM(CASE WHEN counted_qty < base_qty THEN base_qty - counted_qty ELSE 0 END), " +
                    "SUM(CASE WHEN counted_qty < base_qty THEN (base_qty - counted_qty) * cost ELSE 0 END) FROM count_entries WHERE session_id = ?", sid)[0];
                o["done"] = N(r[0]); o["ok"] = N(r[1]); o["less"] = N(r[2]); o["more"] = N(r[3]); o["lossQty"] = N(r[4]);
                if (cost) o["lossVal"] = N(r[5]);
                return null;
            });

            const string rec = "(SELECT IFNULL(SUM(s.qty), 0) FROM item_stock s JOIN places p ON p.id = s.place_id WHERE s.item_id = i.id AND p.kind <> 'store')";
            string show = c.Str("show");
            string extra = show == "left" ? " AND e.id IS NULL" : show == "diff" ? " AND e.id IS NOT NULL AND e.counted_qty <> e.base_qty" : "";
            List<object> args = new List<object>();
            args.Add(sid);
            if (arg != null) args.Add(arg);
            long limit = Limit(c, 100), offset = Math.Max(c.Long("offset", 0), 0);
            string q = c.Str("q").Trim();
            string from = "FROM items i LEFT JOIN count_entries e ON e.session_id = ? AND e.item_id = i.id WHERE " + where + extra;
            List<object[]> rows;
            long shown;
            if (q.Length > 0)
            {
                /* البحث داخل النطاق: بترتيب البحث نفسه */
                SearchOptions so = new SearchOptions();
                so.Channel = c.S.Token + "|count.page";
                so.Filter = where;
                so.FilterArgs = arg == null ? new object[0] : new object[] { arg };
                long found;
                bool more;
                SearchResult r = db.SearchWindow(q, so, (int)Math.Min(offset + limit, int.MaxValue), out found, out more);
                if (r.Cancelled) return O("cancelled", true);
                StringBuilder ids = new StringBuilder();
                List<long> order = new List<long>();
                for (int i = (int)Math.Min(offset, r.Ids.Count); i < Math.Min(offset + limit, r.Ids.Count); i++)
                {
                    ids.Append(ids.Length > 0 ? "," : "").Append(r.Ids[i]);
                    order.Add(r.Ids[i]);
                }
                shown = found;
                List<object[]> got = ids.Length == 0 ? new List<object[]>() : db.Read<List<object[]>>(delegate (Sqlite s)
                {
                    return s.Rows("SELECT i.id, i.title, i.author, i.brand, i.barcode, i.home_place_id, IFNULL(e.base_qty, " + rec + "), e.counted_qty " +
                        from + " AND i.id IN (" + ids + ")", args.ToArray());
                });
                /* بترتيب البحث، لا بترتيب القاعدة */
                rows = new List<object[]>();
                foreach (long id in order) foreach (object[] x in got) if ((long)x[0] == id) rows.Add(x);
            }
            else
            {
                shown = db.Read<long>(delegate (Sqlite s) { return s.Long("SELECT COUNT(*) " + from, 0, args.ToArray()); });
                List<object> page = new List<object>(args);
                page.Add(limit); page.Add(offset);
                rows = db.Read<List<object[]>>(delegate (Sqlite s)
                {
                    return s.Rows("SELECT i.id, i.title, i.author, i.brand, i.barcode, i.home_place_id, IFNULL(e.base_qty, " + rec + "), e.counted_qty " +
                        from + " ORDER BY e.id IS NOT NULL, ABS(IFNULL(e.counted_qty - e.base_qty, 0)) DESC, i.title LIMIT ? OFFSET ?", page.ToArray());
                });
            }
            List<object> items = new List<object>();
            foreach (object[] r in rows)
            {
                Dictionary<string, object> d = O("id", r[0], "title", r[1], "by", (string)r[2] != "" ? r[2] : r[3], "barcode", r[4],
                    "homePlaceId", r[5], "rec", N(r[6]), "counted", r[7]);
                d["diff"] = r[7] == null ? 0 : N(r[7]) - N(r[6]);
                items.Add(d);
            }
            o["shown"] = shown;
            o["items"] = items;
            return o;
        }
    }
}
