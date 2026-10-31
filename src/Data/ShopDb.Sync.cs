using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Threading;

namespace Qirtasiya.Data
{
    /* الجهاز الثاني لا يكتب في قاعدته: الأمر يُرسل لجهاز المحل (قرار 0023).
       ليس ShopException: لا يُعرض خطأً، والمحرك يحوّله لأمر منتظر. */
    public sealed class ReplicaWriteException : Exception
    {
        public ReplicaWriteException() : base("هذا جهاز ثانٍ: الأمر يُرسل لجهاز المحل.") { }
    }

    /* أمر جهاز ثانٍ ينفّذه جهاز المحل الآن */
    public sealed class RemoteCmd
    {
        public long Id, N, UserId;
        public string Device = "", Label = "", Cmd = "";
        public bool Recorded;
    }

    /* صف من سجل التغييرات كما يصل للجهاز الثاني */
    public sealed class SyncRow
    {
        public long Seq;
        public string Table = "", Op = "";
        public long RowId;
        public Dictionary<string, object> Row;
    }

    /* ============================================================
       المزامنة (قرار 0023)
       ------------------------------------------------------------
       - جهاز المحل (الأساسي): يعطي قطعاً من سجل التغييرات بالترتيب، وينفّذ
         أوامر الأجهزة الثانية بقواعده نفسها، كل أمر مرة واحدة.
       - الجهاز الثاني: نسخة من قاعدة المحل. لا يكتب فيها شيئاً بنفسه (Run
         يرفض)، يطبّق قطع السجل، وما يفعله البائع عنده ينتظر في sync_outbox
         حتى ينفّذه جهاز المحل ويرجع مع السجل.
       - قوائم كتب الفروع الأخرى في remote_items، للبحث فيها.
       الاتصال بالخادم في Program.cs؛ هنا القاعدة وحدها.
       ============================================================ */
    public sealed partial class ShopDb
    {
        bool replica;
        [ThreadStatic] static RemoteCmd remote;

        public bool Replica { get { return replica; } }

        void LoadRole()
        {
            replica = db.Text("SELECT value FROM local_state WHERE key = 'sync.role'") == "second";
        }

        /* ---------- حالة هذا الجهاز (لا تُسجَّل ولا تصل لجهاز آخر) ---------- */

        public string Local(string key)
        {
            lock (gate) return db.Text("SELECT value FROM local_state WHERE key = ?", key);
        }

        public long LocalLong(string key, long def)
        {
            string v = Local(key);
            long l;
            return v != null && long.TryParse(v, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out l) ? l : def;
        }

        public void SetLocal(string key, string value)
        {
            Dictionary<string, string> d = new Dictionary<string, string>();
            d[key] = value;
            SetLocals(d);
        }

        /* عدة قيم معاً، كلها أو لا شيء. null = تُحذف */
        public void SetLocals(Dictionary<string, string> values)
        {
            lock (gate)
            {
                if (Report.ReadOnly) throw new ShopException("لا يمكن الحفظ: " + Report.ReadOnlyReason);
                db.Exec("BEGIN IMMEDIATE");
                bool ok = false;
                try
                {
                    foreach (KeyValuePair<string, string> kv in values)
                    {
                        if (kv.Value == null) db.Run("DELETE FROM local_state WHERE key = ?", kv.Key);
                        else db.Run("INSERT INTO local_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", kv.Key, kv.Value);
                    }
                    db.Exec("COMMIT");
                    ok = true;
                }
                finally
                {
                    if (!ok) Rollback(db);
                }
                if (values.ContainsKey("sync.role")) LoadRole();
            }
        }

        /* إعدادات الربط كلها من هذا الجهاز تُمسح (إيقاف الربط، أو قبل الانضمام) */
        public void ClearSync()
        {
            lock (gate)
            {
                if (Report.ReadOnly) return;
                db.Run("DELETE FROM local_state WHERE key LIKE 'sync.%'");
                db.Run("DELETE FROM sync_outbox");
                LoadRole();
            }
        }

        /* ---------- جهاز المحل: السجل ---------- */

        /* آخر رقم أُعطي في السجل (ولو قُصّ ما قبله) */
        public long LogSeq()
        {
            lock (gate) return db.Long("SELECT seq FROM sqlite_sequence WHERE name = 'change_log'", 0);
        }

        public int SchemaVersion
        {
            get { lock (gate) return (int)db.Long("PRAGMA user_version", 0); }
        }

        /* قطعة من السجل بعد after نصاً JSON: [[seq,"tbl",row,"i",{...}],...]. تنتهي عند آخر
           صف من أمر كامل ما لم يتجاوز الأمر وحده hardRows، فلا يرى الجهاز الثاني بيعة بلا أسطرها */
        public string LogChunk(long after, int maxRows, int hardRows, out long from, out long to)
        {
            from = -1; to = -1;
            lock (gate)
            {
                List<object[]> rows = db.Rows("SELECT seq, op_id, tbl, row_id, op, data FROM change_log WHERE seq > ? ORDER BY seq LIMIT ?",
                    after, hardRows + 1);
                if (rows.Count == 0) return null;
                int n = Math.Min(rows.Count, maxRows);
                if (n < rows.Count)
                {
                    long op = (long)rows[n - 1][1];
                    while (n < rows.Count && n < hardRows && (long)rows[n][1] == op) n++;
                }
                StringBuilder sb = new StringBuilder("[");
                for (int i = 0; i < n; i++)
                {
                    object[] r = rows[i];
                    if (i > 0) sb.Append(',');
                    sb.Append('[').Append(((long)r[0]).ToString(CultureInfo.InvariantCulture)).Append(',');
                    Json.Quote(sb, (string)r[2]);
                    sb.Append(',').Append(((long)r[3]).ToString(CultureInfo.InvariantCulture)).Append(',');
                    Json.Quote(sb, (string)r[4]);
                    /* الصورة نفسها JSON صالح من json_object: تُضمَّن كما هي */
                    sb.Append(',').Append(r[5] as string ?? "null").Append(']');
                }
                sb.Append(']');
                from = (long)rows[0][0];
                to = (long)rows[n - 1][0];
                return sb.ToString();
            }
        }

        /* ---------- الجهاز الثاني: تطبيق السجل ---------- */

        public static List<SyncRow> ParseChunk(string json)
        {
            List<SyncRow> list = new List<SyncRow>();
            List<object> arr = Json.Parse(json) as List<object>;
            if (arr == null) throw new ShopException("قطعة سجل غير مفهومة.");
            foreach (object o in arr)
            {
                List<object> a = o as List<object>;
                if (a == null || a.Count != 5) throw new ShopException("صف سجل غير مفهوم.");
                SyncRow r = new SyncRow();
                r.Seq = Convert.ToInt64(a[0], CultureInfo.InvariantCulture);
                r.Table = (string)a[1];
                r.RowId = Convert.ToInt64(a[2], CultureInfo.InvariantCulture);
                r.Op = (string)a[3];
                r.Row = a[4] as Dictionary<string, object>;
                if (r.Op != "d" && r.Row == null) throw new ShopException("صف سجل بلا صورة.");
                list.Add(r);
            }
            return list;
        }

        /* يطبّق ما بعد applied فقط (القطعة قد تبدأ قبله)، ثم يحفظ آخر رقم في المعاملة
           نفسها: انقطاع الكهرباء في الوسط يعيد القطعة كاملة، لا نصفها */
        public long ApplyRemote(List<SyncRow> rows, long upTo)
        {
            bool x3 = false;
            long n = ApplyRemoteRows(rows, upTo, ref x3);
            /* بيانات 3.x تغيّرت هنا، أو نفّذ جهاز المحل ما كان ينتظر: الواجهة تعيد التحميل */
            if (x3) X3Touched();
            return n;
        }

        long ApplyRemoteRows(List<SyncRow> rows, long upTo, ref bool x3)
        {
            lock (gate)
            {
                if (!replica) throw new ShopException("هذا ليس جهازاً ثانياً.");
                long applied = 0;
                long cur = db.Long("SELECT CAST(value AS INTEGER) FROM local_state WHERE key = 'sync.applied'", -1);
                db.Exec("PRAGMA foreign_keys = OFF");
                db.Exec("BEGIN IMMEDIATE");
                bool ok = false;
                HashSet<long> items = new HashSet<long>();
                try
                {
                    long before = db.Long("SELECT seq FROM sqlite_sequence WHERE name = 'change_log'", 0);
                    foreach (SyncRow r in rows)
                    {
                        if (r.Seq <= cur) continue;
                        ApplyRow(db, r.Table, r.RowId, r.Op, r.Row, items);
                        if (r.Table == "x3_docs" || r.Table == "remote_cmds") x3 = true;
                        applied++;
                    }
                    /* صور الصفوف المطبّقة كتبتها المُطلِقات هنا أيضاً: هذا الجهاز لا يرفع سجلاً */
                    db.Run("DELETE FROM change_log WHERE seq > ?", before);
                    foreach (long id in items) IndexItemReplica(id);
                    db.Run("INSERT INTO local_state(key, value) VALUES('sync.applied', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        Math.Max(cur, upTo).ToString(CultureInfo.InvariantCulture));
                    db.Exec("COMMIT");
                    ok = true;
                }
                finally
                {
                    if (!ok) Rollback(db);
                    db.Exec("PRAGMA foreign_keys = ON");
                }
                if (items.Count > 0) Interlocked.Increment(ref searchGen);
                return applied;
            }
        }

        void IndexItemReplica(long id)
        {
            if (!searchOn) return;
            IndexText x = SearchIndex(db, id);
            if (x != null && x.Terms.Length > 0) lock (vocabGate) vocabNew.AddRange(x.Terms.Split(' '));
        }

        /* ---------- جهاز المحل: أوامر الأجهزة الثانية ---------- */

        public bool RemoteDone(long id)
        {
            lock (gate) return db.Long("SELECT COUNT(*) FROM remote_cmds WHERE id = ?", 0, id) > 0;
        }

        /* الأمر الجاري على هذا الخيط من جهاز ثانٍ: Run يسجّله في معاملته */
        public static void BeginRemote(RemoteCmd r) { remote = r; }
        /* الأمر الجاري هنا من جهاز ثانٍ؟ (أرقام فواتير 3.x تُعطى هنا) */
        public static bool InRemote { get { return remote != null; } }
        public static void EndRemote() { remote = null; }

        void RecordRemote(RemoteCmd r, string at, bool ok, string error, long opId)
        {
            db.Run("INSERT INTO remote_cmds(id, device, n, user_id, cmd, at, ok, error, op_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                r.Id, r.Device, r.N, r.UserId > 0 ? (object)r.UserId : null, r.Cmd, at, ok ? 1L : 0L, error ?? "", opId);
        }

        /* أمر انتهى بلا كتابة (أو رُفض): يُسجَّل وحده، فيعرف الجهاز الثاني ما حدث */
        public void FinishRemote(RemoteCmd r, bool ok, string error)
        {
            if (r.Recorded) return;
            RemoteCmd keep = remote;
            remote = null;
            try
            {
                Run(ok ? "remote-ok" : "remote-fail", r.UserId, delegate (Cmd c)
                {
                    if (db.Long("SELECT COUNT(*) FROM remote_cmds WHERE id = ?", 0, r.Id) > 0) return;
                    RecordRemote(r, c.At, ok, error, c.OpId);
                    c.Detail = (ok ? "أمر من جهاز ثانٍ: " : "رُفض أمر من جهاز ثانٍ: ") + r.Cmd + (ok ? "" : " — " + error);
                    c.Device = r.Label;
                });
                r.Recorded = true;
            }
            finally { remote = keep; }
        }

        /* ---------- الجهاز الثاني: ما ينتظر جهاز المحل ---------- */

        public long OutboxAdd(long userId, string cmd, string body, string label)
        {
            lock (gate)
            {
                if (Report.ReadOnly) throw new ShopException("لا يمكن الحفظ: " + Report.ReadOnlyReason);
                return db.Insert("INSERT INTO sync_outbox(at, user_id, cmd, body, label) VALUES(?, ?, ?, ?, ?)",
                    Stamp(clock()), userId, cmd, body ?? "{}", label ?? "");
            }
        }

        public sealed class OutboxRow
        {
            public long N, UserId, SentId;
            public string At = "", Cmd = "", Body = "", Label = "";
        }

        public List<OutboxRow> OutboxUnsent()
        {
            lock (gate)
            {
                List<OutboxRow> l = new List<OutboxRow>();
                foreach (object[] r in db.Rows("SELECT n, at, user_id, cmd, body, label FROM sync_outbox WHERE sent_id = 0 ORDER BY n"))
                {
                    OutboxRow o = new OutboxRow();
                    o.N = (long)r[0]; o.At = (string)r[1]; o.UserId = (long)r[2]; o.Cmd = (string)r[3]; o.Body = (string)r[4]; o.Label = (string)r[5];
                    l.Add(o);
                }
                return l;
            }
        }

        public void OutboxSent(long n, long serverId)
        {
            lock (gate) db.Run("UPDATE sync_outbox SET sent_id = ? WHERE n = ?", serverId, n);
        }

        /* ما أُرسل ولم يُنفَّذ بعد، وما رُفض: للواجهة. المنفَّذ بنجاح يُحذف بعد يوم */
        public List<Dictionary<string, object>> OutboxView()
        {
            lock (gate)
            {
                string device = db.Text("SELECT value FROM local_state WHERE key = 'sync.device'") ?? "";
                if (!Report.ReadOnly)
                    db.Run("DELETE FROM sync_outbox WHERE n IN (SELECT o.n FROM sync_outbox o JOIN remote_cmds r ON r.device = ? AND r.n = o.n " +
                        "WHERE r.ok = 1 AND r.at < ?)", device, Stamp(clock().AddDays(-1)));
                List<Dictionary<string, object>> l = new List<Dictionary<string, object>>();
                foreach (object[] r in db.Rows("SELECT o.n, o.at, o.cmd, o.label, o.sent_id, r.ok, r.error, r.at FROM sync_outbox o " +
                    "LEFT JOIN remote_cmds r ON r.device = ? AND r.n = o.n ORDER BY o.n", device))
                {
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["n"] = r[0]; d["at"] = r[1]; d["cmd"] = r[2]; d["label"] = r[3];
                    d["state"] = r[5] == null ? ((long)r[4] > 0 ? "sent" : "waiting") : ((long)r[5] == 1 ? "done" : "failed");
                    if (r[6] != null && ((string)r[6]).Length > 0) d["error"] = r[6];
                    if (r[7] != null) d["doneAt"] = r[7];
                    l.Add(d);
                }
                return l;
            }
        }

        /* المرفوض أو المنفَّذ يُزال من القائمة. المنتظر لا: جهاز المحل سينفّذه */
        public void OutboxDismiss(long n)
        {
            lock (gate)
            {
                string device = db.Text("SELECT value FROM local_state WHERE key = 'sync.device'") ?? "";
                if (db.Run("DELETE FROM sync_outbox WHERE n = ? AND EXISTS (SELECT 1 FROM remote_cmds r WHERE r.device = ? AND r.n = ?)", n, device, n) == 0)
                    throw new ShopException("لم ينفّذه جهاز المحل بعد: يبقى حتى يصله.");
            }
        }

        /* ---------- قائمة كتب هذا الفرع للفروع الأخرى ---------- */

        /* {"v":1,"branch":{...},"at":"...","items":[[kind,code,title,author,barcode,cat,qty,store,price,place],...]}
           qty = ما في المحل (أرض البيع وغرفة الخزين)، store = ما في المخازن، والمبالغ بالدرهم */
        public string CatalogJson(out int count)
        {
            lock (gate)
            {
                /* بواجهة 3.x البيانات في x3_docs، لا في الجداول (قرار 0025) */
                if (db.Text("SELECT value FROM settings WHERE key = 'ui'") == "\"3x\"") return X3CatalogJson(out count);
                Dictionary<long, string> paths = PlacePaths();
                Dictionary<string, object> branch = Json.Parse(db.Text("SELECT value FROM settings WHERE key = 'branch'") ?? "{}") as Dictionary<string, object>
                    ?? new Dictionary<string, object>();
                Dictionary<string, object> meta = Json.Parse(db.Text("SELECT value FROM settings WHERE key = 'meta'") ?? "{}") as Dictionary<string, object>
                    ?? new Dictionary<string, object>();
                StringBuilder sb = new StringBuilder();
                sb.Append("{\"v\":1,\"branch\":{\"id\":");
                Json.Quote(sb, Json.Str(branch, "id"));
                sb.Append(",\"name\":");
                Json.Quote(sb, Json.Str(meta, "shopName").Length > 0 ? Json.Str(meta, "shopName") : Json.Str(branch, "name"));
                sb.Append(",\"city\":");
                Json.Quote(sb, Json.Str(branch, "city"));
                sb.Append(",\"phone\":");
                Json.Quote(sb, Json.Str(meta, "phone"));
                sb.Append("},\"at\":");
                Json.Quote(sb, Stamp(clock()));
                sb.Append(",\"items\":[");
                count = 0;
                foreach (object[] r in db.Rows("SELECT i.kind, i.code, i.title, i.author, i.brand, i.barcode, i.cat, " +
                    "IFNULL(q.qty, 0), IFNULL(w.qty, 0), i.price, i.home_place_id FROM items i " +
                    "LEFT JOIN (SELECT s.item_id, SUM(s.qty) AS qty FROM item_stock s JOIN places p ON p.id = s.place_id WHERE p.kind <> 'store' GROUP BY s.item_id) q ON q.item_id = i.id " +
                    "LEFT JOIN (SELECT s.item_id, SUM(s.qty) AS qty FROM item_stock s JOIN places p ON p.id = s.place_id WHERE p.kind = 'store' GROUP BY s.item_id) w ON w.item_id = i.id " +
                    "WHERE i.active = 1 ORDER BY i.id"))
                {
                    if (count++ > 0) sb.Append(',');
                    sb.Append('[');
                    Json.Quote(sb, (string)r[0]); sb.Append(',');
                    Json.Quote(sb, (string)r[1]); sb.Append(',');
                    Json.Quote(sb, (string)r[2]); sb.Append(',');
                    string by = (string)r[3];
                    Json.Quote(sb, by.Length > 0 ? by : (string)r[4]); sb.Append(',');
                    Json.Quote(sb, (string)r[5]); sb.Append(',');
                    Json.Quote(sb, (string)r[6]); sb.Append(',');
                    sb.Append(((long)r[7]).ToString(CultureInfo.InvariantCulture)).Append(',');
                    sb.Append(((long)r[8]).ToString(CultureInfo.InvariantCulture)).Append(',');
                    sb.Append(((long)r[9]).ToString(CultureInfo.InvariantCulture)).Append(',');
                    string path;
                    Json.Quote(sb, paths.TryGetValue((long)r[10], out path) ? path : "");
                    sb.Append(']');
                }
                sb.Append("]}");
                return sb.ToString();
            }
        }

        /* القائمة نفسها بصيغة 3.x للتطبيق في التلفون وموقع المكتبة (يقرآن /put القديم):
           k الرمز، t النوع، n الاسم، a المؤلف، b الباركود، c التصنيف، q ما في المحل، st منه
           في غرفة الخزين، p السعر بالدينار، m حدّ التنبيه، l/s الخزانة والرف، loc المكان */
        public string Snapshot3x(out int count)
        {
            lock (gate)
            {
                Dictionary<long, object[]> places = new Dictionary<long, object[]>();
                foreach (object[] r in db.Rows("SELECT id, IFNULL(parent_id, 0), kind, code, name FROM places")) places[(long)r[0]] = r;
                Dictionary<long, string> paths = PlacePaths();
                Dictionary<string, object> branch = Json.Parse(db.Text("SELECT value FROM settings WHERE key = 'branch'") ?? "{}") as Dictionary<string, object>
                    ?? new Dictionary<string, object>();
                Dictionary<string, object> meta = Json.Parse(db.Text("SELECT value FROM settings WHERE key = 'meta'") ?? "{}") as Dictionary<string, object>
                    ?? new Dictionary<string, object>();
                List<object> items = new List<object>();
                foreach (object[] r in db.Rows("SELECT i.code, i.kind, i.title, i.author, i.brand, i.barcode, i.cat, IFNULL(q.qty, 0), IFNULL(m.qty, 0), " +
                    "i.price, i.min_qty, i.home_place_id, i.publisher, i.note, i.unit, i.last_sold FROM items i " +
                    "LEFT JOIN (SELECT s.item_id, SUM(s.qty) AS qty FROM item_stock s JOIN places p ON p.id = s.place_id WHERE p.kind <> 'store' GROUP BY s.item_id) q ON q.item_id = i.id " +
                    "LEFT JOIN (SELECT s.item_id, SUM(s.qty) AS qty FROM item_stock s JOIN places p ON p.id = s.place_id WHERE p.kind = 'room' GROUP BY s.item_id) m ON m.item_id = i.id " +
                    "WHERE i.active = 1 ORDER BY i.id"))
                {
                    Dictionary<string, object> it = new Dictionary<string, object>();
                    it["k"] = r[0]; it["t"] = r[1]; it["n"] = r[2];
                    it["a"] = ((string)r[3]).Length > 0 ? r[3] : r[4];
                    it["b"] = r[5]; it["c"] = r[6]; it["q"] = r[7];
                    if ((long)r[8] > 0) it["st"] = r[8];
                    it["p"] = (long)r[9] / 1000.0; it["m"] = r[10];
                    object[] home, parent;
                    string lib = "", shelf = "";
                    if (places.TryGetValue((long)r[11], out home) && (string)home[2] == "shelf")
                    {
                        shelf = (string)home[3];
                        if (places.TryGetValue((long)home[1], out parent) && (string)parent[2] == "cabinet") lib = (string)parent[3];
                    }
                    it["l"] = lib; it["s"] = shelf;
                    string path;
                    it["loc"] = paths.TryGetValue((long)r[11], out path) ? path : "";
                    it["d"] = r[12]; it["nt"] = r[13]; it["u"] = r[14];
                    if (((string)r[15]).Length > 0) it["ls"] = r[15];
                    items.Add(it);
                }
                count = items.Count;
                Dictionary<string, object> b = new Dictionary<string, object>();
                b["id"] = Json.Str(branch, "id");
                b["name"] = Json.Str(meta, "shopName").Length > 0 ? Json.Str(meta, "shopName") : Json.Str(branch, "name");
                b["city"] = Json.Str(branch, "city");
                b["phone"] = Json.Str(meta, "phone");
                Dictionary<string, object> snap = new Dictionary<string, object>();
                snap["branch"] = b;
                snap["at"] = clock().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
                snap["items"] = items;
                snap["v4"] = true;
                return Json.Write(snap);
            }
        }

        /* «ط1 · قسم الجامعي · خزانة A · رف 2»: الطابق برمزه، والباقي باسمه */
        Dictionary<long, string> PlacePaths()
        {
            Dictionary<long, object[]> byId = new Dictionary<long, object[]>();
            foreach (object[] r in db.Rows("SELECT id, IFNULL(parent_id, 0), kind, name, code FROM places")) byId[(long)r[0]] = r;
            Dictionary<long, string> paths = new Dictionary<long, string>();
            foreach (KeyValuePair<long, object[]> kv in byId)
            {
                List<string> names = new List<string>();
                object[] x = kv.Value;
                int guard = 0;
                while (x != null && (string)x[2] != "shop" && guard++ < 12)
                {
                    string code = (string)x[4];
                    names.Insert(0, (string)x[2] == "floor" && code.Length > 0 ? code : (string)x[3]);
                    object[] parent;
                    x = byId.TryGetValue((long)x[1], out parent) ? parent : null;
                }
                paths[kv.Key] = string.Join(" · ", names.ToArray());
            }
            return paths;
        }

        /* قائمة فرع آخر تحلّ محل السابقة كلها، في معاملة واحدة */
        public int SetRemoteCatalog(string branchId, string name, string city, string ver, long at, string json)
        {
            Dictionary<string, object> cat = Json.Parse(json) as Dictionary<string, object>;
            if (cat == null) throw new ShopException("قائمة فرع غير مفهومة.");
            List<object> items = Json.Arr(cat, "items");
            string snapAt = Json.Str(cat, "at");
            lock (gate)
            {
                if (Report.ReadOnly) throw new ShopException("لا يمكن الحفظ: " + Report.ReadOnlyReason);
                db.Exec("BEGIN IMMEDIATE");
                bool ok = false;
                int n = 0;
                try
                {
                    db.Run("DELETE FROM remote_items WHERE branch = ?", branchId);
                    foreach (object o in items)
                    {
                        List<object> a = o as List<object>;
                        if (a == null || a.Count < 10) continue;
                        string title = Convert.ToString(a[2], CultureInfo.InvariantCulture) ?? "";
                        string author = Convert.ToString(a[3], CultureInfo.InvariantCulture) ?? "";
                        db.Run("INSERT INTO remote_items(branch, kind, code, title, author, barcode, cat, qty, store, price, place, norm) " +
                            "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            branchId, Convert.ToString(a[0], CultureInfo.InvariantCulture), Convert.ToString(a[1], CultureInfo.InvariantCulture),
                            title, author, Convert.ToString(a[4], CultureInfo.InvariantCulture), Convert.ToString(a[5], CultureInfo.InvariantCulture),
                            Convert.ToInt64(a[6], CultureInfo.InvariantCulture), Convert.ToInt64(a[7], CultureInfo.InvariantCulture),
                            Convert.ToInt64(a[8], CultureInfo.InvariantCulture), Convert.ToString(a[9], CultureInfo.InvariantCulture),
                            " " + Search.Fold(Search.Norm(title + " " + author)) + " ");
                        n++;
                    }
                    db.Run("INSERT INTO remote_branches(branch, name, city, n, ver, at, snap_at, fetched) VALUES(?, ?, ?, ?, ?, ?, ?, ?) " +
                        "ON CONFLICT(branch) DO UPDATE SET name = excluded.name, city = excluded.city, n = excluded.n, ver = excluded.ver, " +
                        "at = excluded.at, snap_at = excluded.snap_at, fetched = excluded.fetched",
                        branchId, name ?? "", city ?? "", (long)n, ver ?? "", at, snapAt, Stamp(clock()));
                    db.Exec("COMMIT");
                    ok = true;
                }
                finally
                {
                    if (!ok) Rollback(db);
                }
                return n;
            }
        }

        public string RemoteCatalogVer(string branchId)
        {
            lock (gate) return db.Text("SELECT ver FROM remote_branches WHERE branch = ?", branchId);
        }

        public List<Dictionary<string, object>> RemoteBranches()
        {
            lock (gate)
            {
                List<Dictionary<string, object>> l = new List<Dictionary<string, object>>();
                foreach (object[] r in db.Rows("SELECT b.branch, b.name, b.city, b.n, b.snap_at, b.fetched, " +
                    "(SELECT IFNULL(SUM(qty + store), 0) FROM remote_items i WHERE i.branch = b.branch) FROM remote_branches b ORDER BY b.name"))
                {
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["id"] = r[0]; d["name"] = r[1]; d["city"] = r[2]; d["items"] = r[3]; d["at"] = r[4]; d["fetched"] = r[5]; d["pieces"] = r[6];
                    l.Add(d);
                }
                return l;
            }
        }

        /* البحث في كتب الفروع الأخرى: كل كلمة موجودة في الاسم أو المؤلف بعد التوحيد
           والطيّ (الهمزة والتاء المربوطة...)، أو الباركود أو الرمز كما هو. الاسم الذي
           يبدأ بالكلمة الأولى أولاً */
        public List<Dictionary<string, object>> SearchRemote(string q, string branchId, int limit)
        {
            q = (q ?? "").Trim();
            if (q.Length == 0) return new List<Dictionary<string, object>>();
            string folded = Search.Fold(Search.Norm(q)).Trim();
            string[] words = folded.Length > 0 ? folded.Split(' ') : new string[0];
            StringBuilder where = new StringBuilder();
            List<object> args = new List<object>();
            if (words.Length > 0)
            {
                where.Append("(");
                for (int i = 0; i < words.Length; i++)
                {
                    if (i > 0) where.Append(" AND ");
                    where.Append("instr(norm, ?) > 0");
                    args.Add(words[i]);
                }
                where.Append(") OR ");
            }
            where.Append("barcode = ? OR code = ? COLLATE NOCASE");
            args.Add(q); args.Add(q);
            string sql = "SELECT b.name, i.branch, i.kind, i.code, i.title, i.author, i.barcode, i.qty, i.store, i.price, i.place FROM remote_items i " +
                "JOIN remote_branches b ON b.branch = i.branch WHERE (" + where + ")" + (string.IsNullOrEmpty(branchId) ? "" : " AND i.branch = ?") +
                " ORDER BY (instr(i.norm, ?) = 2) DESC, (i.qty + i.store > 0) DESC, i.title LIMIT ?";
            if (!string.IsNullOrEmpty(branchId)) args.Add(branchId);
            args.Add(words.Length > 0 ? words[0] : "\u0001");
            args.Add((long)Math.Min(Math.Max(limit, 1), 500));
            lock (gate)
            {
                List<Dictionary<string, object>> l = new List<Dictionary<string, object>>();
                foreach (object[] r in db.Rows(sql, args.ToArray()))
                {
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["branchName"] = r[0]; d["branch"] = r[1]; d["kind"] = r[2]; d["code"] = r[3]; d["title"] = r[4];
                    d["author"] = r[5]; d["barcode"] = r[6]; d["qty"] = r[7]; d["store"] = r[8]; d["price"] = r[9]; d["place"] = r[10];
                    l.Add(d);
                }
                return l;
            }
        }

        /* كتب فرع آخر بشكل أصناف لقطة 3.x (k t n a b c q p، والمكان l وs أو loc)، لشاشة
           «المخزون والفروع» بواجهة 3.x (قرار 0026). مصفوفة JSON جاهزة: 20 ألف كتاب بلا
           قاموس لكل واحد. q = ما في المحل والمخازن معاً، والسعر بالدينار */
        public string RemoteItems3x(string branchId)
        {
            lock (gate)
            {
                StringBuilder sb = new StringBuilder(1 << 16);
                sb.Append('[');
                int n = 0;
                foreach (object[] r in db.Rows("SELECT kind, code, title, author, barcode, cat, qty, store, price, place FROM remote_items " +
                    "WHERE branch = ? ORDER BY id", branchId))
                {
                    bool book = Convert.ToString(r[0], CultureInfo.InvariantCulture) != "stat";
                    if (n++ > 0) sb.Append(',');
                    sb.Append("{\"k\":"); Json.Quote(sb, Convert.ToString(r[1], CultureInfo.InvariantCulture));
                    sb.Append(",\"t\":"); Json.Quote(sb, book ? "book" : "stat");
                    sb.Append(",\"n\":"); Json.Quote(sb, Convert.ToString(r[2], CultureInfo.InvariantCulture));
                    sb.Append(",\"a\":"); Json.Quote(sb, Convert.ToString(r[3], CultureInfo.InvariantCulture));
                    sb.Append(",\"b\":"); Json.Quote(sb, Convert.ToString(r[4], CultureInfo.InvariantCulture));
                    sb.Append(",\"c\":"); Json.Quote(sb, Convert.ToString(r[5], CultureInfo.InvariantCulture));
                    long inShop = Convert.ToInt64(r[6], CultureInfo.InvariantCulture), inWh = Convert.ToInt64(r[7], CultureInfo.InvariantCulture);
                    sb.Append(",\"q\":").Append((inShop + inWh).ToString(CultureInfo.InvariantCulture));
                    sb.Append(",\"p\":").Append((Convert.ToInt64(r[8], CultureInfo.InvariantCulture) / 1000.0).ToString("0.###", CultureInfo.InvariantCulture));
                    /* الكتاب: «خزانة A · رف 3» كما يكتبه X3CatalogJson يرجع حرفاً ورفاً، وغيره نصاً كما هو.
                       ما في مخازن الفرع يُقال: «… · و5 في المخزن»، أو «في المخزن» إن لم يبقَ في المحل شيء */
                    string place = Convert.ToString(r[9], CultureInfo.InvariantCulture) ?? "", lib = "", shelf = "";
                    System.Text.RegularExpressions.Match m = book && inWh == 0 ? PlaceRe.Match(place) : System.Text.RegularExpressions.Match.Empty;
                    if (m.Success) { lib = m.Groups[1].Value; shelf = m.Groups[2].Value; }
                    string loc = m.Success ? "" : place;
                    if (inWh > 0)
                        loc = inShop > 0 ? (place.Length > 0 ? place + " · " : "") + "و" + inWh.ToString(CultureInfo.InvariantCulture) + " في المخزن" : "في المخزن";
                    sb.Append(",\"l\":"); Json.Quote(sb, lib);
                    sb.Append(",\"s\":"); Json.Quote(sb, shelf);
                    sb.Append(",\"loc\":"); Json.Quote(sb, loc);
                    sb.Append('}');
                }
                sb.Append(']');
                return sb.ToString();
            }
        }

        static readonly System.Text.RegularExpressions.Regex PlaceRe =
            new System.Text.RegularExpressions.Regex("^(?:خزانة (.+?))?(?: · )?(?:رف (.+))?$");

        /* ---------- النقل: ضغط ونص ---------- */

        /* gzip ثم base64: ما يحفظه الخادم كما هو بلا فك (حدّ 10 ميلي ثانية) */
        public static string Pack(string text)
        {
            byte[] raw = Encoding.UTF8.GetBytes(text);
            using (MemoryStream ms = new MemoryStream())
            {
                using (GZipStream gz = new GZipStream(ms, CompressionMode.Compress, true)) gz.Write(raw, 0, raw.Length);
                return Convert.ToBase64String(ms.ToArray());
            }
        }

        public static string Unpack(string packed)
        {
            byte[] gzBytes = Convert.FromBase64String(packed);
            using (MemoryStream src = new MemoryStream(gzBytes))
            using (GZipStream gz = new GZipStream(src, CompressionMode.Decompress))
            using (MemoryStream dst = new MemoryStream())
            {
                byte[] buf = new byte[65536];
                int k;
                while ((k = gz.Read(buf, 0, buf.Length)) > 0) dst.Write(buf, 0, k);
                return Encoding.UTF8.GetString(dst.ToArray());
            }
        }

        public static byte[] PackFile(string path)
        {
            using (MemoryStream ms = new MemoryStream())
            {
                using (GZipStream gz = new GZipStream(ms, CompressionMode.Compress, true))
                using (FileStream f = File.OpenRead(path)) f.CopyTo(gz);
                return ms.ToArray();
            }
        }

        public static void UnpackFile(byte[] gzBytes, string dest)
        {
            using (MemoryStream src = new MemoryStream(gzBytes))
            using (GZipStream gz = new GZipStream(src, CompressionMode.Decompress))
            using (FileStream f = File.Create(dest)) gz.CopyTo(f);
        }

        /* ---------- نسخة جهاز المحل ---------- */

        /* ملف نسخة وصل من الخادم: قاعدتنا، بترقيتنا نفسها، سليم، ومن الفرع المطلوب */
        public static long CheckSnapshotFile(string path, string branchId)
        {
            using (Sqlite c = Sqlite.Open(path, true, false))
            {
                if (c.Long("PRAGMA application_id", 0) != Schema.AppId) throw new ShopException("النسخة الواصلة ليست قاعدة المنظومة.");
                int latest = 0;
                foreach (Migration m in Schema.All()) if (m.Version > latest) latest = m.Version;
                long ver = c.Long("PRAGMA user_version", 0);
                if (ver > latest) throw new ShopException("جهاز المحل على نسخة أحدث من البرنامج: حدّث البرنامج هنا أولاً.");
                if (ver < latest) throw new ShopException("جهاز المحل على نسخة أقدم من البرنامج: حدّثه أولاً.");
                string check = QuickCheck(c);
                if (check != "ok") throw new ShopException("النسخة الواصلة تالفة: " + check);
                Dictionary<string, object> b = Json.Parse(c.Text("SELECT value FROM settings WHERE key = 'branch'") ?? "{}") as Dictionary<string, object>;
                string got = b == null ? "" : Json.Str(b, "id");
                if (!string.Equals(got, branchId, StringComparison.OrdinalIgnoreCase))
                    throw new ShopException("النسخة الواصلة لفرع آخر (" + got + ").");
                return c.Long("SELECT seq FROM sqlite_sequence WHERE name = 'change_log'", 0);
            }
        }

        /* رقم السجل داخل نسخة كاملة أُخذت للتو (آخر ما فيها) */
        public static long SnapshotSeq(string path)
        {
            using (Sqlite c = Sqlite.Open(path, true, false))
                return c.Long("SELECT seq FROM sqlite_sequence WHERE name = 'change_log'", 0);
        }
    }
}
