using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Qirtasiya.Data;

namespace Qirtasiya.Engine
{
    /* رد الخادم: الحالة والنص والترويسات التي يحتاجها السجل */
    public sealed class CloudReply
    {
        public int Status;
        public string Text = "";
        public string From = "", To = "", Ver = "";

        public Dictionary<string, object> Json
        {
            get
            {
                try { return Qirtasiya.Data.Json.Parse(Text) as Dictionary<string, object>; }
                catch (FormatException) { return null; }
            }
        }
    }

    /* الاتصال بالخادم (cloud/worker.js). الاختبار يمرّر غيره */
    public interface ICloud
    {
        CloudReply Call(string method, string path, Dictionary<string, string> query, string body);
    }

    public sealed class HttpCloud : ICloud
    {
        readonly string baseUrl, key;

        public HttpCloud(string url, string shopKey)
        {
            baseUrl = (url ?? "").Trim().TrimEnd('/');
            key = shopKey ?? "";
        }

        public CloudReply Call(string method, string path, Dictionary<string, string> query, string body)
        {
            StringBuilder u = new StringBuilder(baseUrl).Append('/').Append(path);
            if (query != null && query.Count > 0)
            {
                bool first = true;
                foreach (KeyValuePair<string, string> kv in query)
                {
                    u.Append(first ? '?' : '&');
                    first = false;
                    u.Append(Uri.EscapeDataString(kv.Key)).Append('=').Append(Uri.EscapeDataString(kv.Value ?? ""));
                }
            }
            HttpWebRequest rq = (HttpWebRequest)WebRequest.Create(u.ToString());
            rq.Method = method;
            rq.Timeout = 60000;
            rq.ReadWriteTimeout = 120000;
            rq.UserAgent = "Qirtasiya/4.0";
            rq.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            rq.Headers.Add("X-Shop-Key", key);
            if (body != null)
            {
                byte[] data = Encoding.UTF8.GetBytes(body);
                rq.ContentType = "text/plain; charset=utf-8";
                rq.ContentLength = data.Length;
                using (Stream rs = rq.GetRequestStream()) rs.Write(data, 0, data.Length);
            }
            HttpWebResponse rp;
            try { rp = (HttpWebResponse)rq.GetResponse(); }
            catch (WebException we)
            {
                rp = we.Response as HttpWebResponse;
                if (rp == null) throw;
            }
            using (rp)
            {
                CloudReply r = new CloudReply();
                r.Status = (int)rp.StatusCode;
                r.From = rp.Headers["X-From"] ?? "";
                r.To = rp.Headers["X-To"] ?? "";
                r.Ver = rp.Headers["X-Ver"] ?? "";
                using (StreamReader sr = new StreamReader(rp.GetResponseStream(), Encoding.UTF8)) r.Text = sr.ReadToEnd();
                return r;
            }
        }
    }

    /* خطأ يُعرض كما هو في الواجهة: «جهاز آخر مسجّل جهاز المحل» */
    public sealed class SyncException : Exception
    {
        public readonly string Code;
        public SyncException(string code, string message) : base(message) { Code = code ?? ""; }
    }

    /* ============================================================
       عميل المزامنة (قرار 0023) — دورة واحدة كل دقيقة من البرنامج
       ------------------------------------------------------------
       جهاز المحل: يسلّم، يرفع نسخته الكاملة (أول مرة وكل يوم)، يرفع ما
       بعدها من سجله، ينفّذ أوامر الأجهزة الثانية، وينشر قائمة كتبه.
       الجهاز الثاني: يسلّم، يرسل ما ينتظر، ويطبّق سجل جهاز المحل.
       الاثنان: يجلبان قوائم كتب الفروع الأخرى إن تغيّرت.
       الإعدادات وأين وصل كل شيء في local_state (sync.*)، فلا يضيع موضع
       ولا يتكرر شيء بعد انقطاع الكهرباء أو الإنترنت.
       ============================================================ */
    public sealed class SyncClient
    {
        /* القطعة المضغوطة نصاً أقل من حدّ صف D1 (2 ميغا) بهامش */
        public const int MaxPart = 1400000;
        /* قائمة كتب الفرع للفروع الأخرى: كل نصف ساعة إن تغيّرت. لعشرين ألف كتاب 800 ك.ب صعوداً،
           وكل فرع آخر ينزّلها: كل عشر دقائق كانت 50 ميغا في اليوم مع البيع، ونصف دقيقة من كل عشر
           على رفع بطيء. «حدّث الآن» يرسلها في الحال */
        public static int CatalogEveryMin = 30;
        /* قائمة لم تُنشر أو لم تُجلب: تُعاد بعد دقيقتين، لا مع كل دورة (طرابلس: كل 4 ثوانٍ، والقائمة ميغا) */
        public static int CatalogRetryMin = 2, CatalogPubRetryMin = 10;
        public static int SnapshotEveryHours = 24;

        readonly Func<ShopDb> dbOf;
        readonly Func<Api> apiOf;
        readonly Func<string, string, ICloud> cloudOf;
        readonly Action<string> log;
        readonly string machine;
        readonly string tempDir;

        readonly object stateGate = new object();
        string lastOk = "", lastError = "", lastCode = "", mainName = "", phase = "";
        long mainSeen, behind, behindTo = -1;
        bool needRejoin;
        DateTime lastHello = DateTime.MinValue;

        /* طرابلس (تحديث خلال ثوانٍ): الدورة كل بضع ثوانٍ، والتسليم (hello) — وهو الكتابة الوحيدة
           في D1 كل دورة — مرة كل HelloEveryMs. بينهما قراءة فقط: الجهاز الثاني يسأل عن تغييرات
           جهاز المحل (v2/log)، وجهاز المحل عن أوامر الأجهزة الثانية (v2/cmds). 0 = كل دورة كما كان */
        public int HelloEveryMs;

        bool HelloDue(bool force)
        {
            return HelloEveryMs <= 0 || force || (DateTime.UtcNow - lastHello).TotalMilliseconds >= HelloEveryMs;
        }

        /* ما بقي على هذا الجهاز الثاني من تغييرات جهاز المحل (الشاشة تنتظره قبل أن تعيد التحميل) */
        public long Behind { get { lock (stateGate) return behind; } }
        /* قوائم الفروع: موعد الدورة القادمة، وآخر جلب ناجح، وخطأ النشر وخطأ الجلب كلٌّ وحده —
           حتى لا يمنع فشلُ نشر قائمتنا جلبَ قوائم الفروع الأخرى (مصراتة لا ترى طرابلس) */
        DateTime nextCatalog = DateTime.MinValue;
        string catAt = "", catPubErr = "", catGetErr = "";
        long catSeen, catWant;

        public SyncClient(Func<ShopDb> db, Func<Api> api, Func<string, string, ICloud> cloud, Action<string> logger, string machineFp, string temp)
        {
            dbOf = db; apiOf = api; cloudOf = cloud; log = logger ?? delegate { }; machine = machineFp ?? ""; tempDir = temp;
        }

        public static string NewToken()
        {
            byte[] b = new byte[12];
            using (RandomNumberGenerator r = RandomNumberGenerator.Create()) r.GetBytes(b);
            StringBuilder sb = new StringBuilder();
            foreach (byte x in b) sb.Append(x.ToString("x2", CultureInfo.InvariantCulture));
            return sb.ToString();
        }

        /* نسخة التجربة لا تُربط إلا بخادم تجربة على الجهاز نفسه (قرار 0014): كتب التجربة لا تظهر
           عند الفرع الآخر، ولا تكتب فوق فرع حقيقي على الخادم */
        public const string DemoRefused = "هذه نسخة تجربة: لا تُربط بخادم الربط الحقيقي، حتى لا تظهر كتب التجربة عند الفرع الآخر. " +
            "امسح بيانات التجربة أولاً (الإعدادات ← نسخة تجربة)، ثم اربط.";

        public static bool LocalUrl(string url)
        {
            Uri u;
            if (!Uri.TryCreate((url ?? "").Trim(), UriKind.Absolute, out u)) return false;
            return u.IsLoopback;
        }

        public static bool DemoBlocked(ShopDb db, string url)
        {
            return db.GetSetting("demo") == "true" && !LocalUrl(url);
        }

        /* الجهاز الثاني يحتاج نسخة جديدة (سلسلة جديدة أو قطع حُذفت): البرنامج يعيد الانضمام */
        public bool NeedRejoin { get { lock (stateGate) return needRejoin; } }

        public void ClearState()
        {
            lock (stateGate) { lastOk = lastError = lastCode = mainName = phase = ""; mainSeen = behind = 0; behindTo = -1; needRejoin = false; nextCatalog = DateTime.MinValue; lastHello = DateTime.MinValue; catAt = catPubErr = catGetErr = ""; catSeen = catWant = 0; }
        }

        /* أجهزة الفرع وآخر تسليم لكل جهاز (v2/devices). خادم قديم بلا هذا المسار: null */
        public Dictionary<string, object> Devices()
        {
            ShopDb db = dbOf();
            if (db == null) return null;
            string url = db.Local("sync.url") ?? "", key = db.Local("sync.key") ?? "";
            if (url.Length == 0) return null;
            CloudReply r = cloudOf(url, key).Call("GET", "v2/devices", Q("branch", db.Local("sync.branch") ?? ""), null);
            if (r.Status == 404) return null;
            if (r.Status != 200 || r.Json == null) throw Fail(r, "قائمة الأجهزة");
            Dictionary<string, object> j = r.Json;
            j["me"] = db.Local("sync.device") ?? "";
            return j;
        }

        public Dictionary<string, object> Status()
        {
            ShopDb db = dbOf();
            Dictionary<string, object> o = new Dictionary<string, object>();
            string role = db == null ? "" : db.Local("sync.role") ?? "";
            string url = db == null ? "" : db.Local("sync.url") ?? "";
            o["role"] = role;
            o["linked"] = url.Length > 0;
            o["url"] = url;
            o["branch"] = db == null ? "" : db.Local("sync.branch") ?? "";
            o["name"] = db == null ? "" : db.Local("sync.name") ?? "";
            o["held"] = db != null && url.Length > 0 && (db.Local("sync.machine") ?? "") != machine;
            if (db != null && db.Replica)
            {
                int waiting = 0, failed = 0;
                foreach (Dictionary<string, object> r in db.OutboxView())
                {
                    string s = (string)r["state"];
                    if (s == "waiting" || s == "sent") waiting++;
                    else if (s == "failed") failed++;
                }
                o["waiting"] = (long)waiting;
                o["failed"] = (long)failed;
            }
            lock (stateGate)
            {
                o["lastOk"] = lastOk;
                o["error"] = lastError;
                o["code"] = lastCode;
                o["main"] = mainName;
                o["mainSeen"] = mainSeen;
                o["behind"] = behind;
                o["phase"] = phase;
                o["rejoin"] = needRejoin;
                o["catAt"] = catAt;
                o["catPubError"] = catPubErr;
                o["catError"] = catGetErr;
            }
            if (db != null)
            {
                o["catPub"] = db.Local("sync.cat_at") ?? "";
                o["catN"] = db.LocalLong("sync.cat_n", 0);
                o["remotes"] = db.RemoteBranchesBrief();
            }
            return o;
        }

        void Phase(string p) { lock (stateGate) phase = p; }

        Dictionary<string, string> Q(params string[] kv)
        {
            Dictionary<string, string> q = new Dictionary<string, string>();
            for (int i = 0; i + 1 < kv.Length; i += 2) q[kv[i]] = kv[i + 1];
            return q;
        }

        static string S(long v) { return v.ToString(CultureInfo.InvariantCulture); }

        /* رد غير 2xx: رسالة الخادم نفسها، أو رمز الحالة */
        static SyncException Fail(CloudReply r, string what)
        {
            Dictionary<string, object> j = r.Json;
            string code = j == null ? "" : Json.Str(j, "code");
            string msg = j == null ? "" : Json.Str(j, "error");
            if (r.Status == 401) return new SyncException("key", "كلمة سر الربط غير صحيحة.");
            if (code == "no-d1") return new SyncException(code, msg);
            return new SyncException(code, what + ": " + (msg.Length > 0 ? msg : "الخادم رد بالرمز " + r.Status));
        }

        /* ---------- الدورة ---------- */

        /* دورة واحدة. فشلها لا يرمي: يُحفظ سببه ويُعاد بعد دقيقة */
        public void Tick(bool force)
        {
            ShopDb db = dbOf();
            if (db == null || db.ReadOnly) return;
            string url = db.Local("sync.url") ?? "", key = db.Local("sync.key") ?? "";
            if (url.Length == 0) return;
            if ((db.Local("sync.machine") ?? "") != machine)
            {
                lock (stateGate)
                {
                    lastCode = "held";
                    lastError = "البيانات منسوخة من جهاز آخر: الربط موقوف هنا حتى تؤكّد من الإعدادات أن هذا هو الجهاز الصحيح.";
                }
                return;
            }
            if (DemoBlocked(db, url))
            {
                lock (stateGate) { lastCode = "demo"; lastError = DemoRefused; }
                return;
            }
            ICloud cloud = cloudOf(url, key);
            bool tickOk = false;
            try
            {
                if (db.Replica) TickSecond(db, cloud, force);
                else TickMain(db, cloud, force);
                tickOk = true;
                lock (stateGate)
                {
                    lastOk = ShopDb.Stamp(db.Now);
                    lastError = lastCode = "";
                }
            }
            catch (SyncException e) { Failed(e.Code, e.Message); }
            catch (ShopException e) { Failed("", e.Message); }
            catch (WebException e) { Failed("net", NetError(e)); }
            catch (IOException e) { Failed("net", "انقطع الاتصال: " + e.Message); }
            catch (FormatException e) { Failed("", "رد غير مفهوم من الخادم: " + e.Message); }
            finally { Phase(""); }
            /* قوائم الفروع خارج الدورة: تُجلب حتى لو فشل التسليم أو النشر (جهاز آخر أخذ مكان
               جهاز المحل، أو الخادم رفض قائمتنا)، ولها خطؤها في الإعدادات */
            try { Catalogs(db, cloud, force, tickOk); }
            finally { Phase(""); }
        }

        static string ErrText(Exception e)
        {
            WebException we = e as WebException;
            if (we != null) return NetError(we);
            if (e is IOException) return "انقطع الاتصال: " + e.Message;
            if (e is FormatException) return "رد غير مفهوم من الخادم: " + e.Message;
            return e.Message;
        }

        /* التسليم يقول متى نُشرت آخر قائمة فرع آخر: أحدث مما جلبنا = نجلبها الآن، لا بعد نصف ساعة */
        void NoteCatalogs(Dictionary<string, object> h)
        {
            long at = h == null ? 0 : Json.Long(h, "catalogsAt", 0);
            lock (stateGate) if (at > catSeen) catWant = at;
        }

        void Failed(string code, string msg)
        {
            lock (stateGate) { lastCode = code; lastError = msg; }
            log("المزامنة: " + msg);
        }

        public static string NetError(WebException we)
        {
            if (we.Status == WebExceptionStatus.NameResolutionFailure) return "لا يوجد اتصال بالإنترنت.";
            if (we.Status == WebExceptionStatus.Timeout) return "انتهت المهلة: الإنترنت بطيء.";
            if (we.Status == WebExceptionStatus.ConnectFailure) return "تعذّر الوصول لخادم الربط (قد يكون محجوباً).";
            return "خطأ في الاتصال: " + we.Message;
        }

        Dictionary<string, object> Hello(ShopDb db, ICloud cloud, string role, bool takeOver)
        {
            Dictionary<string, string> q = Q("branch", db.Local("sync.branch") ?? "", "device", db.Local("sync.device") ?? "",
                "role", role, "name", db.Local("sync.name") ?? "");
            if (takeOver) q["force"] = "1";
            CloudReply r = cloud.Call("GET", "v2/hello", q, null);
            Dictionary<string, object> j = r.Json;
            if (r.Status == 409 && j != null && Json.Str(j, "code") == "main-taken")
            {
                Dictionary<string, object> m = Json.Obj(j, "main");
                throw new SyncException("main-taken", "جهاز آخر مسجّل جهازَ المحل لهذا الفرع: «" + (m == null ? "" : Json.Str(m, "name")) +
                    "». إن كان هذا الجهاز بديله فاختر «هذا جهاز المحل» من جديد ووافق على أخذ مكانه.");
            }
            if (r.Status != 200 || j == null) throw Fail(r, "التسليم");
            Dictionary<string, object> main = Json.Obj(j, "main");
            lock (stateGate)
            {
                mainName = main == null ? "" : Json.Str(main, "name");
                mainSeen = main == null ? 0 : Json.Long(main, "seen", 0);
            }
            return j;
        }

        /* ---------- جهاز المحل ---------- */

        void TickMain(ShopDb db, ICloud cloud, bool force)
        {
            if (!HelloDue(force) && (db.Local("sync.chain") ?? "").Length > 0)
            {
                /* دورة سريعة: ما تغيّر هنا يُرفع، وأوامر الأجهزة الثانية تُنفَّذ — بلا تسليم */
                PushLog(db, cloud);
                RunCommands(db, cloud);
                PushLog(db, cloud);
                return;
            }
            Phase("التسليم");
            Dictionary<string, object> h = Hello(db, cloud, "main", false);
            lastHello = DateTime.UtcNow;
            NoteCatalogs(h);
            string chain = db.Local("sync.chain") ?? "";
            Dictionary<string, object> snap = Json.Obj(h, "snap");
            if (chain.Length == 0 || Json.Str(h, "chain") != chain || snap == null)
            {
                /* أول ربط، أو سلسلة الخادم ليست سلسلتنا: نسخة كاملة تبدأ سلسلة جديدة */
                UploadSnapshot(db, cloud, NewToken(), true);
            }
            else
            {
                PushLog(db, cloud);
                DateTime last;
                if (!DateTime.TryParse(db.Local("sync.snap_at") ?? "", CultureInfo.InvariantCulture, DateTimeStyles.None, out last) ||
                    db.Now - last > TimeSpan.FromHours(SnapshotEveryHours))
                    UploadSnapshot(db, cloud, chain, false);
            }
            if (Json.Long(h, "cmdMax", 0) > db.LocalLong("sync.cmd_after", 0)) RunCommands(db, cloud);
            PushLog(db, cloud);
        }

        /* نسخة كاملة من قاعدة المحل، مضغوطة قطعاً. newChain: موضع السجل يبدأ من رقمها */
        void UploadSnapshot(ShopDb db, ICloud cloud, string chain, bool newChain)
        {
            Phase("رفع النسخة الكاملة");
            string tmp = Path.Combine(tempDir, "sync-snap-" + NewToken() + ".db");
            try
            {
                db.SnapshotTo(tmp);
                ShopDb.SlimSnapshot(tmp);
                long seq = ShopDb.SnapshotSeq(tmp);
                string packed = Convert.ToBase64String(ShopDb.PackFile(tmp));
                int parts = Math.Max(1, (packed.Length + MaxPart - 1) / MaxPart);
                for (int i = 0; i < parts; i++)
                {
                    string part = packed.Substring(i * MaxPart, Math.Min(MaxPart, packed.Length - i * MaxPart));
                    CloudReply r = cloud.Call("POST", "v2/snap", Q("branch", db.Local("sync.branch"), "device", db.Local("sync.device"), "chain", chain,
                        "id", S(seq), "ver", S(db.SchemaVersion), "part", S(i), "parts", S(parts)), part);
                    if (r.Status != 200) throw Fail(r, "رفع النسخة");
                }
                Dictionary<string, string> st = new Dictionary<string, string>();
                st["sync.snap_at"] = ShopDb.Stamp(db.Now);
                if (newChain)
                {
                    st["sync.chain"] = chain;
                    st["sync.pushed"] = S(seq);
                }
                db.SetLocals(st);
                log("المزامنة: رُفعت نسخة كاملة (" + parts + " قطعة، حتى " + seq + ")" + (newChain ? " وبدأت سلسلة جديدة" : ""));
            }
            finally
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); }
                catch (IOException) { }
            }
        }

        void PushLog(ShopDb db, ICloud cloud)
        {
            int rows = 2000;
            while (true)
            {
                long pushed = db.LocalLong("sync.pushed", -1);
                if (pushed < 0) return;
                if (db.LogSeq() < pushed)
                {
                    /* القاعدة رجعت لنسخة أقدم (استرجاع): سلسلة جديدة، والأجهزة الثانية تعيد التحميل */
                    log("المزامنة: سجل القاعدة أقدم مما رُفع (استرجاع نسخة؟) — سلسلة جديدة");
                    UploadSnapshot(db, cloud, NewToken(), true);
                    continue;
                }
                long from, to;
                string json = db.LogChunk(pushed, rows, 50000, out from, out to);
                if (json == null)
                {
                    db.PruneLog(pushed);
                    return;
                }
                Phase("رفع التغييرات");
                string packed = ShopDb.Pack(json);
                if (packed.Length > MaxPart && rows > 25) { rows /= 2; continue; }
                if (packed.Length > MaxPart) throw new SyncException("big", "أمر واحد أكبر من حدّ الخادم.");
                CloudReply r = cloud.Call("POST", "v2/log", Q("branch", db.Local("sync.branch"), "device", db.Local("sync.device"),
                    "chain", db.Local("sync.chain"), "from", S(from), "to", S(to), "ver", S(db.SchemaVersion)), packed);
                Dictionary<string, object> j = r.Json;
                string code = j == null ? "" : Json.Str(j, "code");
                if (r.Status == 409 && (code == "gap" || code == "chain"))
                {
                    log("المزامنة: " + (code == "gap" ? "فجوة في السجل على الخادم" : "سلسلة الخادم تغيّرت") + " — سلسلة جديدة");
                    UploadSnapshot(db, cloud, NewToken(), true);
                    continue;
                }
                if (r.Status != 200 || j == null) throw Fail(r, "رفع التغييرات");
                db.SetLocal("sync.pushed", S(to));
                rows = 2000;
            }
        }

        /* أوامر الأجهزة الثانية بالترتيب. كل أمر يُسجَّل في معاملته، فالموضع بعده تحسين لا ضمان */
        void RunCommands(ShopDb db, ICloud cloud)
        {
            Api api = apiOf();
            if (api == null) return;
            while (true)
            {
                long after = db.LocalLong("sync.cmd_after", 0);
                CloudReply r = cloud.Call("GET", "v2/cmds", Q("branch", db.Local("sync.branch"), "after", S(after), "limit", "50"), null);
                Dictionary<string, object> j = r.Json;
                if (r.Status != 200 || j == null) throw Fail(r, "قراءة أوامر الأجهزة الثانية");
                List<object> cmds = Json.Arr(j, "cmds");
                if (cmds.Count == 0) return;
                Phase("تنفيذ أوامر الأجهزة الثانية");
                foreach (object o in cmds)
                {
                    Dictionary<string, object> c = o as Dictionary<string, object>;
                    if (c == null) continue;
                    long id = Json.Long(c, "id", 0);
                    string data = Json.Str(c, "data");
                    string dname = "";
                    try
                    {
                        Dictionary<string, object> d = Json.Parse(data) as Dictionary<string, object>;
                        if (d != null) dname = Json.Str(d, "dname");
                    }
                    catch (FormatException) { }
                    string err = api.ExecRemote(id, Json.Str(c, "device"), dname, Json.Long(c, "n", 0), data);
                    if (err != null) log("المزامنة: رُفض أمر من جهاز ثانٍ (" + id + "): " + err);
                    db.SetLocal("sync.cmd_after", S(id));
                }
                PushLog(db, cloud);
            }
        }

        /* ---------- الجهاز الثاني ---------- */

        void TickSecond(ShopDb db, ICloud cloud, bool force)
        {
            bool hello = HelloDue(force);
            Dictionary<string, object> h = null;
            if (hello)
            {
                Phase("التسليم");
                h = Hello(db, cloud, "second", false);
                lastHello = DateTime.UtcNow;
                NoteCatalogs(h);
                /* أقصى حجم لأمر واحد عند هذا الخادم (القديم لا يعلنه: 200 ألف) */
                long cc = Json.Long(h, "cmdChars", 200000);
                if (cc != db.LocalLong("sync.cmd_chars", 200000)) db.SetLocal("sync.cmd_chars", S(cc));
            }
            PushOutbox(db, cloud);
            string chain = db.Local("sync.chain") ?? "";
            if (hello && Json.Str(h, "chain") != chain)
            {
                lock (stateGate) needRejoin = true;
                throw new SyncException("rejoin", "جهاز المحل بدأ نسخة جديدة: يُعاد تحميلها على هذا الجهاز.");
            }
            /* بلا تسليم لا نعرف آخر موضع: نجلب حتى يقول الخادم «لا جديد» (204)، و«الباقي» من آخر تسليم */
            long logTo = hello ? Json.Long(h, "logTo", -1) : long.MaxValue;
            if (hello) lock (stateGate) behindTo = logTo;
            while (true)
            {
                long applied = db.LocalLong("sync.applied", -1);
                lock (stateGate) behind = behindTo < 0 ? 0 : Math.Max(0, behindTo - applied);
                if (applied >= logTo) break;
                Phase("تطبيق تغييرات جهاز المحل");
                CloudReply r = cloud.Call("GET", "v2/log", Q("branch", db.Local("sync.branch"), "chain", chain, "after", S(applied)), null);
                if (r.Status == 204) break;
                Dictionary<string, object> j = r.Status == 200 ? null : r.Json;
                string code = j == null ? "" : Json.Str(j, "code");
                if (r.Status == 409 || r.Status == 410)
                {
                    lock (stateGate) needRejoin = true;
                    throw new SyncException("rejoin", code == "chain" ? "جهاز المحل بدأ نسخة جديدة: يُعاد تحميلها على هذا الجهاز."
                        : "فات هذا الجهاز الكثير: يُعاد تحميل نسخة جهاز المحل.");
                }
                if (r.Status != 200) throw Fail(r, "جلب التغييرات");
                int ver = int.Parse(r.Ver, CultureInfo.InvariantCulture);
                if (ver != db.SchemaVersion)
                    throw new SyncException("version", ver > db.SchemaVersion ? "جهاز المحل على نسخة أحدث من البرنامج: حدّث البرنامج هنا."
                        : "هذا الجهاز على نسخة أحدث من جهاز المحل: حدّث البرنامج على جهاز المحل.");
                long to = long.Parse(r.To, CultureInfo.InvariantCulture);
                db.ApplyRemote(ShopDb.ParseChunk(ShopDb.Unpack(r.Text)), to);
            }
            lock (stateGate) behind = 0;
        }

        /* ما ينتظر هنا يُرسل بالترتيب. الخادم يقبل الرقم نفسه مرة واحدة */
        void PushOutbox(ShopDb db, ICloud cloud)
        {
            string name = db.Local("sync.name") ?? "";
            for (int round = 0; round < 4; round++)
            {
                bool again = false;
                foreach (ShopDb.OutboxRow o in db.OutboxUnsent())
                {
                    Phase("إرسال ما ينتظر");
                    StringBuilder sb = new StringBuilder("{\"user\":").Append(S(o.UserId)).Append(",\"cmd\":");
                    Json.Quote(sb, o.Cmd);
                    sb.Append(",\"dname\":");
                    Json.Quote(sb, name);
                    sb.Append(",\"at\":");
                    Json.Quote(sb, o.At);
                    sb.Append(",\"body\":").Append(o.Body).Append('}');
                    CloudReply r = cloud.Call("POST", "v2/cmd", Q("branch", db.Local("sync.branch"), "device", db.Local("sync.device"), "n", S(o.N)), sb.ToString());
                    Dictionary<string, object> j = r.Json;
                    if (r.Status == 413)
                    {
                        /* أكبر مما يقبله الخادم. كان يُعاد إلى الأبد فيتوقف كل ما بعده (بيع الجهاز الثاني لا يصل
                           المحل). الآن: يُقسم هو وما بعده بالترتيب نفسه ويُعاد؛ وسجل واحد لا يُقسم يُنحّى جانباً
                           ويُقال للمستخدم، والباقي يكمل */
                        if (db.OutboxResplit(o.N, delegate (ShopDb.OutboxRow x) { return Api.SplitBody(x.Cmd, x.Body, Api.CmdSafe); }) > 0) { again = true; break; }
                        db.OutboxUnsendable(o.N);
                        log("المزامنة: تغيير أكبر من أن يُرسل لجهاز المحل نُحّي جانباً: " + o.Label);
                        continue;
                    }
                    if (r.Status != 200 || j == null) throw Fail(r, "إرسال ما ينتظر");
                    db.OutboxSent(o.N, Json.Long(j, "id", 0));
                }
                if (!again) break;
            }
        }

        /* ---------- قوائم الكتب بين الفروع ---------- */

        /* canPublish: التسليم في هذه الدورة نجح (هذا جهاز المحل فعلاً). جهاز أُخذ مكانه لا يرفع
           قائمته (ميغا ونصف تُرفض كل مرة)، لكنه يبقى يجلب قوائم الفروع */
        void Catalogs(ShopDb db, ICloud cloud, bool force, bool canPublish)
        {
            bool due = force || db.Now >= nextCatalog;
            long want;
            lock (stateGate) want = catWant;
            if (!due && want == 0) return;
            string pubErr = "", getErr = "";
            List<object> list = null;
            try { list = ListCatalogs(db, cloud); }
            catch (Exception e) { getErr = ErrText(e); }
            if (due && canPublish && !db.Replica && list != null)
            {
                try
                {
                    /* قائمتنا ليست على الخادم (خادم أو قاعدة D1 جديدة، أو نشر انقطع): تُنشر ولو لم تتغيّر */
                    PublishCatalog(db, cloud, !Listed(list, db.Local("sync.branch") ?? ""));
                    /* بواجهة 3.x شاشاتها ترفع لقطة التلفون بنفسها كما كانت (وتأخذ طلباته) */
                    if (!db.X3Mode) PublishOld(db, cloud, force);
                }
                catch (Exception e) { pubErr = ErrText(e); }
            }
            if (list != null)
            {
                try { FetchCatalogs(db, list, cloud); }
                catch (Exception e) { getErr = ErrText(e); }
            }
            lock (stateGate)
            {
                if (getErr.Length == 0) { catAt = ShopDb.Stamp(db.Now); if (want > catSeen) catSeen = want; }
                if (catWant <= catSeen) catWant = 0;
                if (due || pubErr.Length > 0) catPubErr = pubErr;
                catGetErr = getErr;
            }
            if (pubErr.Length > 0) log("المزامنة: " + pubErr);
            if (getErr.Length > 0) log("المزامنة: " + getErr);
            /* جلب فشل: بعد دقيقتين. نشر فشل (الخادم رفض القائمة): بعد عشر، لا تُرفع ميغا كل دقيقتين.
               التسليم فشل فلم ننشر: الدورة التالية الناجحة تنشر */
            if (due && !canPublish && !db.Replica) nextCatalog = db.Now + TimeSpan.FromMinutes(CatalogRetryMin);
            else if (due) nextCatalog = db.Now + TimeSpan.FromMinutes(getErr.Length > 0 ? CatalogRetryMin : pubErr.Length > 0 ? CatalogPubRetryMin : CatalogEveryMin);
            else if (getErr.Length > 0) lock (stateGate) catWant = 0;   // يُعاد مع الدورة أو التسليم القادم
        }

        static bool Listed(List<object> list, string branch)
        {
            foreach (object o in list)
            {
                Dictionary<string, object> c = o as Dictionary<string, object>;
                if (c != null && Json.Str(c, "branch") == branch) return true;
            }
            return false;
        }

        /* التطبيق في التلفون وموقع المكتبة يقرآن لقطة 3.x من مخزن KV القديم: تُكتب كل
           نصف ساعة إن تغيّرت، لفرع بحجم مصراتة (حدّ الكتابة المجانية ألف في اليوم،
           والخادم يفكّ اللقطة كلها في حدّ 10 ميلي ثانية) */
        public static int OldEveryMin = 30, OldMaxItems = 5000;

        void PublishOld(ShopDb db, ICloud cloud, bool force)
        {
            DateTime last;
            if (!force && DateTime.TryParse(db.Local("sync.kv_at") ?? "", CultureInfo.InvariantCulture, DateTimeStyles.None, out last) &&
                db.Now - last < TimeSpan.FromMinutes(OldEveryMin)) return;
            int n;
            string json = db.Snapshot3x(out n);
            if (n > OldMaxItems) return;
            int at = json.IndexOf(",\"items\":", StringComparison.Ordinal);
            string hash = Hash(at < 0 ? json : json.Substring(at));
            if (hash == db.Local("sync.kv_hash")) return;
            Phase("نشر القائمة للتلفون والموقع");
            CloudReply r = cloud.Call("POST", "put", null, json);
            Dictionary<string, string> st = new Dictionary<string, string>();
            st["sync.kv_at"] = ShopDb.Stamp(db.Now);
            /* الخادم بلا KV (أو قديم): لا يوقف المزامنة، ويُعاد بعد نصف ساعة */
            if (r.Status == 200) st["sync.kv_hash"] = hash;
            else log("المزامنة: لقطة التلفون لم تُكتب (" + r.Status + ")");
            db.SetLocals(st);
        }

        void PublishCatalog(ShopDb db, ICloud cloud, bool missing)
        {
            int n;
            string json = db.CatalogJson(out n);
            int at = json.IndexOf("\"items\":", StringComparison.Ordinal);
            string hash = Hash(json.Substring(at < 0 ? 0 : at) + "|" + json.Substring(0, Math.Max(0, json.IndexOf(",\"at\":", StringComparison.Ordinal))));
            if (hash == db.Local("sync.cat_hash") && !missing) return;
            Phase("نشر قائمة الكتب");
            string packed = ShopDb.Pack(json);
            string ver = NewToken();
            int parts = Math.Max(1, (packed.Length + MaxPart - 1) / MaxPart);
            Dictionary<string, object> meta = Json.Parse(json.Substring(0, at < 0 ? json.Length : at).TrimEnd(',') + "}") as Dictionary<string, object>;
            Dictionary<string, object> br = Json.Obj(meta, "branch");
            for (int i = 0; i < parts; i++)
            {
                CloudReply r = cloud.Call("POST", "v2/catalog", Q("branch", db.Local("sync.branch"), "device", db.Local("sync.device"), "ver", ver,
                    "part", S(i), "parts", S(parts), "n", S(n), "name", Json.Str(br, "name"), "city", Json.Str(br, "city")),
                    packed.Substring(i * MaxPart, Math.Min(MaxPart, packed.Length - i * MaxPart)));
                if (r.Status != 200) throw Fail(r, "نشر قائمة الكتب");
            }
            Dictionary<string, string> st = new Dictionary<string, string>();
            st["sync.cat_hash"] = hash;
            st["sync.cat_at"] = ShopDb.Stamp(db.Now);
            st["sync.cat_n"] = S(n);
            db.SetLocals(st);
            log("المزامنة: نُشرت قائمة الكتب (" + n + " صنف)");
        }

        List<object> ListCatalogs(ShopDb db, ICloud cloud)
        {
            Phase("قوائم الفروع");
            CloudReply r = cloud.Call("GET", "v2/catalogs", Q("branch", db.Local("sync.branch") ?? ""), null);
            Dictionary<string, object> j = r.Json;
            if (r.Status != 200 || j == null) throw Fail(r, "قوائم الفروع");
            return Json.Arr(j, "catalogs");
        }

        /* كل فرع وحده: فشل قائمة فرع لا يمنع الباقي، والخطأ الأول يُرمى بعدها */
        void FetchCatalogs(ShopDb db, List<object> list, ICloud cloud)
        {
            string mine = db.Local("sync.branch") ?? "";
            Exception first = null;
            foreach (object o in list)
            {
                Dictionary<string, object> c = o as Dictionary<string, object>;
                if (c == null) continue;
                string b = Json.Str(c, "branch"), ver = Json.Str(c, "ver");
                if (b.Length == 0 || b == mine || ver == db.RemoteCatalogVer(b)) continue;
                try
                {
                    Phase("جلب قائمة فرع " + Json.Str(c, "name"));
                    StringBuilder all = new StringBuilder();
                    long parts = Json.Long(c, "parts", 1);
                    bool gone = false;
                    for (int i = 0; i < parts; i++)
                    {
                        CloudReply p = cloud.Call("GET", "v2/catalog-part", Q("branch", b, "ver", ver, "part", S(i)), null);
                        if (p.Status == 410) { gone = true; break; }   // نُشرت أحدث منها في الأثناء: الدورة القادمة
                        if (p.Status != 200) throw Fail(p, "قائمة فرع " + Json.Str(c, "name"));
                        all.Append(p.Text);
                    }
                    if (gone) continue;
                    int got = db.SetRemoteCatalog(b, Json.Str(c, "name"), Json.Str(c, "city"), ver, Json.Long(c, "at", 0), ShopDb.Unpack(all.ToString()));
                    log("المزامنة: قائمة فرع " + Json.Str(c, "name") + " (" + got + " صنف)");
                }
                catch (Exception e) { if (first == null) first = e; }
            }
            if (first != null) throw first;
        }

        static string Hash(string s)
        {
            using (MD5 md5 = MD5.Create())
            {
                StringBuilder sb = new StringBuilder();
                foreach (byte b in md5.ComputeHash(Encoding.UTF8.GetBytes(s))) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        /* ---------- الانضمام كجهاز ثانٍ ---------- */

        /* يجلب نسخة جهاز المحل إلى dest ويتأكد منها. يعيد سلسلتها ورقم سجلها */
        public static long FetchSnapshot(ICloud cloud, string branch, string device, string name, string dest, out string chain)
        {
            CloudReply r = cloud.Call("GET", "v2/hello", new Dictionary<string, string> {
                { "branch", branch }, { "device", device }, { "role", "second" }, { "name", name ?? "" } }, null);
            Dictionary<string, object> j = r.Json;
            if (r.Status != 200 || j == null) throw Fail(r, "التسليم");
            Dictionary<string, object> snap = Json.Obj(j, "snap");
            chain = Json.Str(j, "chain");
            if (snap == null || chain.Length == 0)
                throw new SyncException("no-snap", "جهاز المحل لهذا الفرع لم يرفع نسخته بعد: اربطه أولاً («هذا جهاز المحل») وانتظر دقيقة.");
            long id = Json.Long(snap, "id", 0), parts = Json.Long(snap, "parts", 1);
            StringBuilder all = new StringBuilder();
            for (int i = 0; i < parts; i++)
            {
                CloudReply p = cloud.Call("GET", "v2/snap-part", new Dictionary<string, string> {
                    { "branch", branch }, { "chain", chain }, { "id", S(id) }, { "part", S(i) } }, null);
                if (p.Status != 200) throw Fail(p, "تحميل نسخة جهاز المحل");
                all.Append(p.Text);
            }
            ShopDb.UnpackFile(Convert.FromBase64String(all.ToString()), dest);
            long seq = ShopDb.CheckSnapshotFile(dest, branch);
            if (seq != id) throw new SyncException("snap", "نسخة جهاز المحل لا تطابق رقمها (" + seq + " / " + id + ").");
            return seq;
        }
    }
}
