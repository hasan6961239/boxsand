using System;
using System.Collections.Generic;
using Qirtasiya.Data;

namespace Qirtasiya.Engine
{
    /* ============================================================
       شاشات 4.0 للمحل: الجرد وإقفال اليوم، الزبائن والديون، الإرجاع
       ------------------------------------------------------------
       - ما دخل الصندوق بحساب 3.x نفسه (reports.js، takings): إقفال اليوم
         ولوحة اليوم يقولان الرقم نفسه الذي اعتاده المحل.
       - كشف الزبون من حركات دينه (قرار 0018): رصيده الجاري يساوي دينه دائماً.
       - ما أُرجع من كل سطر في الفاتورة، لنافذة الإرجاع.
       ============================================================ */
    public sealed partial class Api
    {
        void RegisterShop()
        {
            Add("takings", "closing", delegate (Ctx c) { return Takings(c.Str("from"), c.Str("to"), c.S.Can("view_cost")); });
            Add("customers.page", "customers", delegate (Ctx c) { return CustomersPage(); });
            Add("customer.statement", "customers", delegate (Ctx c) { return CustomerStatement(c.Long("id")); });
        }

        static long N(object v) { return v == null ? 0 : Convert.ToInt64(v); }

        /* ---------- الصندوق ----------
           النقد = البيع نقداً بعد ما رُدّ منه نقداً
                 + المدفوع مقدّماً في البيع الآجل
                 + تسديد الديون
                 − ما رُدّ نقداً من إرجاع فاتورة آجلة
                 − ما دُفع لأصحاب كتب المباع من الدرج
           لكل يوم في الفترة. */
        Dictionary<string, Dictionary<string, long>> TakingsByDay(string from, string to)
        {
            Dictionary<string, Dictionary<string, long>> days = new Dictionary<string, Dictionary<string, long>>(StringComparer.Ordinal);
            Func<string, Dictionary<string, long>> day = delegate (string d)
            {
                Dictionary<string, long> x;
                if (!days.TryGetValue(d, out x))
                {
                    x = new Dictionary<string, long>(StringComparer.Ordinal);
                    foreach (string k in new string[] { "salesCash", "card", "upfront", "refundCredit", "due", "creditTotal", "debtPaid", "nPaid", "consOut" })
                        x[k] = 0;
                    days[d] = x;
                }
                return x;
            };
            db.Read<object>(delegate (Sqlite s)
            {
                foreach (object[] r in s.Rows("SELECT date, " +
                    "SUM(CASE WHEN method = 'cash' THEN total - due ELSE 0 END), " +
                    "SUM(CASE WHEN method = 'card' THEN total - due ELSE 0 END), " +
                    "SUM(CASE WHEN method = 'credit' AND kind = 'sale' THEN paid ELSE 0 END), " +
                    "SUM(CASE WHEN method = 'credit' AND kind = 'return' THEN cash_back ELSE 0 END), " +
                    "SUM(due), SUM(CASE WHEN method = 'credit' THEN total ELSE 0 END) " +
                    "FROM invoices WHERE date BETWEEN ? AND ? AND deleted_at = '' GROUP BY date", from, to))
                {
                    Dictionary<string, long> x = day((string)r[0]);
                    x["salesCash"] = N(r[1]); x["card"] = N(r[2]); x["upfront"] = N(r[3]);
                    x["refundCredit"] = N(r[4]); x["due"] = N(r[5]); x["creditTotal"] = N(r[6]);
                }
                foreach (object[] r in s.Rows("SELECT date, SUM(amount), COUNT(*) FROM payments WHERE date BETWEEN ? AND ? GROUP BY date", from, to))
                {
                    Dictionary<string, long> x = day((string)r[0]);
                    x["debtPaid"] = N(r[1]); x["nPaid"] = N(r[2]);
                }
                foreach (object[] r in s.Rows("SELECT date, SUM(amount) FROM consignment_payments WHERE from_drawer = 1 AND date BETWEEN ? AND ? GROUP BY date", from, to))
                    day((string)r[0])["consOut"] = N(r[1]);
                return null;
            });
            foreach (Dictionary<string, long> x in days.Values)
                x["cash"] = x["salesCash"] + x["upfront"] + x["debtPaid"] - x["refundCredit"] - x["consOut"];
            return days;
        }

        /* جرد المبيعات لفترة (يوم، شهر، سنة)، وإقفال اليوم إن كانت يوماً واحداً */
        object Takings(string from, string to, bool cost)
        {
            if (from.Length == 0) from = ShopDb.Day(clock());
            if (to.Length == 0) to = from;
            Dictionary<string, object> o = O("from", from, "to", to);
            Dictionary<string, long> sum = new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (string k in new string[] { "salesCash", "card", "upfront", "refundCredit", "due", "creditTotal", "debtPaid", "nPaid", "consOut", "cash" })
                sum[k] = 0;
            foreach (Dictionary<string, long> x in TakingsByDay(from, to).Values)
                foreach (KeyValuePair<string, long> kv in x) sum[kv.Key] += kv.Value;
            foreach (KeyValuePair<string, long> kv in sum) o[kv.Key] = kv.Value;

            db.Read<object>(delegate (Sqlite s)
            {
                object[] r = s.Rows("SELECT SUM(kind = 'sale'), SUM(kind = 'return'), SUM(total), SUM(profit), " +
                    "SUM(kind = 'sale' AND method = 'cash'), SUM(kind = 'sale' AND method = 'card'), SUM(kind = 'sale' AND method = 'credit'), " +
                    "SUM(CASE WHEN kind = 'return' THEN total ELSE 0 END), " +
                    "SUM(kind = 'sale' AND mode = 'wholesale'), SUM(CASE WHEN kind = 'sale' AND mode = 'wholesale' THEN total ELSE 0 END) " +
                    "FROM invoices WHERE date BETWEEN ? AND ? AND deleted_at = ''", from, to)[0];
                o["sales"] = N(r[0]); o["returns"] = N(r[1]); o["total"] = N(r[2]);
                if (cost) o["profit"] = N(r[3]);
                o["cntCash"] = N(r[4]); o["cntCard"] = N(r[5]); o["cntCredit"] = N(r[6]);
                o["returnsTotal"] = N(r[7]); o["wholesale"] = N(r[8]); o["wholesaleTotal"] = N(r[9]);
                o["pieces"] = N(s.Long("SELECT SUM(CASE WHEN v.kind = 'return' THEN -l.qty ELSE l.qty END) FROM invoice_lines l " +
                    "JOIN invoices v ON v.id = l.invoice_id WHERE v.date BETWEEN ? AND ? AND v.deleted_at = ''", 0, from, to));

                /* الأصناف المباعة بعد خصم الإرجاعات، كما في 3.x */
                List<object> sold = new List<object>();
                foreach (object[] x in s.Rows("SELECT MAX(l.name), " +
                    "SUM(CASE WHEN v.kind = 'return' THEN -l.qty ELSE l.qty END) AS q, " +
                    "SUM(CASE WHEN v.kind = 'return' THEN -l.qty ELSE l.qty END * l.price), " +
                    "SUM(CASE WHEN v.kind = 'return' THEN -l.qty ELSE l.qty END * (l.price - l.cost)) AS p " +
                    "FROM invoice_lines l JOIN invoices v ON v.id = l.invoice_id " +
                    "WHERE v.date BETWEEN ? AND ? AND v.deleted_at = '' " +
                    "GROUP BY IFNULL(l.item_id, -1), CASE WHEN l.item_id IS NULL THEN l.name ELSE '' END " +
                    "HAVING q <> 0 ORDER BY p DESC LIMIT 1000", from, to))
                {
                    long q = N(x[1]), rev = N(x[2]);
                    Dictionary<string, object> d = O("name", x[0], "qty", q, "rev", rev, "price", q != 0 ? rev / q : 0);
                    if (cost) d["profit"] = N(x[3]);
                    sold.Add(d);
                }
                o["sold"] = sold;
                return null;
            });

            if (from == to)
            {
                List<Dictionary<string, object>> cl = Rows("SELECT expected, counted, diff, at, note FROM day_closings WHERE date = ?",
                    new string[] { "expected", "counted", "diff", "at", "note" }, from);
                o["closing"] = cl.Count > 0 ? cl[0] : null;
            }
            return o;
        }

        /* النقد المفروض في الدرج ليوم: يحسبه المحرك عند الإقفال، لا رقم قديم من الشاشة */
        long ExpectedCash(string date)
        {
            Dictionary<string, long> x;
            return TakingsByDay(date, date).TryGetValue(date, out x) ? x["cash"] : 0;
        }

        /* ---------- الزبائن ---------- */

        object CustomersPage()
        {
            List<Dictionary<string, object>> list = Rows("SELECT c.id, c.name, c.phone, c.balance, c.wholesale, c.note, " +
                "(SELECT COUNT(*) FROM invoices v WHERE v.customer_id = c.id AND v.deleted_at = '' AND v.kind = 'sale') " +
                "FROM customers c WHERE c.active = 1 ORDER BY c.balance DESC, c.name",
                new string[] { "id", "name", "phone", "balance", "wholesale", "note", "invoices" });
            long debt = 0, withDebt = 0;
            foreach (Dictionary<string, object> c in list)
            {
                long b = N(c["balance"]);
                if (b > 0) { debt += b; withDebt++; }
            }
            string month = ShopDb.Day(clock()).Substring(0, 7);
            long paidMonth = db.Read<long>(delegate (Sqlite s)
            {
                return s.Long("SELECT IFNULL(SUM(amount), 0) FROM payments WHERE substr(date, 1, 7) = ?", 0, month);
            });
            return O("customers", list, "totalDebt", debt, "withDebt", withDebt, "paidMonth", paidMonth);
        }

        /* كشف الحساب: كل حركة على الدين بسببها، والرصيد بعدها */
        object CustomerStatement(long id)
        {
            List<Dictionary<string, object>> cu = Rows("SELECT id, name, phone, balance FROM customers WHERE id = ?",
                new string[] { "id", "name", "phone", "balance" }, id);
            if (cu.Count == 0) throw new ShopException("الزبون غير موجود.");
            List<Dictionary<string, object>> moves = Rows("SELECT m.id, m.at, m.delta, m.reason, IFNULL(v.no, 0), IFNULL(rv.no, 0), " +
                "IFNULL(p.note, ''), IFNULL(o.detail, '') FROM customer_moves m " +
                "LEFT JOIN invoices v ON m.ref_type = 'invoice' AND v.id = m.ref_id " +
                "LEFT JOIN invoices rv ON rv.id = v.ref_id " +
                "LEFT JOIN payments p ON m.ref_type = 'payment' AND p.id = m.ref_id " +
                "LEFT JOIN ops o ON o.id = m.op_id WHERE m.customer_id = ? ORDER BY m.id",
                new string[] { "id", "at", "delta", "reason", "invoiceNo", "refNo", "note", "detail" }, id);
            long run = 0;
            foreach (Dictionary<string, object> m in moves)
            {
                run += N(m["delta"]);
                m["balance"] = run;
            }
            cu[0]["moves"] = moves;
            return cu[0];
        }

        /* ---------- الإرجاع ----------
           ما أُرجع من كل سطر: إرجاعات 4.0 برقم السطر، والمنقول من 3.x بالصنف
           والاسم، كما يحسبه ShopDb.Return نفسه */
        void AddReturned(Dictionary<string, object> inv)
        {
            if ((string)inv["kind"] != "sale") return;
            long id = (long)inv["id"];
            db.Read<object>(delegate (Sqlite s)
            {
                foreach (object o in (List<object>)inv["lines"])
                {
                    Dictionary<string, object> l = (Dictionary<string, object>)o;
                    long itemId = l["itemId"] == null ? 0 : Convert.ToInt64(l["itemId"]);
                    l["returned"] = s.Long("SELECT IFNULL(SUM(r.qty), 0) FROM invoice_lines r JOIN invoices x ON x.id = r.invoice_id " +
                        "WHERE x.kind = 'return' AND x.ref_id = ? AND x.deleted_at = '' AND " +
                        "(r.src_line_id = ? OR (r.src_line_id IS NULL AND r.item_id IS ? AND r.name = ?))", 0, id, l["id"],
                        itemId > 0 ? (object)itemId : null, l["name"]);
                }
                inv["returnsList"] = Rows0(s, "SELECT id, no, at, total FROM invoices WHERE kind = 'return' AND ref_id = ? AND deleted_at = '' ORDER BY id",
                    new string[] { "id", "no", "at", "total" }, id);
                return null;
            });
        }

        static List<object> Rows0(Sqlite s, string sql, string[] names, params object[] args)
        {
            List<object> list = new List<object>();
            foreach (object[] r in s.Rows(sql, args))
            {
                Dictionary<string, object> o = new Dictionary<string, object>();
                for (int i = 0; i < names.Length && i < r.Length; i++) o[names[i]] = r[i];
                list.Add(o);
            }
            return list;
        }
    }
}
