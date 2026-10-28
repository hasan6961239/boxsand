using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Qirtasiya.Data;

namespace Qirtasiya.Engine
{
    /* ============================================================
       أوامر المحرك (المرحلة 2)
       ------------------------------------------------------------
       POST /api/v2/<الأمر> بجسم JSON، وترويسة X-Session بعد الدخول.
       - كل أمر يعلن صلاحيته، والمحرك يرفض من لا يملكها (قرار 0011).
         اختبار آلي يتأكد ألا يوجد أمر بلا صلاحية.
       - المبالغ بالدرهم والكميات أعداد صحيحة (قرار 0006). الواجهة تحوّل
         للعرض.
       - سعر الشراء والربح لا يُرسلان لمن لا يملك view_cost.
       - الرد: {ok:true, data} أو {ok:false, error}؛ 401 بلا جلسة، 403 بلا
         صلاحية، 404 لأمر غير معروف.
       ============================================================ */
    public sealed class ApiResult
    {
        public int Status = 200;
        public string Json = "{\"ok\":true}";
    }

    public sealed class Session
    {
        public string Token;
        public long UserId;
        public string Name, Role;
        public readonly List<string> Perms = new List<string>();
        public DateTime Seen;
        /* رمز الأرباح (قرار 0024): حساب بلا كلمة سر على جهاز له رمز أرباح لا يرى سعر الشراء
           ولا الأرباح حتى يُكتب الرمز، كما في 3.x. Lockable: يُقفل من جديد بزر «إقفال» */
        public bool Locked, Lockable;
        public int CodeFails;
        public DateTime CodeWait;

        public bool Can(string perm)
        {
            if (Locked && perm == "view_cost") return false;
            return Role == "admin" || Perms.Contains(perm);
        }
    }

    public sealed partial class Api
    {
        /* الصلاحيات ومعانيها (تُعرض للمدير في شاشة الموظفين — المرحلة 5) */
        public static readonly string[,] PermList = {
            { "sell", "البيع" }, { "search", "البحث" }, { "view_stock", "مشاهدة المخزون" },
            { "returns", "الإرجاع" }, { "edit_invoice", "تعديل الفواتير" }, { "delete_invoice", "حذف الفواتير" },
            { "edit_items", "إضافة الأصناف وتعديلها" }, { "edit_prices", "تعديل الأسعار" },
            { "view_cost", "رؤية سعر الشراء والأرباح" }, { "receive", "إدخال البضاعة" },
            { "move_stock", "نقل البضاعة بين الأماكن" }, { "count", "الجرد" }, { "customers", "الزبائن" },
            { "debts", "الديون والتسديد" }, { "suppliers", "الموردون ودور النشر" }, { "consign", "الكتب على المباع" },
            { "reports", "التقارير" }, { "closing", "إقفال اليوم" }, { "places", "الأماكن والمخازن" },
            { "settings", "الإعدادات" }, { "users", "الموظفون والصلاحيات" }, { "log", "سجل العمليات" }
        };

        /* أوامر بلا صلاحية خاصة: أي موظف داخل يحتاجها */
        public const string AnyUser = "*";

        public static readonly TimeSpan SessionIdle = TimeSpan.FromHours(12);

        sealed class Command
        {
            public string Name, Perm;
            public Func<Ctx, object> Run;
        }

        readonly ShopDb db;
        readonly Func<DateTime> clock;
        readonly Dictionary<string, Session> sessions = new Dictionary<string, Session>();
        readonly Dictionary<string, Command> commands = new Dictionary<string, Command>();
        readonly object gate = new object();

        public Api(ShopDb shop, Func<DateTime> clk)
        {
            db = shop;
            clock = clk ?? (() => DateTime.Now);
            Register();
        }

        public ShopDb Db { get { return db; } }

        void Add(string name, string perm, Func<Ctx, object> run)
        {
            Command c = new Command();
            c.Name = name; c.Perm = perm; c.Run = run;
            commands[name] = c;
        }

        /* لاختبار «لا أمر بلا صلاحية» */
        public Dictionary<string, string> CommandPerms()
        {
            Dictionary<string, string> m = new Dictionary<string, string>();
            foreach (Command c in commands.Values) m[c.Name] = c.Perm;
            return m;
        }

        public static bool KnownPerm(string p)
        {
            for (int i = 0; i < PermList.GetLength(0); i++) if (PermList[i, 0] == p) return true;
            return false;
        }

        /* ---------- الطلب ---------- */

        public ApiResult Handle(string name, string token, string body)
        {
            try
            {
                Dictionary<string, object> req;
                if (string.IsNullOrEmpty(body) || body.Trim().Length == 0) req = new Dictionary<string, object>();
                else
                {
                    req = Json.Parse(body) as Dictionary<string, object>;
                    if (req == null) return Fail(400, "الطلب ليس كائن JSON.");
                }
                if (name == "login") return Ok(Login(req));
                /* شاشة الدخول: الموظفون الموجودون ومن له كلمة سر. المدير بلا كلمة سر
                   يدخل مباشرة، فلا تُحسب عليه محاولات خاطئة لم يكتبها */
                if (name == "login.users")
                    return Ok(Rows("SELECT id, name, login, role, pass_hash <> '' FROM users WHERE active = 1 ORDER BY role <> 'admin', id",
                        new string[] { "id", "name", "login", "role", "hasPassword" }));
                if (name == "logout") { lock (gate) if (token != null) sessions.Remove(token); return Ok(null); }

                Command cmd;
                if (!commands.TryGetValue(name, out cmd)) return Fail(404, "أمر غير معروف: " + name);
                Session s = SessionOf(token);
                if (s == null) return Fail(401, "انتهت الجلسة. ادخل من جديد.", "session");
                if (cmd.Perm != AnyUser && !s.Can(cmd.Perm))
                    return Fail(403, "لا تملك صلاحية: " + PermLabel(cmd.Perm), "perm", cmd.Perm);
                object res;
                try { res = cmd.Run(new Ctx(this, s, req)); }
                /* جهاز ثانٍ (قرار 0023): الأمر ينتظر جهاز المحل */
                catch (ReplicaWriteException) { return Ok(Queue(s, name, req)); }
                AfterRun(name, req, res);
                return Ok(res);
            }
            catch (ShopException e) { return Fail(200, e.Message); }
            catch (FormatException e) { return Fail(400, e.Message); }
        }

        /* أوامر البرنامج خارج المحرك (مسح بيانات التجربة): هل لهذه الجلسة الصلاحية؟ */
        public bool Allowed(string token, string perm)
        {
            Session s = SessionOf(token);
            return s != null && (perm == AnyUser || s.Can(perm));
        }

        /* 0 = مسموح، 401 = لا جلسة (ادخل من جديد)، 403 = بلا صلاحية */
        public int Check(string token, string perm)
        {
            Session s = SessionOf(token);
            if (s == null) return 401;
            return perm == AnyUser || s.Can(perm) ? 0 : 403;
        }

        /* إعادة تحميل نسخة جهاز المحل للفرع نفسه (قرار 0023): الموظفون أنفسهم بأرقامهم،
           فلا يُخرج البائع من الشاشة لأمر لم يفعله */
        public void AdoptSessions(Api old)
        {
            if (old == null || old == this) return;
            lock (old.gate)
            lock (gate)
                foreach (KeyValuePair<string, Session> kv in old.sessions) sessions[kv.Key] = kv.Value;
        }

        static string PermLabel(string p)
        {
            for (int i = 0; i < PermList.GetLength(0); i++) if (PermList[i, 0] == p) return PermList[i, 1];
            return p;
        }

        static ApiResult Ok(object data)
        {
            Dictionary<string, object> o = new Dictionary<string, object>();
            o["ok"] = true;
            if (data != null) o["data"] = data;
            ApiResult r = new ApiResult();
            r.Json = Json.Write(o);
            return r;
        }

        static ApiResult Fail(int status, string error, string code = null, string perm = null)
        {
            Dictionary<string, object> o = new Dictionary<string, object>();
            o["ok"] = false;
            o["error"] = error;
            if (code != null) o["code"] = code;
            if (perm != null) o["perm"] = perm;
            ApiResult r = new ApiResult();
            r.Status = status;
            r.Json = Json.Write(o);
            return r;
        }

        /* ---------- الجلسات ---------- */

        Session SessionOf(string token)
        {
            if (string.IsNullOrEmpty(token)) return null;
            lock (gate)
            {
                Session s;
                if (!sessions.TryGetValue(token, out s)) return null;
                DateTime now = clock();
                if (now - s.Seen > SessionIdle) { sessions.Remove(token); return null; }
                s.Seen = now;
                return s;
            }
        }

        object Login(Dictionary<string, object> req)
        {
            LoginResult r = db.Login(Json.Str(req, "login"), Json.Str(req, "password"));
            if (!r.Ok) throw new ShopException(r.Message);
            Session s = new Session();
            s.Token = NewToken(); s.UserId = r.UserId; s.Name = r.Name; s.Role = r.Role; s.Seen = clock();
            s.Perms.AddRange(r.Perms);
            bool pw = db.Read<long>(delegate (Sqlite c) { return c.Long("SELECT pass_hash <> '' FROM users WHERE id = ?", 0, s.UserId); }) == 1;
            s.Lockable = s.Locked = !pw && ProfitLock != null && ProfitLock();
            lock (gate) sessions[s.Token] = s;
            Dictionary<string, object> o = MeNow(s);
            o["token"] = s.Token;
            return o;
        }

        /* ومعه: هل له كلمة سر؟ (المدير بلا كلمة سر تنبّهه الواجهة) */
        Dictionary<string, object> MeNow(Session s)
        {
            Dictionary<string, object> o = Me(s);
            o["hasPassword"] = db.Read<long>(delegate (Sqlite c) { return c.Long("SELECT pass_hash <> '' FROM users WHERE id = ?", 0, s.UserId); }) == 1;
            return o;
        }

        /* بعد تغيير صلاحيات موظف أو إيقافه: جلساته المفتوحة تتبع فوراً */
        void RefreshSessions(long userId)
        {
            List<string> perms = db.Read<List<string>>(delegate (Sqlite c)
            {
                List<string> l = new List<string>();
                foreach (object[] r in c.Rows("SELECT perm FROM user_perms WHERE user_id = ?", userId)) l.Add((string)r[0]);
                return l;
            });
            bool active = db.Read<long>(delegate (Sqlite c) { return c.Long("SELECT active FROM users WHERE id = ?", 0, userId); }) == 1;
            lock (gate)
            {
                List<string> drop = new List<string>();
                foreach (Session s in sessions.Values)
                {
                    if (s.UserId != userId) continue;
                    if (!active) { drop.Add(s.Token); continue; }
                    s.Perms.Clear(); s.Perms.AddRange(perms);
                }
                foreach (string t in drop) sessions.Remove(t);
            }
        }

        static string NewToken()
        {
            byte[] b = new byte[16];
            using (RandomNumberGenerator r = RandomNumberGenerator.Create()) r.GetBytes(b);
            StringBuilder sb = new StringBuilder();
            foreach (byte x in b) sb.Append(x.ToString("x2", CultureInfo.InvariantCulture));
            return sb.ToString();
        }

        static Dictionary<string, object> Me(Session s)
        {
            Dictionary<string, object> o = new Dictionary<string, object>();
            o["userId"] = s.UserId; o["name"] = s.Name; o["role"] = s.Role;
            List<object> perms = new List<object>();
            for (int i = 0; i < PermList.GetLength(0); i++) if (s.Can(PermList[i, 0])) perms.Add(PermList[i, 0]);
            o["perms"] = perms;
            o["locked"] = s.Locked; o["lockable"] = s.Lockable;
            return o;
        }

        /* ---------- قراءة الطلب ---------- */

        public sealed class Ctx
        {
            public readonly Api A;
            public readonly Session S;
            public readonly Dictionary<string, object> R;

            public Ctx(Api a, Session s, Dictionary<string, object> r) { A = a; S = s; R = r; }

            public long User { get { return S.UserId; } }
            public bool Has(string k) { return R.ContainsKey(k) && R[k] != null; }
            public string Str(string k) { return Json.Str(R, k); }
            public bool Bool(string k) { return Json.Bool(R, k); }

            public long Long(string k)
            {
                object v;
                if (!R.TryGetValue(k, out v) || v == null) throw new ShopException("الحقل «" + k + "» ناقص.");
                return Num(v, k);
            }

            public long Long(string k, long def)
            {
                object v;
                if (!R.TryGetValue(k, out v) || v == null) return def;
                return Num(v, k);
            }

            static long Num(object v, string k)
            {
                if (v is long) return (long)v;
                if (v is double)
                {
                    double d = (double)v;
                    if (Math.Abs(d - Math.Round(d)) > 1e-9) throw new ShopException("الحقل «" + k + "» يجب أن يكون عدداً صحيحاً (المبالغ بالدرهم).");
                    return (long)Math.Round(d);
                }
                long l;
                string s = v as string;
                if (s != null && long.TryParse(s.Trim(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out l)) return l;
                throw new ShopException("الحقل «" + k + "» ليس رقماً.");
            }

            public List<Dictionary<string, object>> List(string k)
            {
                List<Dictionary<string, object>> l = new List<Dictionary<string, object>>();
                foreach (object o in Json.Arr(R, k))
                {
                    Dictionary<string, object> d = o as Dictionary<string, object>;
                    if (d == null) throw new ShopException("عناصر «" + k + "» يجب أن تكون كائنات.");
                    l.Add(d);
                }
                return l;
            }

            public List<long> Ids(string k)
            {
                List<long> l = new List<long>();
                foreach (object o in Json.Arr(R, k)) l.Add(Num(o, k));
                return l;
            }

            public List<string> Strs(string k)
            {
                List<string> l = new List<string>();
                foreach (object o in Json.Arr(R, k)) l.Add(Convert.ToString(o, CultureInfo.InvariantCulture));
                return l;
            }

            public static long L(Dictionary<string, object> o, string k, long def)
            {
                object v;
                if (!o.TryGetValue(k, out v) || v == null) return def;
                return Num(v, k);
            }
        }
    }
}
