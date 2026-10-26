using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;

namespace Qirtasiya.Data
{
    /* خطأ يُعرض للبائع كما هو: «لا يمكن حذف زبون عليه دين» */
    public sealed class ShopException : Exception
    {
        public ShopException(string message) : base(message) { }
    }

    public sealed class OpenOptions
    {
        /* فارغ = مجلد backups بجانب ملف القاعدة */
        public string BackupDir = "";
        /* null = ترقيات البرنامج. الاختبار يمرّر قائمة أطول ليجرّب ترقية قادمة */
        public List<Migration> Migrations;
        public bool QuickCheck = true;
        public Func<DateTime> Clock;
    }

    /* ما حدث عند الفتح: يعرضه المحرك، ويُكتب في سجل الأخطاء إن لزم */
    public sealed class OpenReport
    {
        public string FilePath = "";
        public string SqliteVersion = "";
        public bool Created;
        public int VersionBefore, VersionNow, VersionLatest;
        public string Check = "";
        public long CheckMs;
        public string BackupFile = "";
        public List<string> Upgrades = new List<string>();
        public bool ReadOnly;
        public string ReadOnlyReason = "";
        /* فهرس البحث: كم صنفاً بُني من جديد (-1 = لم يُبنَ)، وكم صُلح، والوقت */
        public int SearchBuilt = -1, SearchFixed;
        public long SearchMs;
    }

    /* سياق الأمر الجاري: رقمه ووقته وصاحبه، وما يُكتب عنه في سجل العمليات */
    public sealed class Cmd
    {
        public readonly long OpId;
        public readonly string At;
        public readonly string Date;
        public readonly long UserId;
        public readonly string Kind;
        public string Detail = "";
        public string RefType = "";
        public long RefId;
        public string Before = "";
        public string After = "";
        public string Device = "";

        public Cmd(long opId, DateTime now, long userId, string kind)
        {
            OpId = opId;
            At = ShopDb.Stamp(now);
            Date = ShopDb.Day(now);
            UserId = userId;
            Kind = kind;
        }
    }

    /* ============================================================
       قاعدة بيانات المحل
       ------------------------------------------------------------
       كل تغيير يمر بـ Run: معاملة واحدة (كاملة أو لا شيء)، وصف في سجل
       العمليات، وصور الصفوف المتغيرة في سجل التغييرات عبر المُطلِقات.
       بعد COMMIT تكون البيعة على القرص (synchronous=FULL، قرار 0003)،
       وعندها فقط يقال «تم».

       العمليات نفسها في ShopDb.*.cs.
       ============================================================ */
    public sealed partial class ShopDb : IDisposable
    {
        /* أقل نسخة: جداول STRICT (3.37) ودوال JSON مدمجة (3.38). القرار 0003 */
        public const int MinSqlite = 3038000;

        readonly Sqlite db;
        readonly object gate = new object();
        readonly Func<DateTime> clock;
        public readonly OpenReport Report;

        ShopDb(Sqlite c, OpenReport r, Func<DateTime> clk)
        {
            db = c; Report = r; clock = clk;
        }

        public static string Stamp(DateTime t) { return t.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture); }
        public static string Day(DateTime t) { return t.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }

        public DateTime Now { get { return clock(); } }
        public bool ReadOnly { get { return Report.ReadOnly; } }
        public string FilePath { get { return Report.FilePath; } }

        /* ---------- الفتح ---------- */

        public static ShopDb Open(string path, OpenOptions o)
        {
            if (o == null) o = new OpenOptions();
            List<Migration> migs = o.Migrations ?? Schema.All();
            Func<DateTime> clk = o.Clock ?? (() => DateTime.Now);
            int latest = 0;
            foreach (Migration m in migs) if (m.Version > latest) latest = m.Version;

            OpenReport rep = new OpenReport();
            rep.FilePath = Path.GetFullPath(path);
            rep.SqliteVersion = Sqlite.Version;
            rep.VersionLatest = latest;
            if (Sqlite.VersionNumber < MinSqlite)
                throw new ShopException("نسخة SQLite " + rep.SqliteVersion + " أقدم من المطلوب (3.38).");

            bool existed = File.Exists(path) && new FileInfo(path).Length > 0;
            rep.Created = !existed;
            Sqlite c = Sqlite.Open(path, false, true);
            try
            {
                Pragmas(c);
                if (existed)
                {
                    long app = c.Long("PRAGMA application_id", 0);
                    long tables = c.Long("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'", 0);
                    if (app != Schema.AppId && (app != 0 || tables > 0))
                        throw new ShopException("هذا الملف ليس قاعدة بيانات المنظومة: " + path);
                    if (o.QuickCheck)
                    {
                        Stopwatch sw = Stopwatch.StartNew();
                        rep.Check = QuickCheck(c);
                        rep.CheckMs = sw.ElapsedMilliseconds;
                    }
                    else rep.Check = "ok";
                }
                else rep.Check = "ok";

                rep.VersionBefore = (int)c.Long("PRAGMA user_version", 0);
                rep.VersionNow = rep.VersionBefore;
                if (rep.Check != "ok")
                {
                    rep.ReadOnly = true;
                    rep.ReadOnlyReason = "ملف البيانات تالف: " + rep.Check;
                }
                else if (rep.VersionBefore > latest)
                {
                    rep.ReadOnly = true;
                    rep.ReadOnlyReason = "البيانات من نسخة أحدث من البرنامج (ترقية " + rep.VersionBefore +
                        "، والبرنامج يعرف حتى " + latest + "). حدّث البرنامج.";
                }
                else if (rep.VersionBefore < latest)
                {
                    /* نسخة قبل الترقية: إن فشلت ترقية لسبب لم نتوقعه، فالبيانات كما كانت هنا */
                    if (rep.VersionBefore > 0)
                    {
                        string dir = o.BackupDir;
                        if (string.IsNullOrEmpty(dir)) dir = Path.Combine(Path.GetDirectoryName(rep.FilePath), "backups");
                        Directory.CreateDirectory(dir);
                        /* نسخة قُطعت في منتصفها (انقطاع كهرباء) تبقى بامتداد tmp: لا قيمة لها */
                        foreach (string t in Directory.GetFiles(dir, "*.db.tmp")) { try { File.Delete(t); } catch (IOException) { } }
                        string name = "qirtasiya-before-v" + latest + "-" + clk().ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".db";
                        rep.BackupFile = VacuumInto(c, Path.Combine(dir, name));
                    }
                    migs.Sort(delegate (Migration a, Migration b) { return a.Version.CompareTo(b.Version); });
                    foreach (Migration m in migs)
                    {
                        if (m.Version <= rep.VersionNow) continue;
                        Apply(c, m, clk());
                        rep.VersionNow = m.Version;
                        rep.Upgrades.Add(m.Version + ": " + m.Name);
                    }
                }
            }
            catch
            {
                c.Dispose();
                throw;
            }

            if (rep.ReadOnly)
            {
                /* لا كتابة على ملف تالف أو أحدث منا: نعيد فتحه للقراءة فقط */
                c.Dispose();
                c = Sqlite.Open(path, true, false);
                c.Exec("PRAGMA foreign_keys = ON");
            }
            ShopDb shop = new ShopDb(c, rep, clk);
            try { shop.EnsureSearch(); }
            catch
            {
                shop.Dispose();
                throw;
            }
            return shop;
        }

        static void Pragmas(Sqlite c)
        {
            c.Exec("PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;");
            string mode = c.Text("PRAGMA journal_mode = WAL");
            if (!string.Equals(mode, "wal", StringComparison.OrdinalIgnoreCase))
                throw new ShopException("تعذّر تشغيل وضع WAL على ملف البيانات (الوضع: " + mode + ").");
            c.Exec("PRAGMA synchronous = FULL");
            if (c.Long("PRAGMA synchronous", -1) != 2) throw new ShopException("تعذّر ضبط الحفظ الكامل على القرص.");
        }

        public static string QuickCheck(Sqlite c)
        {
            List<string> bad = new List<string>();
            foreach (object[] r in c.Rows("PRAGMA quick_check")) bad.Add(Convert.ToString(r[0]));
            return (bad.Count == 1 && bad[0] == "ok") ? "ok" : string.Join("؛ ", bad.ToArray());
        }

        /* ترقية واحدة في معاملة واحدة: إن انقطعت الكهرباء في وسطها فالقاعدة
           على نسختها السابقة كاملة، وتُعاد الترقية عند الفتح التالي. */
        static void Apply(Sqlite c, Migration m, DateTime now)
        {
            c.Exec("BEGIN IMMEDIATE");
            bool ok = false;
            try
            {
                if (!string.IsNullOrEmpty(m.Sql)) c.Exec(m.Sql);
                long opId = NextOpId(c);
                c.Run("UPDATE cur_op SET op = ? WHERE id = 1", opId);
                Schema.RebuildTriggers(c);
                if (m.Code != null) m.Code(c, Stamp(now));
                c.Run("INSERT INTO ops(id, at, user_id, kind, detail) VALUES(?, ?, NULL, 'migrate', ?)",
                    opId, Stamp(now), "ترقية القاعدة إلى " + m.Version + ": " + m.Name);
                c.Exec("PRAGMA user_version = " + m.Version.ToString(CultureInfo.InvariantCulture) +
                    "; PRAGMA application_id = " + Schema.AppId.ToString(CultureInfo.InvariantCulture) + ";");
                c.Exec("COMMIT");
                ok = true;
            }
            finally
            {
                if (!ok) Rollback(c);
            }
        }

        /* رقم الأمر التالي. cur_op يحفظ آخر رقم أُعطي، فلا يعود رقم ولو أُرشف
           السجل القديم؛ وMAX(ops) يحمي بعد استرجاع نسخة. */
        static long NextOpId(Sqlite c)
        {
            long a = c.Long("SELECT op FROM cur_op WHERE id = 1", 0);
            long b = c.Long("SELECT MAX(id) FROM ops", 0);
            return Math.Max(a, b) + 1;
        }

        static void Rollback(Sqlite c)
        {
            try { if (!c.AutoCommit) c.Exec("ROLLBACK"); }
            catch { }
        }

        /* نسخة مضغوطة متّسقة إلى ملف مؤقت ثم إعادة تسمية: لا يبقى ملف نصف مكتوب */
        static string VacuumInto(Sqlite c, string dest)
        {
            string tmp = dest + ".tmp";
            if (File.Exists(tmp)) File.Delete(tmp);
            c.Run("VACUUM INTO ?", tmp);
            if (File.Exists(dest)) File.Delete(dest);
            File.Move(tmp, dest);
            return dest;
        }

        /* ---------- الأوامر ---------- */

        public T Run<T>(string kind, long userId, Func<Cmd, T> body)
        {
            lock (gate)
            {
                if (Report.ReadOnly) throw new ShopException("لا يمكن الحفظ: " + Report.ReadOnlyReason);
                db.Exec("BEGIN IMMEDIATE");
                bool ok = false;
                searchTouched = searchRebuilt = false;
                try
                {
                    long opId = NextOpId(db);
                    db.Run("UPDATE cur_op SET op = ? WHERE id = 1", opId);
                    Cmd cmd = new Cmd(opId, clock(), userId, kind);
                    T r = body(cmd);
                    db.Run("INSERT INTO ops(id, at, user_id, kind, detail, ref_type, ref_id, before, after, device) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        opId, cmd.At, userId > 0 ? (object)userId : null, kind, cmd.Detail ?? "", cmd.RefType ?? "", cmd.RefId,
                        cmd.Before ?? "", cmd.After ?? "", cmd.Device ?? "");
                    db.Exec("COMMIT");
                    ok = true;
                    if (searchTouched) Interlocked.Increment(ref searchGen);
                    if (searchRebuilt) lock (vocabGate) vocabEpoch++;
                    return r;
                }
                finally
                {
                    if (!ok) Rollback(db);
                    searchTouched = searchRebuilt = false;
                }
            }
        }

        public void Run(string kind, long userId, Action<Cmd> body)
        {
            Run<bool>(kind, userId, delegate (Cmd c) { body(c); return true; });
        }

        /* قراءة تحت القفل نفسه: لا تتداخل مع أمر جارٍ من خيط آخر */
        public T Read<T>(Func<Sqlite, T> body)
        {
            lock (gate) return body(db);
        }

        /* ---------- النسخ والفحص ---------- */

        public string BackupTo(string dest)
        {
            lock (gate)
            {
                string dir = Path.GetDirectoryName(Path.GetFullPath(dest));
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                return VacuumInto(db, dest);
            }
        }

        /* فحص كامل: سلامة الملف، والمفاتيح، وأن كل كمية ودين = مجموع حركاته.
           يعيد قائمة المشاكل، وفارغة = سليمة. أبطأ من فحص الفتح، فيُشغَّل مع
           النسخة اليومية وفي الاختبارات. */
        public List<string> FullCheck()
        {
            lock (gate)
            {
                List<string> bad = new List<string>();
                foreach (object[] r in db.Rows("PRAGMA integrity_check"))
                    if (Convert.ToString(r[0]) != "ok") bad.Add("سلامة: " + r[0]);
                foreach (object[] r in db.Rows("PRAGMA foreign_key_check"))
                    bad.Add("مفتاح: جدول " + r[0] + " صف " + r[1] + " يشير إلى " + r[2] + " غير موجود");
                foreach (object[] r in db.Rows(
                    "SELECT s.item_id, s.place_id, s.qty, IFNULL(m.t, 0) FROM item_stock s " +
                    "LEFT JOIN (SELECT item_id, place_id, SUM(delta) AS t FROM stock_moves GROUP BY item_id, place_id) m " +
                    "ON m.item_id = s.item_id AND m.place_id = s.place_id WHERE s.qty <> IFNULL(m.t, 0)"))
                    bad.Add("كمية: صنف " + r[0] + " مكان " + r[1] + " مسجَّل " + r[2] + " والحركات " + r[3]);
                foreach (object[] r in db.Rows(
                    "SELECT m.item_id, m.place_id, SUM(m.delta) FROM stock_moves m WHERE NOT EXISTS " +
                    "(SELECT 1 FROM item_stock s WHERE s.item_id = m.item_id AND s.place_id = m.place_id) " +
                    "GROUP BY m.item_id, m.place_id HAVING SUM(m.delta) <> 0"))
                    bad.Add("كمية: حركات لصنف " + r[0] + " في مكان " + r[1] + " بلا رصيد");
                foreach (object[] r in db.Rows(
                    "SELECT c.id, c.balance, IFNULL(m.t, 0) FROM customers c " +
                    "LEFT JOIN (SELECT customer_id, SUM(delta) AS t FROM customer_moves GROUP BY customer_id) m " +
                    "ON m.customer_id = c.id WHERE c.balance <> IFNULL(m.t, 0)"))
                    bad.Add("دين: زبون " + r[0] + " رصيده " + r[1] + " والحركات " + r[2]);
                /* الفواتير المنقولة من 3.x تبقى بأرقامها كما كانت، ولو كتبت نسخة قديمة
                   مجموعاً لا يطابق أسطره؛ تقرير النقل قالها مرة. يُفحص ما بعدها */
                foreach (object[] r in db.Rows(
                    "SELECT v.no FROM invoices v WHERE v.old_id = '' AND (v.total <> v.subtotal - v.discount OR v.subtotal <> " +
                    "(CASE v.kind WHEN 'return' THEN -1 ELSE 1 END) * IFNULL((SELECT SUM(l.qty * l.price) FROM invoice_lines l WHERE l.invoice_id = v.id), 0))"))
                    bad.Add("فاتورة " + r[0] + ": المجموع لا يطابق أسطرها");
                foreach (object[] r in db.Rows(
                    "SELECT v.no FROM invoices v WHERE NOT EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = v.id)"))
                    bad.Add("فاتورة " + r[0] + " بلا أسطر");
                long orphan = db.Long("SELECT (SELECT COUNT(*) FROM stock_moves WHERE op_id NOT IN (SELECT id FROM ops)) + " +
                    "(SELECT COUNT(*) FROM customer_moves WHERE op_id NOT IN (SELECT id FROM ops))", 0);
                if (orphan > 0) bad.Add(orphan + " حركة بلا أمر في سجل العمليات");
                long maxNo = db.Long("SELECT MAX(no) FROM invoices", 0);
                long ctr = db.Long("SELECT value FROM counters WHERE name = 'invoice'", 0);
                if (ctr < maxNo) bad.Add("عدّاد الفواتير " + ctr + " أقل من آخر فاتورة " + maxNo);
                CheckSearch(bad);
                return bad;
            }
        }

        /* ---------- سجل التغييرات ---------- */

        public sealed class Change
        {
            public long Seq, OpId, RowId;
            public string Table, Op, Data;
        }

        public List<Change> ChangesSince(long seq, int limit)
        {
            lock (gate)
            {
                List<Change> list = new List<Change>();
                foreach (object[] r in db.Rows("SELECT seq, op_id, tbl, row_id, op, data FROM change_log WHERE seq > ? ORDER BY seq LIMIT ?", seq, limit))
                {
                    Change c = new Change();
                    c.Seq = (long)r[0]; c.OpId = (long)r[1]; c.Table = (string)r[2];
                    c.RowId = (long)r[3]; c.Op = (string)r[4]; c.Data = r[5] as string;
                    list.Add(c);
                }
                return list;
            }
        }

        /* يطبّق تغييرات مسجّلة على قاعدة أخرى (الاسترجاع، واختبار أن السجل
           كامل). المفاتيح تُفحص بعد الكل: ترتيب الصفوف داخل الأمر الواحد قد
           يسبق فيه الابن أباه. */
        public static void ApplyChanges(Sqlite target, IEnumerable<Change> changes)
        {
            target.Exec("PRAGMA foreign_keys = OFF");
            target.Exec("BEGIN IMMEDIATE");
            bool ok = false;
            HashSet<long> items = new HashSet<long>();
            try
            {
                foreach (Change c in changes)
                {
                    if (!Schema.IsLogged(c.Table)) continue;
                    if (c.Table == "items") items.Add(c.RowId);
                    if (c.Op == "d")
                    {
                        target.Run("DELETE FROM \"" + c.Table + "\" WHERE id = ?", c.RowId);
                        continue;
                    }
                    Dictionary<string, object> row = (Dictionary<string, object>)Json.Parse(c.Data);
                    StringBuilder cols = new StringBuilder(), qs = new StringBuilder(), set = new StringBuilder();
                    object[] vals = new object[row.Count];
                    int i = 0;
                    foreach (KeyValuePair<string, object> kv in row)
                    {
                        if (i > 0) { cols.Append(','); qs.Append(','); }
                        cols.Append('"').Append(kv.Key).Append('"');
                        qs.Append('?');
                        if (kv.Key != "id")
                        {
                            if (set.Length > 0) set.Append(',');
                            set.Append('"').Append(kv.Key).Append("\" = excluded.\"").Append(kv.Key).Append('"');
                        }
                        vals[i++] = kv.Value;
                    }
                    target.Run("INSERT INTO \"" + c.Table + "\"(" + cols + ") VALUES(" + qs + ") ON CONFLICT(id) DO " +
                        (set.Length > 0 ? "UPDATE SET " + set : "NOTHING"), vals);
                }
                /* فهرس البحث لا يُسجَّل: يُكتب هنا لكل صنف تغيّر */
                if (items.Count > 0 && HasSearch(target)) foreach (long id in items) SearchIndex(target, id);
                target.Exec("COMMIT");
                ok = true;
            }
            finally
            {
                if (!ok) Rollback(target);
                target.Exec("PRAGMA foreign_keys = ON");
            }
        }

        public void Dispose()
        {
            CloseReader();
            lock (gate) db.Dispose();
        }

        /* ---------- أدوات مشتركة للعمليات ---------- */

        static ShopException Err(string message) { return new ShopException(message); }

        long Counter(string name)
        {
            db.Run("UPDATE counters SET value = value + 1 WHERE name = ?", name);
            return db.Long("SELECT value FROM counters WHERE name = ?", 0, name);
        }

        /* «12.5» دينار للعرض في السجل. المبالغ داخل القاعدة دراهم دائماً */
        public static string Money(long dirhams)
        {
            return (dirhams / 1000m).ToString("0.###", CultureInfo.InvariantCulture);
        }

        /* تقريب نصف الدرهم للأعلى (قرار 0006): a × b ÷ c */
        public static long MulDiv(long a, long b, long c)
        {
            if (c == 0) throw new DivideByZeroException();
            decimal v = (decimal)a * b / c;
            return (long)Math.Round(v, MidpointRounding.AwayFromZero);
        }
    }
}
