using System;
using System.Collections.Generic;
using System.IO;
using Qirtasiya.Data;
using Qirtasiya.Engine;

/* أوامر المحرك: الجلسات، والصلاحيات (قرار 0011)، والأوامر نفسها */
static class ApiTests
{
    static Api api;
    static DateTime now = new DateTime(2026, 10, 26, 10, 0, 0);

    static Dictionary<string, object> Call(string cmd, string token, string body, out int status)
    {
        ApiResult r = api.Handle(cmd, token, body);
        status = r.Status;
        return (Dictionary<string, object>)Json.Parse(r.Json);
    }

    static Dictionary<string, object> Call(string cmd, string token, string body)
    {
        int st;
        return Call(cmd, token, body, out st);
    }

    static object Data(string cmd, string token, string body)
    {
        Dictionary<string, object> r = Call(cmd, token, body);
        if (!(bool)r["ok"]) throw new Exception(cmd + ": " + r["error"]);
        object d;
        r.TryGetValue("data", out d);
        return d;
    }

    static Dictionary<string, object> D(object o) { return (Dictionary<string, object>)o; }
    static List<object> A(object o) { return (List<object>)o; }

    public static void Run(ImportTests.Check ok)
    {
        string path = Path.Combine(Path.GetTempPath(), "qapi-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".db");
        OpenOptions oo = new OpenOptions();
        oo.Clock = delegate { return now; };
        ShopDb db = ShopDb.Open(path, oo);
        api = new Api(db, delegate { return now; });
        int st;

        /* كل أمر يعلن صلاحية معروفة */
        Dictionary<string, string> perms = api.CommandPerms();
        List<string> bad = new List<string>();
        foreach (KeyValuePair<string, string> kv in perms)
            if (kv.Value != Api.AnyUser && !Api.KnownPerm(kv.Value)) bad.Add(kv.Key);
        ok(perms.Count > 50 && bad.Count == 0, "كل أمر من " + perms.Count + " أمراً يعلن صلاحية معروفة", string.Join(",", bad.ToArray()));
        List<string> open = new List<string>();
        foreach (KeyValuePair<string, string> kv in perms) if (kv.Value == Api.AnyUser) open.Add(kv.Key);
        open.Sort();
        ok(string.Join(",", open.ToArray()) == "me,me.password,shop.info", "والمفتوحة لكل موظف ثلاثة فقط: me وme.password وshop.info", string.Join(",", open.ToArray()));

        Call("items.page", null, "{}", out st);
        ok(st == 401, "بلا جلسة: 401", st);
        Call("no.such", "x", "{}", out st);
        ok(st == 404, "أمر غير معروف: 404", st);
        Call("login", null, "{oops", out st);
        ok(st == 400, "JSON معطوب: 400", st);

        Dictionary<string, object> lr = D(Data("login", null, "{\"login\":\"admin\",\"password\":\"\"}"));
        string admin = (string)lr["token"];
        ok(admin.Length == 32 && (string)lr["role"] == "admin" && A(lr["perms"]).Count == Api.PermList.GetLength(0),
            "المدير الافتراضي يدخل بلا كلمة سر وله كل الصلاحيات");

        long shelf = (long)Data("place.add", admin, "{\"kind\":\"shelf\",\"name\":\"رف 1\",\"code\":\"1\"}");
        long item = (long)Data("item.add", admin, "{\"title\":\"الفيزياء الأساسية\",\"price\":45500,\"priceW\":40000,\"cost\":30000,\"homePlaceId\":" + shelf + ",\"qty\":10,\"barcode\":\"9789953000011\"}");
        Dictionary<string, object> it = D(Data("item.get", admin, "{\"id\":" + item + "}"));
        ok((long)it["cost"] == 30000 && (long)it["qty"] == 10 && A(it["stock"]).Count == 1, "item.get: المدير يرى سعر الشراء، والكمية في كل مكان");
        Call("item.add", admin, "{\"title\":\"كسر\",\"price\":12.5}", out st);
        Dictionary<string, object> frac = Call("item.add", admin, "{\"title\":\"كسر\",\"price\":12.5}");
        ok(!(bool)frac["ok"] && ((string)frac["error"]).Contains("بالدرهم"), "المبلغ بكسر يُرفض: المبالغ أعداد صحيحة بالدرهم", frac["error"]);
        Dictionary<string, object> found = D(Data("item.find", admin, "{\"barcode\":\"9789953000011\"}"));
        ok((long)found["id"] == item, "item.find بالباركود");
        Dictionary<string, object> page = D(Data("items.page", admin, "{\"q\":\"فيزياء\"}"));
        ok((long)page["total"] == 1 && A(page["items"]).Count == 1, "items.page يبحث في الاسم");

        Dictionary<string, object> sale = D(Data("sale", admin, "{\"lines\":[{\"itemId\":" + item + ",\"qty\":2}]}"));
        ok((long)sale["total"] == 91000 && (long)sale["no"] == 1, "sale: سطر بلا سعر يأخذ سعر الصنف (2 × 45.5 = 91)", sale["total"]);
        Dictionary<string, object> inv = D(Data("invoice.get", admin, "{\"no\":1}"));
        ok(inv.ContainsKey("profit") && D(A(inv["lines"])[0]).ContainsKey("cost"), "invoice.get: المدير يرى الربح وسعر الشراء");

        /* موظف بالصلاحيات الافتراضية */
        long uid = (long)Data("user.add", admin, "{\"name\":\"موظف\",\"login\":\"ali\",\"password\":\"1234\"}");
        Dictionary<string, object> bad1 = Call("login", null, "{\"login\":\"ali\",\"password\":\"0000\"}");
        ok(!(bool)bad1["ok"] && ((string)bad1["error"]).Contains("غير صحيحة"), "كلمة سر خاطئة تُرفض");
        string ali = (string)D(Data("login", null, "{\"login\":\"ali\",\"password\":\"1234\"}"))["token"];
        Dictionary<string, object> me = D(Data("me", ali, "{}"));
        ok(string.Join(",", A(me["perms"]).ConvertAll(delegate (object x) { return (string)x; }).ToArray()) == "sell,search,view_stock",
            "الموظف الجديد: بيع وبحث ومشاهدة فقط");
        it = D(Data("item.get", ali, "{\"id\":" + item + "}"));
        ok(!it.ContainsKey("cost"), "item.get: الموظف لا يرى سعر الشراء");
        page = D(Data("items.page", ali, "{}"));
        ok(!D(A(page["items"])[0]).ContainsKey("cost"), "items.page: ولا في القوائم");
        inv = D(Data("invoice.get", ali, "{\"no\":1}"));
        ok(!inv.ContainsKey("profit") && !D(A(inv["lines"])[0]).ContainsKey("cost"), "invoice.get: ولا الربح");
        Dictionary<string, object> denied = Call("item.edit", ali, "{\"id\":" + item + ",\"price\":1000}", out st);
        ok(st == 403 && (string)denied["perm"] == "edit_items" && ((string)denied["error"]).Contains("إضافة الأصناف"), "تعديل صنف بلا صلاحية: 403 مع اسم الصلاحية", denied["error"]);
        Dictionary<string, object> s2 = D(Data("sale", ali, "{\"lines\":[{\"itemId\":" + item + ",\"qty\":1,\"price\":45500}]}"));
        ok((long)s2["no"] == 2, "الموظف يبيع");
        Call("return", ali, "{\"invoiceId\":" + (long)s2["id"] + ",\"lines\":[]}", out st);
        ok(st == 403, "ولا يُرجع بلا صلاحية الإرجاع");
        Call("report.range", ali, "{}", out st);
        ok(st == 403, "ولا يرى التقارير");
        Call("ops.page", ali, "{}", out st);
        ok(st == 403, "ولا سجل العمليات");
        Call("setting.set", ali, "{\"key\":\"x\",\"value\":1}", out st);
        ok(st == 403, "ولا يغيّر الإعدادات");

        Data("user.perms", admin, "{\"id\":" + uid + ",\"perms\":[\"sell\",\"search\",\"view_stock\",\"returns\",\"edit_items\"]}");
        InvoiceRow iv = db.GetInvoice((long)s2["id"]);
        Dictionary<string, object> back = D(Data("return", ali, "{\"invoiceId\":" + iv.Id + ",\"lines\":[{\"lineId\":" + iv.Lines[0].Id + ",\"qty\":1}]}"));
        ok((long)back["total"] == -45500, "بعد منحه الإرجاع: جلسته المفتوحة تتبع فوراً");
        Data("item.edit", ali, "{\"id\":" + item + ",\"title\":\"الفيزياء الأساسية — طبعة 2\"}");
        ok(db.GetItem(item).Title.EndsWith("طبعة 2") && db.GetItem(item).Cost == 30000, "تعديل الاسم بلا لمس سعر الشراء الذي لا يراه");
        Dictionary<string, object> np = Call("item.edit", ali, "{\"id\":" + item + ",\"price\":50000}");
        ok(!(bool)np["ok"] && ((string)np["error"]).Contains("تعديل الأسعار"), "تعديل السعر يحتاج صلاحية تعديل الأسعار", np["error"]);
        Data("item.edit", ali, "{\"id\":" + item + ",\"cost\":1}");
        ok(db.GetItem(item).Cost == 30000, "سعر الشراء المرسل ممن لا يراه يُتجاهل");
        Call("perms.list", ali, "{}", out st);
        ok(st == 403, "قائمة الصلاحيات للمدير وحده");
        Dictionary<string, object> badPerm = Call("user.perms", admin, "{\"id\":" + uid + ",\"perms\":[\"fly\"]}");
        ok(!(bool)badPerm["ok"] && ((string)badPerm["error"]).Contains("غير معروفة"), "صلاحية غير معروفة تُرفض");

        Data("me.password", ali, "{\"current\":\"1234\",\"next\":\"9999\"}");
        ok((bool)Call("login", null, "{\"login\":\"ali\",\"password\":\"9999\"}")["ok"], "الموظف يغيّر كلمة سره بنفسه");
        Dictionary<string, object> wrong = Call("me.password", ali, "{\"current\":\"0000\",\"next\":\"1111\"}");
        ok(!(bool)wrong["ok"], "وبكلمة السر الحالية فقط");
        Data("user.active", admin, "{\"id\":" + uid + ",\"active\":false}");
        Call("me", ali, "{}", out st);
        ok(st == 401, "إيقاف الموظف يُنهي جلساته المفتوحة");
        Dictionary<string, object> lastAdmin = Call("user.active", admin, "{\"id\":1,\"active\":false}");
        ok(!(bool)lastAdmin["ok"], "المدير لا يوقف حسابه وهو داخل به");

        /* بقية الأوامر */
        long cu = (long)Data("customer.add", admin, "{\"name\":\"زبون\",\"phone\":\"0900000001\",\"opening\":5000}");
        Data("sale", admin, "{\"lines\":[{\"itemId\":" + item + ",\"qty\":1}],\"method\":\"credit\",\"customerId\":" + cu + "}");
        ok((long)Data("payment.add", admin, "{\"customerId\":" + cu + ",\"amount\":100000}") == 50500, "تسديد لا يتجاوز الدين (50.5)");
        Dictionary<string, object> cj = D(Data("customer.get", admin, "{\"id\":" + cu + "}"));
        ok(A(cj["invoices"]).Count == 1 && A(cj["payments"]).Count == 1 && (long)cj["balance"] == 0, "كشف الزبون: فواتيره وتسديداته");
        Dictionary<string, object> al = D(Data("alerts", admin, "{}"));
        ok(A(al["out"]).Count == 0 && A(al["low"]).Count == 0, "التنبيهات: لا شيء نفد");
        Dictionary<string, object> rr = D(Data("report.range", admin, "{\"from\":\"2026-10-26\"}"));
        ok(A(rr["days"]).Count == 1 && (long)D(A(rr["days"])[0])["sales"] == 3, "تقرير اليوم: 3 فواتير بيع", Json.Write(rr));
        List<object> ops = A(Data("ops.page", admin, "{\"limit\":5}"));
        ok(ops.Count == 5 && ((string)D(ops[0])["user"]).Length > 0, "سجل العمليات باسم من فعل");
        Data("setting.set", admin, "{\"key\":\"meta\",\"value\":{\"shopName\":\"مكتبة تجربة\"}}");
        Data("setting.set", admin, "{\"key\":\"sync\",\"value\":{\"key\":\"سر\"}}");
        Dictionary<string, object> info = D(Data("shop.info", admin, "{}"));
        ok((string)D(info["meta"])["shopName"] == "مكتبة تجربة" && !info.ContainsKey("sync"), "shop.info: اسم المحل بلا مفاتيح الربط");
        Dictionary<string, object> h = D(Data("health", admin, "{\"full\":true}"));
        ok((string)h["check"] == "ok" && A(h["problems"]).Count == 0, "health: الفحص الكامل سليم");
        long cs = (long)Data("count.start", admin, "{}");
        Data("count.set", admin, "{\"sessionId\":" + cs + ",\"itemId\":" + item + ",\"counted\":5}");
        ok(A(D(Data("count.current", admin, "{}"))["entries"]).Count == 1, "الجرد: الجلسة المفتوحة وما عُدّ فيها");
        Dictionary<string, object> ca = D(Data("count.apply", admin, "{\"sessionId\":" + cs + "}"));
        ok((long)ca["fixed"] == 1 && db.ShopQty(item) == 5, "تطبيق الجرد عبر الأمر");

        now = now.AddHours(13);
        Call("me", admin, "{}", out st);
        ok(st == 401, "الجلسة تنتهي بعد 12 ساعة بلا استعمال");
        db.Dispose();
        try { File.Delete(path); File.Delete(path + "-wal"); File.Delete(path + "-shm"); } catch { }
    }
}
