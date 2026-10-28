using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Qirtasiya.Data;

namespace Qirtasiya.Engine
{
    /* إشعار واحد للهاتف (ntfy)، يرسله البرنامج */
    public sealed class Note
    {
        public string Server = "", Topic = "", Kind = "", Title = "", Message = "";
        public int Priority = 3;
    }

    /* ============================================================
       شاشات 4.0: الأرباح والتقارير، والإشعارات
       ------------------------------------------------------------
       - الأرباح كما في 3.x: اليوم والشهر والسنة، وقيمة المخزون، والديون، وأرباح
         آخر 12 شهراً. التقارير لفترة: المبيعات يوماً بيوم، والأكثر مبيعاً بعد خصم
         الإرجاعات، والراكد بالمال المجمَّد.
       - رمز الأرباح (قرار 0024): حساب بلا كلمة سر لا يرى الأرباح حتى يُكتب الرمز.
         الرمز نفسه ملف على الجهاز كما في 3.x (Program.cs)، فلا يتغيّر على مصراتة.
       - الإشعارات (قرار 0024): في 3.x ترسلها الشاشة بعد البيع. هنا يحسبها المحرك
         حيث يُنفَّذ الأمر، فبيعة الجهاز الثاني يُرسل إشعارها جهاز المحل مرة واحدة.
         الإعداد في صف «notify» بشكل 3.x نفسه (نقله الناقل كما هو).
       ============================================================ */
    public sealed partial class Api
    {
        /* من البرنامج: هل على هذا الجهاز رمز أرباح؟ هل الرمز صحيح؟ تغييره */
        public Func<bool> ProfitLock;
        public Func<string, bool> ProfitCheck;
        public Action<string> ProfitSet;

        /* من البرنامج: الإرسال (في الخلفية)، والإرسال التجريبي (الرد: null أو سبب الفشل)، وسجل ما أُرسل */
        public Action<List<Note>> Notified;
        public Func<Note, string> NotifyTest;
        public Func<List<object>> NotifyLog;

        void RegisterReports()
        {
            Add("profits.summary", "reports", delegate (Ctx c) { return ProfitsSummary(c.S.Can("view_cost")); });
            Add("report.period", "reports", delegate (Ctx c) { return ReportPeriod(c.Str("from"), c.Str("to"), c.S.Can("view_cost")); });

            Add("profit.unlock", AnyUser, delegate (Ctx c)
            {
                Session s = c.S;
                DateTime now = clock();
                if (s.CodeWait > now) throw new ShopException("محاولات كثيرة. حاول بعد " + Math.Ceiling((s.CodeWait - now).TotalMinutes) + " دقيقة.");
                if (ProfitCheck == null || !ProfitCheck(c.Str("code")))
                {
                    if (++s.CodeFails >= 5) { s.CodeFails = 0; s.CodeWait = now.AddMinutes(5); }
                    throw new ShopException("الرمز غير صحيح.");
                }
                s.CodeFails = 0;
                s.Locked = false;
                return MeNow(s);
            });
            Add("profit.lock", AnyUser, delegate (Ctx c)
            {
                if (c.S.Lockable) c.S.Locked = true;
                return MeNow(c.S);
            });
            Add("profit.code", "view_cost", delegate (Ctx c)
            {
                string code = c.Str("code").Trim();
                if (code.Length < 4) throw new ShopException("الرمز قصير جداً: 4 أحرف أو أرقام على الأقل.");
                if (ProfitSet == null) throw new ShopException("تغيير الرمز من البرنامج نفسه فقط.");
                ProfitSet(code);
                return null;
            });

            Add("notify.get", "settings", delegate (Ctx c)
            {
                Dictionary<string, object> cfg = NotifyConfig() ?? new Dictionary<string, object>();
                List<object> log = NotifyLog != null ? NotifyLog() : new List<object>();
                /* سجل 3.x المنقول بعد سجل هذا البرنامج */
                foreach (object o in Json.Arr(cfg, "log")) log.Add(o);
                cfg.Remove("log");
                cfg["log"] = log.Count > 25 ? log.GetRange(0, 25) : log;
                return cfg;
            });
            Add("notify.set", "settings", delegate (Ctx c)
            {
                Dictionary<string, object> cfg = NotifyConfig() ?? new Dictionary<string, object>();
                foreach (string k in new string[] { "enabled", "topic", "server", "kinds", "bigAmount", "dailyHour", "dailyProfit" })
                {
                    object v;
                    if (!c.R.TryGetValue(k, out v)) continue;
                    if (k == "topic" || k == "server") v = (Convert.ToString(v, CultureInfo.InvariantCulture) ?? "").Trim();
                    if (k == "server" && (string)v != "" && !((string)v).StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                        !((string)v).StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                        throw new ShopException("عنوان خادم الإشعارات يبدأ بـ https://");
                    cfg[k] = v;
                }
                db.SetSetting("notify", Json.Write(cfg), c.User);
                return null;
            });
            Add("notify.test", "settings", delegate (Ctx c)
            {
                Dictionary<string, object> cfg = NotifyConfig() ?? new Dictionary<string, object>();
                Note n = new Note();
                n.Server = c.Has("server") ? c.Str("server") : Json.Str(cfg, "server");
                n.Topic = c.Has("topic") ? c.Str("topic") : Json.Str(cfg, "topic");
                if (n.Topic.Trim().Length == 0) throw new ShopException("اكتب اسم القناة أولاً.");
                Dictionary<string, object> meta = Setting("meta") as Dictionary<string, object>;
                n.Kind = "test";
                n.Title = "تجربة من " + (meta != null && Json.Str(meta, "shopName") != "" ? Json.Str(meta, "shopName") : "المنظومة");
                n.Message = "إذا وصلك هذا الإشعار فالإعداد صحيح ✅";
                if (NotifyTest == null) throw new ShopException("الإرسال من البرنامج نفسه فقط.");
                string err = NotifyTest(n);
                if (err != null) throw new ShopException("تعذّر الإرسال: " + err);
                return null;
            });
        }

        /* ---------- الأرباح ---------- */

        Dictionary<string, object> SalesBox(Sqlite s, string from, string to, bool cost)
        {
            object[] r = s.Rows("SELECT IFNULL(SUM(total), 0), IFNULL(SUM(profit), 0), SUM(kind = 'sale') FROM invoices " +
                "WHERE date BETWEEN ? AND ? AND deleted_at = ''", from, to)[0];
            Dictionary<string, object> o = O("from", from, "to", to, "sales", N(r[0]), "n", N(r[2]));
            if (cost) o["profit"] = N(r[1]);
            return o;
        }

        object ProfitsSummary(bool cost)
        {
            DateTime now = clock();
            string today = ShopDb.Day(now);
            Dictionary<string, object> o = new Dictionary<string, object>();
            db.Read<object>(delegate (Sqlite s)
            {
                o["today"] = SalesBox(s, today, today, cost);
                o["month"] = SalesBox(s, today.Substring(0, 8) + "01", today, cost);
                o["year"] = SalesBox(s, today.Substring(0, 5) + "01-01", today, cost);
                /* المخزون كله (المحل والمخازن) بسعر الشراء وبسعر البيع */
                object[] v = s.Rows("SELECT IFNULL(SUM(st.qty * i.cost), 0), IFNULL(SUM(st.qty * i.price), 0) FROM item_stock st " +
                    "JOIN items i ON i.id = st.item_id AND i.active = 1 WHERE st.qty > 0")[0];
                if (cost) o["stockCost"] = N(v[0]);
                o["stockRetail"] = N(v[1]);
                o["debts"] = s.Long("SELECT IFNULL(SUM(balance), 0) FROM customers WHERE active = 1 AND balance > 0", 0);
                /* آخر 12 شهراً */
                DateTime first = new DateTime(now.Year, now.Month, 1).AddMonths(-11);
                Dictionary<string, object[]> byMonth = new Dictionary<string, object[]>(StringComparer.Ordinal);
                foreach (object[] m in s.Rows("SELECT substr(date, 1, 7), SUM(total), SUM(profit) FROM invoices WHERE date >= ? AND deleted_at = '' " +
                    "GROUP BY substr(date, 1, 7)", ShopDb.Day(first)))
                    byMonth[(string)m[0]] = m;
                List<object> months = new List<object>();
                for (int i = 0; i < 12; i++)
                {
                    string key = first.AddMonths(i).ToString("yyyy-MM", CultureInfo.InvariantCulture);
                    object[] m;
                    byMonth.TryGetValue(key, out m);
                    Dictionary<string, object> d = O("key", key, "sales", m == null ? 0 : N(m[1]));
                    if (cost) d["profit"] = m == null ? 0 : N(m[2]);
                    months.Add(d);
                }
                o["months"] = months;
                return null;
            });
            return o;
        }

        /* تقرير فترة كما في تبويب «التقارير» في 3.x */
        object ReportPeriod(string from, string to, bool cost)
        {
            if (from.Length == 0) from = ShopDb.Day(clock());
            if (to.Length == 0) to = from;
            if (string.CompareOrdinal(from, to) > 0) { string t = from; from = to; to = t; }
            Dictionary<string, object> o = O("from", from, "to", to);
            db.Read<object>(delegate (Sqlite s)
            {
                object[] r = s.Rows("SELECT IFNULL(SUM(total), 0), IFNULL(SUM(profit), 0), SUM(kind = 'sale'), " +
                    "IFNULL(SUM(CASE WHEN kind = 'sale' THEN total ELSE 0 END), 0), SUM(kind = 'return'), " +
                    "IFNULL(SUM(CASE WHEN kind = 'return' THEN total ELSE 0 END), 0), IFNULL(SUM(discount), 0) " +
                    "FROM invoices WHERE date BETWEEN ? AND ? AND deleted_at = ''", from, to)[0];
                long n = N(r[2]);
                o["total"] = N(r[0]); o["n"] = n; o["avg"] = n > 0 ? N(r[3]) / n : 0;
                o["returns"] = N(r[4]); o["returnsTotal"] = -N(r[5]); o["discount"] = N(r[6]);
                if (cost) o["profit"] = N(r[1]);

                List<object> days = new List<object>();
                foreach (object[] d in s.Rows("SELECT date, SUM(total) FROM invoices WHERE date BETWEEN ? AND ? AND deleted_at = '' GROUP BY date ORDER BY date", from, to))
                    days.Add(O("date", d[0], "total", N(d[1])));
                o["days"] = days;

                /* الأكثر مبيعاً بعد خصم الإرجاعات: بيع عشر نسخ ورجعت تسع ليس صنفاً رائجاً */
                List<object> top = new List<object>();
                foreach (object[] x in s.Rows("SELECT IFNULL(l.item_id, 0), MAX(l.name), " +
                    "SUM(CASE WHEN v.kind = 'return' THEN -l.qty ELSE l.qty END) AS q, " +
                    "SUM(CASE WHEN v.kind = 'return' THEN -l.qty ELSE l.qty END * l.price), " +
                    "SUM(CASE WHEN v.kind = 'return' THEN -l.qty ELSE l.qty END * (l.price - l.cost)) " +
                    "FROM invoice_lines l JOIN invoices v ON v.id = l.invoice_id WHERE v.date BETWEEN ? AND ? AND v.deleted_at = '' " +
                    "GROUP BY IFNULL(l.item_id, -1), CASE WHEN l.item_id IS NULL THEN l.name ELSE '' END " +
                    "HAVING q > 0 ORDER BY q DESC, MAX(l.name) LIMIT 12", from, to))
                {
                    Dictionary<string, object> d = O("itemId", N(x[0]), "name", x[1], "qty", N(x[2]), "val", N(x[3]));
                    if (cost) d["profit"] = N(x[4]);
                    top.Add(d);
                }
                o["top"] = top;

                /* الراكد: عليه كمية ولم يُبع منذ 60 يوماً، الأكثر مالاً مجمَّداً أولاً */
                string since = ShopDb.Day(clock().AddDays(-60));
                List<object> dead = new List<object>();
                foreach (object[] x in s.Rows("SELECT i.id, i.title, i.home_place_id, " + QtyExpr + " AS q, i.cost FROM items i " +
                    "WHERE i.active = 1 AND (i.last_sold = '' OR i.last_sold < ?) AND i.created_at < ? AND " + QtyExpr + " > 0 " +
                    "ORDER BY q * i.cost DESC, i.title LIMIT 12", since, since))
                {
                    Dictionary<string, object> d = O("id", x[0], "title", x[1], "homePlaceId", x[2], "qty", N(x[3]));
                    if (cost) d["value"] = N(x[3]) * N(x[4]);
                    dead.Add(d);
                }
                o["dead"] = dead;
                o["debts"] = s.Long("SELECT IFNULL(SUM(balance), 0) FROM customers WHERE active = 1 AND balance > 0", 0);
                if (cost) o["stockCost"] = s.Long("SELECT IFNULL(SUM(st.qty * i.cost), 0) FROM item_stock st " +
                    "JOIN items i ON i.id = st.item_id AND i.active = 1 WHERE st.qty > 0", 0);
                return null;
            });
            return o;
        }

        /* ---------- الإشعارات ---------- */

        Dictionary<string, object> NotifyConfig()
        {
            return Setting("notify") as Dictionary<string, object>;
        }

        static bool NoteOn(Dictionary<string, object> cfg, string kind)
        {
            if (cfg == null || !Json.Bool(cfg, "enabled") || Json.Str(cfg, "topic").Trim().Length == 0) return false;
            Dictionary<string, object> kinds = Json.Obj(cfg, "kinds");
            return kinds != null && Json.Bool(kinds, kind);
        }

        Note MakeNote(Dictionary<string, object> cfg, string kind, string title, string message, int priority)
        {
            Note n = new Note();
            n.Server = Json.Str(cfg, "server").Trim();
            if (n.Server.Length == 0) n.Server = "https://ntfy.sh";
            n.Topic = Json.Str(cfg, "topic").Trim();
            n.Kind = kind;
            Dictionary<string, object> br = Setting("branch") as Dictionary<string, object>;
            string city = br == null ? "" : Json.Str(br, "city");
            n.Title = (city.Length > 0 ? "[" + city + "] " : "") + title;
            n.Message = message;
            n.Priority = priority;
            return n;
        }

        string Cur()
        {
            Dictionary<string, object> meta = Setting("meta") as Dictionary<string, object>;
            string c = meta == null ? "" : Json.Str(meta, "currency");
            return c.Length > 0 ? c : "د.ل";
        }

        string Money2(long dirhams)
        {
            return (dirhams / 1000m).ToString("0.00", CultureInfo.InvariantCulture) + " " + Cur();
        }

        /* بعد أمر نجح: إشعاراته إن كانت مفعّلة. لا يُفشل الأمر أبداً */
        void AfterRun(string name, Dictionary<string, object> req, object result)
        {
            if (Notified == null || (name != "sale" && name != "payment.add")) return;
            try
            {
                Dictionary<string, object> cfg = NotifyConfig();
                if (cfg == null || !Json.Bool(cfg, "enabled")) return;
                List<Note> l = name == "sale" ? SaleNotes(cfg, result as Dictionary<string, object>) : PayNotes(cfg, req, result);
                if (l.Count > 0) Notified(l);
            }
            catch (Exception) { }
        }

        List<Note> SaleNotes(Dictionary<string, object> cfg, Dictionary<string, object> res)
        {
            List<Note> l = new List<Note>();
            if (res == null || Json.Bool(res, "duplicate")) return l;
            long id = Json.Long(res, "id", 0), no = Json.Long(res, "no", 0), total = Json.Long(res, "total", 0), due = Json.Long(res, "due", 0);
            List<object[]> lines = db.Read<List<object[]>>(delegate (Sqlite s)
            {
                return s.Rows("SELECT IFNULL(item_id, 0), name, qty FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no", id);
            });
            if (total > 0)
            {
                StringBuilder names = new StringBuilder();
                foreach (object[] x in lines) names.Append(names.Length > 0 ? "، " : "").Append(x[1]).Append(" ×").Append(N(x[2]));
                double big = Json.Num(cfg, "bigAmount", 100);
                if (NoteOn(cfg, "sale"))
                    l.Add(MakeNote(cfg, "sale", "فاتورة " + no + " — " + Money2(total), names.ToString(), 3));
                else if (NoteOn(cfg, "bigsale") && total >= (long)Math.Round(big * 1000))
                    l.Add(MakeNote(cfg, "bigsale", "فاتورة كبيرة: " + Money2(total), "فاتورة رقم " + no + "\n" + names, 4));
            }
            if (due > 0 && NoteOn(cfg, "debt"))
            {
                object[] cu = db.Read<List<object[]>>(delegate (Sqlite s)
                {
                    return s.Rows("SELECT c.name, c.balance FROM invoices v JOIN customers c ON c.id = v.customer_id WHERE v.id = ?", id);
                }).Find(delegate (object[] x) { return true; });
                l.Add(MakeNote(cfg, "debt", "دين جديد: " + Money2(due),
                    (cu != null ? (string)cu[0] : "زبون") + " — إجمالي دينه الآن " + Money2(cu != null ? N(cu[1]) : 0), 3));
            }
            /* المخزون: عند عبور الحد فقط، لا مع كل بيعة */
            if (NoteOn(cfg, "out") || NoteOn(cfg, "low"))
            {
                Dictionary<long, long> sold = new Dictionary<long, long>();
                foreach (object[] x in lines)
                {
                    long it = N(x[0]);
                    if (it <= 0) continue;
                    long q;
                    sold.TryGetValue(it, out q);
                    sold[it] = q + N(x[2]);
                }
                foreach (KeyValuePair<long, long> kv in sold)
                {
                    ItemRow it = db.GetItem(kv.Key);
                    if (it == null) continue;
                    long q = db.ShopQty(it.Id), prev = q + kv.Value, m = it.Min;
                    string where = PlaceLine(it);
                    if (prev > 0 && q <= 0 && NoteOn(cfg, "out"))
                        l.Add(MakeNote(cfg, "out", "نفد: " + it.Title, (where.Length > 0 ? where + "\n" : "") + "بِيعت آخر نسخة للتو", 4));
                    else if (m > 0 && prev > m && q <= m && q > 0 && NoteOn(cfg, "low"))
                        l.Add(MakeNote(cfg, "low", "قارب على النفاد: " + it.Title, "المتبقي " + q + " فقط (حد التنبيه " + m + ")" +
                            (where.Length > 0 ? "\n" + where : ""), 3));
                }
            }
            return l;
        }

        List<Note> PayNotes(Dictionary<string, object> cfg, Dictionary<string, object> req, object result)
        {
            List<Note> l = new List<Note>();
            if (!NoteOn(cfg, "pay")) return l;
            long amount = Convert.ToInt64(result, CultureInfo.InvariantCulture);
            long cid = Json.Long(req, "customerId", 0);
            object[] cu = db.Read<List<object[]>>(delegate (Sqlite s)
            {
                return s.Rows("SELECT name, balance FROM customers WHERE id = ?", cid);
            }).Find(delegate (object[] x) { return true; });
            if (cu == null || amount <= 0) return l;
            l.Add(MakeNote(cfg, "pay", "تسديد: " + Money2(amount), (string)cu[0] + " — المتبقي عليه " + Money2(N(cu[1])), 3));
            return l;
        }

        /* «المكان: ط1 · قسم الجامعي · رف 2» */
        string PlaceLine(ItemRow it)
        {
            List<string> names = new List<string>();
            db.Read<object>(delegate (Sqlite s)
            {
                long id = it.HomePlaceId;
                for (int guard = 0; id > 0 && guard < 10; guard++)
                {
                    List<object[]> p = s.Rows("SELECT IFNULL(parent_id, 0), kind, name, code FROM places WHERE id = ?", id);
                    if (p.Count == 0 || (string)p[0][1] == "shop") break;
                    string n = (string)p[0][1] == "floor" && (string)p[0][3] != "" ? (string)p[0][3] : (string)p[0][2];
                    names.Insert(0, n);
                    id = (long)p[0][0];
                }
                return null;
            });
            string at = string.Join(" · ", names.ToArray());
            if (it.LocNote != "") at = at.Length > 0 ? at + " — " + it.LocNote : it.LocNote;
            return at.Length > 0 ? "المكان: " + at : "";
        }

        /* ملخص آخر اليوم: يسأله البرنامج كل دقيقة. null = ليس الآن.
           sentFor: آخر يوم أُرسل ملخصه. الرد ومعه اليوم في day */
        public Note DailyNote(string sentFor, out string day)
        {
            day = ShopDb.Day(clock());
            if (db.Replica) return null;
            Dictionary<string, object> cfg = NotifyConfig();
            /* lastDaily: ما أرسلته 3.x قبل النقل */
            if (!NoteOn(cfg, "daily") || sentFor == day || Json.Str(cfg, "lastDaily") == day) return null;
            double hour = Json.Num(cfg, "dailyHour", 20);
            if (clock().Hour < hour) return null;
            string d = day;
            object[] r = db.Read<object[]>(delegate (Sqlite s)
            {
                return s.Rows("SELECT COUNT(*), SUM(kind = 'sale'), IFNULL(SUM(total), 0), IFNULL(SUM(profit), 0) FROM invoices " +
                    "WHERE date = ? AND deleted_at = ''", d)[0];
            });
            /* بلا فواتير اليوم: لا ملخص، ولا يُسأل عنه ثانية اليوم */
            if (N(r[0]) == 0) return new Note();
            long low = db.Read<long>(delegate (Sqlite s)
            {
                return s.Long("SELECT COUNT(*) FROM items i WHERE i.active = 1 AND (" + QtyExpr + " <= 0 OR (i.min_qty > 0 AND " + QtyExpr + " <= i.min_qty))", 0);
            });
            /* الربح لا يُرسل إلا إن اختاره صاحب المحل: قناة ntfy يقرأها كل من يعرف اسمها */
            string body = "عدد الفواتير: " + N(r[1]) + "\nأصناف تحتاج شراء: " + low;
            if (Json.Bool(cfg, "dailyProfit")) body += "\nالربح: " + Money2(N(r[3]));
            return MakeNote(cfg, "daily", "ملخص اليوم — " + Money2(N(r[2])), body, 3);
        }
    }
}
