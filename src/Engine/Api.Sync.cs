using System;
using System.Collections.Generic;
using System.Globalization;
using Qirtasiya.Data;

namespace Qirtasiya.Engine
{
    /* ============================================================
       المزامنة في المحرك (قرار 0023)
       ------------------------------------------------------------
       - على الجهاز الثاني: أمر يكتب (إضافة كتاب، بيعة...) لا يُنفَّذ هنا،
         يُحفظ منتظراً ويُرسل لجهاز المحل، والرد {queued: true}.
       - على جهاز المحل: ينفّذ أمر الجهاز الثاني باسم صاحبه وصلاحياته عند
         جهاز المحل، مرة واحدة (ShopDb يسجّله في معاملة الأمر نفسها).
       - البحث في كتب الفروع الأخرى.
       ============================================================ */
    public sealed partial class Api
    {
        /* البرنامج يوقظ حلقة المزامنة: أمر انتظر على الجهاز الثاني */
        public Action Queued;

        readonly Dictionary<long, int> remoteTries = new Dictionary<long, int>();

        void RegisterSync()
        {
            Add("outbox.list", AnyUser, delegate (Ctx c)
            {
                return db.Replica ? (object)db.OutboxView() : new List<object>();
            });
            Add("outbox.dismiss", AnyUser, delegate (Ctx c) { db.OutboxDismiss(c.Long("n")); return null; });
            Add("branches.list", "search", delegate (Ctx c) { return db.RemoteBranches(); });
            Add("branch.search", "search", delegate (Ctx c)
            {
                return db.SearchRemote(c.Str("q"), c.Str("branch"), (int)Limit(c, 50));
            });
        }

        /* الجهاز الثاني: الأمر ينتظر جهاز المحل. البيعة تحمل وقتها هنا، لا وقت تنفيذها هناك */
        object Queue(Session s, string name, Dictionary<string, object> req)
        {
            if (name == "sale" && !req.ContainsKey("at"))
            {
                DateTime now = clock();
                req["at"] = ShopDb.Stamp(now);
                req["date"] = ShopDb.Day(now);
            }
            string label = Label(name, req);
            long n = db.OutboxAdd(s.UserId, name, Json.Write(req), label);
            Action q = Queued;
            if (q != null) q();
            return O("queued", true, "n", n, "label", label);
        }

        /* وصف قصير لما ينتظر، بلغة البائع */
        string Label(string name, Dictionary<string, object> req)
        {
            switch (name)
            {
                case "item.add": return "إضافة صنف: " + Json.Str(req, "title");
                case "item.edit":
                case "item.delete":
                    {
                        long id = Json.Long(req, "id", 0);
                        ItemRow it = id > 0 ? db.GetItem(id) : null;
                        string t = Json.Str(req, "title").Length > 0 ? Json.Str(req, "title") : it != null ? it.Title : "#" + id;
                        return (name == "item.edit" ? "تعديل صنف: " : "حذف صنف: ") + t;
                    }
                case "sale": return "بيعة (" + Json.Arr(req, "lines").Count + " صنف)";
                case "return": return "إرجاع من فاتورة";
                case "receive": return "إدخال بضاعة (" + Json.Arr(req, "lines").Count + " صنف)";
                case "customer.add": return "زبون جديد: " + Json.Str(req, "name");
                case "payment.add": return "تسديد دين";
                case "me.password": return "تغيير كلمة السر";
                case "x3.apply": return X3Label(req);
                default: return "أمر: " + name;
            }
        }

        /* جلسة لصاحب الأمر كما هو عند جهاز المحل الآن: موقوف أو بلا صلاحية = يُرفض */
        Session UserSession(long userId)
        {
            return db.Read<Session>(delegate (Sqlite c)
            {
                List<object[]> u = c.Rows("SELECT name, role, active FROM users WHERE id = ?", userId);
                if (u.Count == 0 || (long)u[0][2] != 1) return null;
                Session s = new Session();
                s.UserId = userId; s.Name = (string)u[0][0]; s.Role = (string)u[0][1]; s.Seen = clock();
                foreach (object[] r in c.Rows("SELECT perm FROM user_perms WHERE user_id = ?", userId)) s.Perms.Add((string)r[0]);
                return s;
            });
        }

        /* جهاز المحل ينفّذ أمر جهاز ثانٍ. null = نُفِّذ (أو نُفِّذ من قبل)، وإلا سبب الرفض.
           خطأ غير متوقع (قرص، قاعدة) يُرمى لتُعاد المحاولة، وبعد 3 مرات يُسجَّل رفضاً
           فلا يقف طابور الأوامر كله خلف أمر واحد. */
        public string ExecRemote(long id, string device, string deviceName, long n, string data)
        {
            if (db.RemoteDone(id)) return null;
            RemoteCmd rc = new RemoteCmd();
            rc.Id = id; rc.Device = device; rc.N = n;
            rc.Label = "جهاز ثانٍ: " + (string.IsNullOrEmpty(deviceName) ? device : deviceName);
            Dictionary<string, object> d = null;
            try { d = Json.Parse(data) as Dictionary<string, object>; }
            catch (FormatException) { }
            string err = null;
            Command cmd = null;
            Session s = null;
            Dictionary<string, object> body = null;
            if (d == null) { rc.Cmd = "?"; err = "أمر غير مفهوم."; }
            else
            {
                rc.Cmd = Json.Str(d, "cmd");
                rc.UserId = Json.Long(d, "user", 0);
                body = Json.Obj(d, "body") ?? new Dictionary<string, object>();
                if (!commands.TryGetValue(rc.Cmd, out cmd)) err = "أمر غير معروف: " + rc.Cmd;
                else if ((s = rc.UserId > 0 ? UserSession(rc.UserId) : null) == null) err = "المستخدم غير موجود أو موقوف عند جهاز المحل.";
                else if (cmd.Perm != AnyUser && !s.Can(cmd.Perm)) err = "لا تملك صلاحية عند جهاز المحل: " + PermLabel(cmd.Perm);
            }
            if (err == null)
            {
                ShopDb.BeginRemote(rc);
                try { AfterRun(rc.Cmd, body, cmd.Run(new Ctx(this, s, body))); }
                catch (ShopException e) { err = e.Message; }
                catch (FormatException e) { err = e.Message; }
                catch (ObjectDisposedException) { throw; }
                catch (Exception e)
                {
                    int tries;
                    lock (remoteTries)
                    {
                        remoteTries.TryGetValue(id, out tries);
                        remoteTries[id] = ++tries;
                    }
                    if (tries < 3 && !rc.Recorded) throw;
                    err = "خطأ عند جهاز المحل: " + e.Message;
                }
                finally { ShopDb.EndRemote(); }
            }
            if (rc.Recorded) return null;
            db.FinishRemote(rc, err == null, err ?? "");
            return err;
        }
    }
}
