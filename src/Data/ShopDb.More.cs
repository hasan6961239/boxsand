using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;

namespace Qirtasiya.Data
{
    public sealed class ReceiveLine
    {
        public long ItemId, Qty, Cost;
        public long PlaceId;                // 0 = مكان الصنف

        public ReceiveLine() { }
        public ReceiveLine(long itemId, long qty, long cost, long placeId) { ItemId = itemId; Qty = qty; Cost = cost; PlaceId = placeId; }
    }

    public sealed class ConsignLine
    {
        public string Kind = "book";
        public string Title = "", Author = "", Code = "", Unit = "", LocNote = "";
        public long Qty, Price, OwnerPrice;
        public long PlaceId = 1;
    }

    public sealed class CountResult
    {
        public long Total, Done, Ok, Less, More, LossQty, LossVal, Fixed;
    }

    public sealed class LoginResult
    {
        public bool Ok;
        public long UserId;
        public string Name = "", Role = "", Message = "";
        public List<string> Perms = new List<string>();
    }

    public sealed partial class ShopDb
    {
        /* ---------- إدخال البضاعة ---------- */

        public long Receive(long supplierId, string date, string note, IList<ReceiveLine> lines, long userId)
        {
            return Run<long>("receive", userId, delegate (Cmd c)
            {
                if (supplierId > 0 && db.Long("SELECT COUNT(*) FROM suppliers WHERE id = ?", 0, supplierId) == 0) throw Err("المورّد غير موجود.");
                List<ReceiveLine> keep = new List<ReceiveLine>();
                foreach (ReceiveLine l in lines)
                {
                    if (l.Qty < 0 || l.Cost < 0) throw Err("لا كميات ولا أسعار سالبة.");
                    if (l.Qty > 0) keep.Add(l);
                }
                if (keep.Count == 0) throw Err("أضف صنفاً واحداً على الأقل.");
                long total = 0;
                foreach (ReceiveLine l in keep) total += l.Qty * l.Cost;
                long id = db.Insert("INSERT INTO purchases(date, at, supplier_id, note, total, user_id) VALUES(?, ?, ?, ?, ?, ?)",
                    string.IsNullOrEmpty(date) ? c.Date : date, c.At, supplierId > 0 ? (object)supplierId : null, note ?? "", total, UserRef(userId));
                for (int i = 0; i < keep.Count; i++)
                {
                    ReceiveLine l = keep[i];
                    ItemRow it = ActiveItem(l.ItemId);
                    long place = l.PlaceId > 0 ? l.PlaceId : it.HomePlaceId;
                    if (db.Long("SELECT COUNT(*) FROM places WHERE id = ? AND active = 1", 0, place) == 0) throw Err("المكان غير موجود.");
                    db.Run("INSERT INTO purchase_lines(purchase_id, line_no, item_id, name, qty, cost, place_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
                        id, i + 1, it.Id, it.Title, l.Qty, l.Cost, place);
                    AddStock(c, it.Id, place, l.Qty, "receive", "purchase", id);
                    /* سعر الشراء الجديد يحلّ محل القديم، وصفر يعني «لم يُكتب» */
                    if (l.Cost > 0) db.Run("UPDATE items SET cost = ?, updated_at = ? WHERE id = ?", l.Cost, c.At, it.Id);
                    else db.Run("UPDATE items SET updated_at = ? WHERE id = ?", c.At, it.Id);
                }
                c.Detail = "إدخال بضاعة: " + keep.Count + " صنف بقيمة " + Money(total);
                c.RefType = "purchase"; c.RefId = id;
                return id;
            });
        }

        /* ---------- الكتب على المباع ---------- */

        /* صاحب البضاعة: موجود (consignorId) أو جديد بالاسم. كل سطر يصير صنفاً
           في المحل تصنيفه «على المباع» وسعر شرائه ما يأخذه صاحبه. */
        public long ConsignReceive(long consignorId, string newName, string newPhone, string date, string note,
            IList<ConsignLine> lines, long userId)
        {
            return Run<long>("consign-in", userId, delegate (Cmd c)
            {
                if (lines.Count == 0) throw Err("أضف كتاباً واحداً على الأقل.");
                Dictionary<string, bool> seen = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
                foreach (ConsignLine l in lines)
                {
                    if ((l.Title ?? "").Trim().Length == 0) throw Err("اكتب اسم كل كتاب.");
                    if (l.Qty <= 0 || l.Price < 0 || l.OwnerPrice < 0) throw Err("الكمية والأسعار غير صحيحة.");
                    string code = (l.Code ?? "").Trim();
                    if (code.Length == 0) continue;
                    string other = db.Text("SELECT title FROM items WHERE ((barcode = ? AND barcode <> '' AND active = 1) OR (code = ? AND active = 1))", code, code);
                    if (other != null) throw Err("الكود «" + code + "» مستعمل للصنف «" + other + "» في المحل.");
                    if (seen.ContainsKey(code)) throw Err("الكود «" + code + "» مكرر في هذا الاستلام.");
                    seen[code] = true;
                }
                string owner;
                if (consignorId > 0)
                {
                    owner = db.Text("SELECT name FROM consignors WHERE id = ?", consignorId);
                    if (owner == null) throw Err("صاحب البضاعة غير موجود.");
                }
                else
                {
                    owner = (newName ?? "").Trim();
                    if (owner.Length == 0) throw Err("اكتب اسم صاحب البضاعة.");
                    consignorId = db.Insert("INSERT INTO consignors(name, phone, note, created_at) VALUES(?, ?, '', ?)", owner, newPhone ?? "", c.At);
                }
                string day = string.IsNullOrEmpty(date) ? c.Date : date;
                foreach (ConsignLine l in lines)
                {
                    ItemInput d = new ItemInput();
                    d.Kind = l.Kind == "stat" ? "stat" : "book";
                    d.Code = (l.Code ?? "").Trim();
                    d.Barcode = d.Code;
                    d.Title = l.Title.Trim();
                    if (d.Kind == "book") d.Author = l.Author ?? ""; else d.Brand = l.Author ?? "";
                    d.Unit = l.Unit ?? "";
                    d.LocNote = l.LocNote ?? "";
                    d.Cat = "على المباع";
                    d.Cost = l.OwnerPrice; d.Price = l.Price;
                    d.Note = "على المباع — صاحبه: " + owner;
                    d.HomePlaceId = l.PlaceId > 0 ? l.PlaceId : 1;
                    long itemId = AddItem0(c, d, l.Qty, d.HomePlaceId, "consign-in");
                    string code = db.Text("SELECT code FROM items WHERE id = ?", itemId);
                    db.Run("INSERT INTO consignments(consignor_id, item_id, kind, title, author, code, qty, price, owner_price, date, note) " +
                        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", consignorId, itemId, d.Kind, d.Title, l.Author ?? "", code,
                        l.Qty, l.Price, l.OwnerPrice, day, note ?? "");
                }
                c.Detail = "كتب على المباع: استُلم " + lines.Count + " عنوان من " + owner;
                c.RefType = "consignor"; c.RefId = consignorId;
                return consignorId;
            });
        }

        /* إرجاع نسخ لم تُبع لصاحبها: تخرج من المخزون بلا سالب */
        public long ConsignGiveBack(long consignmentId, long n, long userId)
        {
            return Run<long>("consign-back", userId, delegate (Cmd c)
            {
                List<object[]> rs = db.Rows("SELECT IFNULL(item_id, 0), title, qty, sold, returned FROM consignments WHERE id = ?", consignmentId);
                if (rs.Count == 0) throw Err("السطر غير موجود.");
                object[] r = rs[0];
                long left = Math.Max((long)r[2] - (long)r[3] - (long)r[4], 0);
                long k = Math.Min(n, left);
                if (k <= 0) throw Err("لا توجد نسخ باقية لإرجاعها.");
                db.Run("UPDATE consignments SET returned = returned + ? WHERE id = ?", k, consignmentId);
                ItemRow it = (long)r[0] > 0 ? LoadItem((long)r[0]) : null;
                if (it != null)
                {
                    long taken;
                    TakeStock(c, it, k, false, "consign-back", "consignment", consignmentId, out taken);
                    db.Run("UPDATE items SET updated_at = ? WHERE id = ?", c.At, it.Id);
                }
                c.Detail = "إرجاع على المباع: " + r[1] + " ×" + k;
                c.RefType = "consignment"; c.RefId = consignmentId;
                return k;
            });
        }

        /* المستحق لصاحب البضاعة = ما بِيع × سعره − ما سُدّد له */
        public long ConsignDue(long consignorId)
        {
            lock (gate) return ConsignDue0(consignorId);
        }

        long ConsignDue0(long consignorId)
        {
            long due = db.Long("SELECT IFNULL(SUM(sold * owner_price), 0) FROM consignments WHERE consignor_id = ?", 0, consignorId);
            long paid = db.Long("SELECT IFNULL(SUM(amount), 0) FROM consignment_payments WHERE consignor_id = ?", 0, consignorId);
            return due - paid;
        }

        public long ConsignPay(long consignorId, long amount, string date, string note, bool fromDrawer, long userId)
        {
            return Run<long>("consign-pay", userId, delegate (Cmd c)
            {
                string name = db.Text("SELECT name FROM consignors WHERE id = ?", consignorId);
                if (name == null) throw Err("صاحب البضاعة غير موجود.");
                if (amount <= 0) throw Err("أدخل مبلغاً صحيحاً.");
                long rest = ConsignDue0(consignorId);
                if (amount > rest) throw Err("المستحق له " + Money(rest) + " فقط — لا تسدّد أكثر منه.");
                long id = db.Insert("INSERT INTO consignment_payments(consignor_id, amount, date, at, note, from_drawer, user_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
                    consignorId, amount, string.IsNullOrEmpty(date) ? c.Date : date, c.At, note ?? "", fromDrawer, UserRef(userId));
                c.Detail = "تسديد على المباع: " + name + " " + Money(amount);
                c.RefType = "consignor"; c.RefId = consignorId;
                return id;
            });
        }

        /* ---------- الجرد ----------
           النطاق: all | books | stat | cat (اسم التصنيف) | place (مكان وما تحته) */

        string ScopeSql(string scope, out object arg)
        {
            arg = null;
            switch (scope)
            {
                case "all": return "i.active = 1";
                case "books": return "i.active = 1 AND i.kind = 'book'";
                case "stat": return "i.active = 1 AND i.kind = 'stat'";
                case "cat": arg = ""; return "i.active = 1 AND i.cat = ?";
                case "place":
                    arg = 0L;
                    return "i.active = 1 AND i.home_place_id IN (WITH RECURSIVE t(id) AS (SELECT ? UNION ALL " +
                        "SELECT p.id FROM places p JOIN t ON p.parent_id = t.id) SELECT id FROM t)";
                default: throw Err("نطاق جرد غير معروف: " + scope);
            }
        }

        public long CountStart(string scope, string value, long userId)
        {
            return Run<long>("count-start", userId, delegate (Cmd c)
            {
                if (db.Long("SELECT COUNT(*) FROM count_sessions WHERE status = 'open'", 0) > 0) throw Err("جرد آخر مفتوح. أنهِه أو ألغِه أولاً.");
                object arg;
                string where = ScopeSql(scope, out arg);
                object a = arg == null ? null : (arg is long ? (object)ParseLong(value) : (object)(value ?? ""));
                long n = a == null ? db.Long("SELECT COUNT(*) FROM items i WHERE " + where, 0)
                    : db.Long("SELECT COUNT(*) FROM items i WHERE " + where, 0, a);
                if (n == 0) throw Err("لا توجد أصناف في هذا النطاق.");
                long id = db.Insert("INSERT INTO count_sessions(started_at, scope, scope_value, n_items, user_id) VALUES(?, ?, ?, ?, ?)",
                    c.At, scope, value ?? "", n, UserRef(userId));
                c.Detail = "جرد فعلي: بدأ — " + n + " صنف";
                c.RefType = "count"; c.RefId = id;
                return id;
            });
        }

        static long ParseLong(string s)
        {
            long v;
            return long.TryParse(s, out v) ? v : 0;
        }

        /* العدد المعدود لصنف (null = تراجع عن عدّه). المسجَّل يُحفظ لحظتها */
        public void CountSet(long sessionId, long itemId, long? counted, long userId)
        {
            Run("count-set", userId, delegate (Cmd c)
            {
                if (db.Long("SELECT COUNT(*) FROM count_sessions WHERE id = ? AND status = 'open'", 0, sessionId) == 0) throw Err("لا جرد مفتوح.");
                ItemRow it = ActiveItem(itemId);
                if (counted == null)
                {
                    db.Run("DELETE FROM count_entries WHERE session_id = ? AND item_id = ?", sessionId, itemId);
                    c.Detail = "جرد: تراجع عن " + it.Title;
                    return;
                }
                if (counted.Value < 0) throw Err("العدد لا يكون سالباً.");
                db.Run("INSERT INTO count_entries(session_id, item_id, name, base_qty, counted_qty, cost, counted_at) VALUES(?, ?, ?, ?, ?, ?, ?) " +
                    "ON CONFLICT(session_id, item_id) DO UPDATE SET base_qty = excluded.base_qty, counted_qty = excluded.counted_qty, " +
                    "cost = excluded.cost, counted_at = excluded.counted_at",
                    sessionId, itemId, it.Title, ShopQty0(itemId), counted.Value, it.Cost, c.At);
                c.Detail = "جرد: " + it.Title + " → " + counted.Value;
                c.RefType = "count"; c.RefId = sessionId;
            });
        }

        /* يصحّح المخزون: الكمية الآن + (المعدود − المسجَّل وقت العدّ). ما بِيع
           بعد العدّ يبقى محسوباً. */
        public CountResult CountApply(long sessionId, long userId)
        {
            return Run<CountResult>("count-apply", userId, delegate (Cmd c)
            {
                List<object[]> ss = db.Rows("SELECT n_items FROM count_sessions WHERE id = ? AND status = 'open'", sessionId);
                if (ss.Count == 0) throw Err("لا جرد مفتوح.");
                CountResult res = new CountResult();
                res.Total = (long)ss[0][0];
                foreach (object[] e in db.Rows("SELECT IFNULL(item_id, 0), base_qty, counted_qty, cost FROM count_entries WHERE session_id = ?", sessionId))
                {
                    res.Done++;
                    long diff = (long)e[2] - (long)e[1];
                    if (diff == 0) { res.Ok++; continue; }
                    if (diff < 0) { res.Less++; res.LossQty += -diff; res.LossVal += -diff * (long)e[3]; }
                    else res.More++;
                    ItemRow it = (long)e[0] > 0 ? LoadItem((long)e[0]) : null;
                    if (it == null) continue;
                    if (diff > 0) AddStock(c, it.Id, it.HomePlaceId, diff, "count", "count", sessionId);
                    else
                    {
                        long taken;
                        TakeStock(c, it, -diff, true, "count", "count", sessionId, out taken);
                    }
                    db.Run("UPDATE items SET updated_at = ? WHERE id = ?", c.At, it.Id);
                    res.Fixed++;
                }
                db.Run("UPDATE count_sessions SET status = 'applied', done_at = ?, done = ?, ok = ?, less = ?, more = ?, loss_qty = ?, loss_val = ? WHERE id = ?",
                    c.At, res.Done, res.Ok, res.Less, res.More, res.LossQty, res.LossVal, sessionId);
                c.Detail = "جرد فعلي: صُحّح " + res.Fixed + " صنفاً · نقص " + res.LossQty + " قطعة";
                c.RefType = "count"; c.RefId = sessionId;
                return res;
            });
        }

        public void CountCancel(long sessionId, long userId)
        {
            Run("count-cancel", userId, delegate (Cmd c)
            {
                if (db.Run("UPDATE count_sessions SET status = 'cancelled', done_at = ? WHERE id = ? AND status = 'open'", c.At, sessionId) == 0)
                    throw Err("لا جرد مفتوح.");
                db.Run("DELETE FROM count_entries WHERE session_id = ?", sessionId);
                c.Detail = "جرد فعلي: أُلغي";
                c.RefType = "count"; c.RefId = sessionId;
            });
        }

        /* ---------- المستخدمون (قرار 0011) ---------- */

        /* الموظف الجديد يبدأ بالبيع والبحث ومشاهدة المخزون فقط */
        public static readonly string[] StaffDefault = { "sell", "search", "view_stock" };

        public const int MaxFailed = 5;
        public static readonly TimeSpan LockFor = TimeSpan.FromMinutes(5);
        public const int HashIterations = 120000;

        public long AddUser(string name, string login, string password, string role, IList<string> perms, long userId)
        {
            return Run<long>("user-add", userId, delegate (Cmd c)
            {
                name = (name ?? "").Trim(); login = (login ?? "").Trim();
                if (name.Length == 0 || login.Length == 0) throw Err("اكتب الاسم واسم الدخول.");
                if (role != "admin" && role != "staff") throw Err("دور غير معروف.");
                if (db.Long("SELECT COUNT(*) FROM users WHERE login = ? COLLATE NOCASE", 0, login) > 0) throw Err("اسم الدخول «" + login + "» مستعمل.");
                long id = db.Insert("INSERT INTO users(name, login, role, pass_hash, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)",
                    name, login, role, string.IsNullOrEmpty(password) ? "" : HashPassword(password), c.At, c.At);
                foreach (string p in perms ?? (IList<string>)StaffDefault)
                    db.Run("INSERT OR IGNORE INTO user_perms(user_id, perm) VALUES(?, ?)", id, p);
                c.Detail = "إضافة مستخدم: " + name;
                c.RefType = "user"; c.RefId = id;
                return id;
            });
        }

        public void SetPassword(long id, string password, long userId)
        {
            Run("user-password", userId, delegate (Cmd c)
            {
                if (db.Run("UPDATE users SET pass_hash = ?, failed = 0, locked_until = '', updated_at = ? WHERE id = ?",
                    string.IsNullOrEmpty(password) ? "" : HashPassword(password), c.At, id) == 0) throw Err("المستخدم غير موجود.");
                c.Detail = "تغيير كلمة السر: " + db.Text("SELECT name FROM users WHERE id = ?", id);
                c.RefType = "user"; c.RefId = id;
            });
        }

        public void SetPerms(long id, IList<string> perms, long userId)
        {
            Run("user-perms", userId, delegate (Cmd c)
            {
                string name = db.Text("SELECT name FROM users WHERE id = ?", id);
                if (name == null) throw Err("المستخدم غير موجود.");
                List<string> before = Perms0(id);
                db.Run("DELETE FROM user_perms WHERE user_id = ?", id);
                foreach (string p in perms) db.Run("INSERT OR IGNORE INTO user_perms(user_id, perm) VALUES(?, ?)", id, p);
                c.Before = string.Join(",", before.ToArray());
                c.After = string.Join(",", Perms0(id).ToArray());
                c.Detail = "صلاحيات: " + name;
                c.RefType = "user"; c.RefId = id;
            });
        }

        List<string> Perms0(long id)
        {
            List<string> l = new List<string>();
            foreach (object[] r in db.Rows("SELECT perm FROM user_perms WHERE user_id = ? ORDER BY perm", id)) l.Add((string)r[0]);
            return l;
        }

        /* محاولة دخول. كل محاولة تُسجَّل (من حاول ومتى)، وبعد 5 خاطئة يُقفل
           الحساب دقائق. الرسالة لا تقول أيّهما خطأ: الاسم أم كلمة السر. */
        public LoginResult Login(string login, string password)
        {
            return Run<LoginResult>("login", 0, delegate (Cmd c)
            {
                LoginResult res = new LoginResult();
                List<object[]> rs = db.Rows("SELECT id, name, role, pass_hash, failed, locked_until, active FROM users WHERE login = ? COLLATE NOCASE", (login ?? "").Trim());
                c.Detail = "دخول: " + (login ?? "");
                if (rs.Count == 0 || (long)rs[0][6] == 0) { res.Message = "اسم الدخول أو كلمة السر غير صحيحة."; return res; }
                object[] u = rs[0];
                long id = (long)u[0];
                c.RefType = "user"; c.RefId = id;
                string until = (string)u[5];
                if (until.Length > 0 && string.CompareOrdinal(until, c.At) > 0)
                {
                    res.Message = "الحساب مقفل بعد محاولات خاطئة. حاول بعد " + until.Substring(11, 5) + ".";
                    c.Detail += " — مقفل";
                    return res;
                }
                string hash = (string)u[3];
                bool ok = hash.Length == 0 ? string.IsNullOrEmpty(password) : VerifyPassword(password ?? "", hash);
                if (!ok)
                {
                    long failed = (long)u[4] + 1;
                    string lockTo = "";
                    if (failed >= MaxFailed) { lockTo = Stamp(Now.Add(LockFor)); failed = 0; }
                    db.Run("UPDATE users SET failed = ?, locked_until = ? WHERE id = ?", failed, lockTo, id);
                    res.Message = lockTo.Length > 0 ? "محاولات خاطئة كثيرة. الحساب مقفل حتى " + lockTo.Substring(11, 5) + "."
                        : "اسم الدخول أو كلمة السر غير صحيحة.";
                    c.Detail += " — خاطئة";
                    return res;
                }
                if ((long)u[4] != 0 || until.Length > 0) db.Run("UPDATE users SET failed = 0, locked_until = '' WHERE id = ?", id);
                res.Ok = true; res.UserId = id; res.Name = (string)u[1]; res.Role = (string)u[2];
                res.Perms = Perms0(id);
                c.Detail += " — ناجح";
                return res;
            });
        }

        /* PBKDF2-HMAC-SHA256 مكتوب هنا: Rfc2898DeriveBytes بـ SHA256 غير مضمون
           في كل نسخ .NET 4 وmono، والناتج يجب أن يكون واحداً في الاثنين. */
        public static string HashPassword(string password)
        {
            byte[] salt = new byte[16];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(salt);
            byte[] h = Pbkdf2(Encoding.UTF8.GetBytes(password), salt, HashIterations, 32);
            return "pbkdf2-sha256$" + HashIterations + "$" + Convert.ToBase64String(salt) + "$" + Convert.ToBase64String(h);
        }

        public static bool VerifyPassword(string password, string stored)
        {
            string[] p = (stored ?? "").Split('$');
            if (p.Length != 4 || p[0] != "pbkdf2-sha256") return false;
            int iter;
            if (!int.TryParse(p[1], out iter) || iter < 1) return false;
            byte[] salt, want;
            try { salt = Convert.FromBase64String(p[2]); want = Convert.FromBase64String(p[3]); }
            catch (FormatException) { return false; }
            byte[] got = Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iter, want.Length);
            int diff = 0;
            for (int i = 0; i < want.Length; i++) diff |= want[i] ^ got[i];
            return diff == 0;
        }

        public static byte[] Pbkdf2(byte[] password, byte[] salt, int iterations, int length)
        {
            using (HMACSHA256 mac = new HMACSHA256(password))
            {
                byte[] output = new byte[length];
                int blocks = (length + 31) / 32;
                for (int b = 1; b <= blocks; b++)
                {
                    byte[] s = new byte[salt.Length + 4];
                    Buffer.BlockCopy(salt, 0, s, 0, salt.Length);
                    s[salt.Length] = (byte)(b >> 24); s[salt.Length + 1] = (byte)(b >> 16);
                    s[salt.Length + 2] = (byte)(b >> 8); s[salt.Length + 3] = (byte)b;
                    byte[] u = mac.ComputeHash(s);
                    byte[] t = (byte[])u.Clone();
                    for (int i = 1; i < iterations; i++)
                    {
                        u = mac.ComputeHash(u);
                        for (int k = 0; k < t.Length; k++) t[k] ^= u[k];
                    }
                    int off = (b - 1) * 32;
                    Buffer.BlockCopy(t, 0, output, off, Math.Min(32, length - off));
                }
                return output;
            }
        }

        /* ---------- رسائل الفروع ---------- */

        public void SaveBranchMessage(string uid, string kind, string from, string to, string refId, string status,
            string note, string linesJson, string at, long userId)
        {
            Run("branch-message", userId, delegate (Cmd c)
            {
                if (string.IsNullOrEmpty(uid)) throw Err("رسالة بلا معرّف.");
                db.Run("INSERT INTO branch_messages(uid, kind, from_branch, to_branch, ref, status, note, lines, at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) " +
                    "ON CONFLICT(uid) DO UPDATE SET status = excluded.status, note = excluded.note",
                    uid, kind ?? "", from ?? "", to ?? "", refId ?? "", status ?? "", note ?? "", string.IsNullOrEmpty(linesJson) ? "[]" : linesJson,
                    string.IsNullOrEmpty(at) ? c.At : at);
                c.Detail = "رسالة فرع: " + kind + " " + uid;
            });
        }
    }
}
