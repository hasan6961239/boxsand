using System;
using System.Collections.Generic;
using Qirtasiya.Data;

namespace Qirtasiya.Engine
{
    /* ============================================================
       واجهة 3.x فوق الأساس الجديد (قرار 0025)
       ------------------------------------------------------------
       - x3.apply: تغييرات ملف 3.x (ShopDb.X3Diff) تُطبَّق هنا. على الجهاز
         الثاني لا تُكتب: تنتظر جهاز المحل كأي أمر (قرار 0023)، وهناك تُطبَّق
         فرقاً فوق ما عنده (الكميات والديون معاً، وأرقام الفواتير التالية).
       - RunInternal: البرنامج نفسه ينفّذ الأمر باسم المدير. واجهة 3.x بلا
         دخول موظفين، والحفظ يمر من نافذتها المالكة وحدها.
       ============================================================ */
    public sealed partial class Api
    {
        void RegisterX3()
        {
            Add("x3.apply", "settings", delegate (Ctx c)
            {
                object ops;
                if (!c.R.TryGetValue("ops", out ops)) throw new ShopException("تغييرات 3.x ناقصة.");
                ShopDb.X3Result r = db.X3Apply(ShopDb.X3OpsFrom(ops), ShopDb.InRemote, c.User, "");
                return O("changes", (long)r.Changes, "merged", r.Merged);
            });
        }

        /* وصف ما ينتظر جهاز المحل من الجهاز الثاني: «بيعة · كتاب جديد: …» */
        static string X3Label(Dictionary<string, object> req)
        {
            List<string> parts = new List<string>();
            int sales = 0, books = 0, edits = 0;
            string title = "";
            foreach (object o in Json.Arr(req, "ops"))
            {
                Dictionary<string, object> d = o as Dictionary<string, object>;
                if (d == null) continue;
                string c = Json.Str(d, "c");
                bool isNew = !d.ContainsKey("b") && d.ContainsKey("n") && Json.Str(d, "k").Length > 0;
                if (c == "invoices" && isNew) sales++;
                else if ((c == "books" || c == "stationery") && isNew)
                {
                    books++;
                    Dictionary<string, object> n = d["n"] as Dictionary<string, object>;
                    if (n != null && title.Length == 0) title = Json.Str(n, c == "books" ? "title" : "name");
                }
                else if (c == "books" || c == "stationery" || c == "customers") edits++;
            }
            if (sales > 0) parts.Add(sales == 1 ? "بيعة" : sales + " فواتير");
            if (books > 0) parts.Add(books == 1 ? "صنف جديد: " + title : books + " أصناف جديدة");
            if (sales == 0 && books == 0 && edits > 0) parts.Add(edits == 1 ? "تعديل صنف" : edits + " تعديلات");
            return parts.Count > 0 ? string.Join(" · ", parts.ToArray()) : "حفظ من 3.x";
        }

        /* أمر من البرنامج باسم المدير (رقم 1)، بقواعد Handle نفسها: على الجهاز الثاني ينتظر */
        public ApiResult RunInternal(string name, string body)
        {
            try
            {
                Command cmd;
                if (!commands.TryGetValue(name, out cmd)) return Fail(404, "أمر غير معروف: " + name);
                Session s = UserSession(1);
                if (s == null) return Fail(401, "المدير غير موجود في هذه القاعدة.");
                Dictionary<string, object> req = Json.Parse(string.IsNullOrEmpty(body) ? "{}" : body) as Dictionary<string, object>;
                if (req == null) return Fail(400, "الطلب ليس كائن JSON.");
                object res;
                try { res = cmd.Run(new Ctx(this, s, req)); }
                catch (ReplicaWriteException) { return Ok(Queue(s, name, req)); }
                AfterRun(name, req, res);
                return Ok(res);
            }
            catch (ShopException e) { return Fail(200, e.Message); }
            catch (FormatException e) { return Fail(400, e.Message); }
        }
    }
}
