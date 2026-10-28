using System;
using System.Collections.Generic;
using System.IO;
using Qirtasiya.Data;
using Qirtasiya.Engine;

/* شاشات المحل في 4.0: الجرد وإقفال اليوم بحساب 3.x، كشف الزبون، والإرجاع.
   يوم كامل بكل طرق الدفع، والنقد المفروض محسوب باليد هنا:
     داخل الدرج: بيع نقدي 20 + مقدّم آجل 5 + تسديد 7 + آجل مدفوع كله 10 + بيع كتاب أمانة 5 = 47
     خارج منه:   إرجاع نقدي 10 + إرجاع آجل رُدّ نقداً 10 + دُفع لصاحب الأمانة 3 = 23
     النقد المفروض = 24 */
static class ShopTests
{
    static Api api;
    static DateTime now = new DateTime(2026, 10, 28, 10, 0, 0);
    static string T;

    static object Data(string cmd, string body)
    {
        Dictionary<string, object> r = (Dictionary<string, object>)Json.Parse(api.Handle(cmd, T, body).Json);
        if (!(bool)r["ok"]) throw new Exception(cmd + ": " + r["error"]);
        object d;
        r.TryGetValue("data", out d);
        return d;
    }

    static string Error(string cmd, string body)
    {
        Dictionary<string, object> r = (Dictionary<string, object>)Json.Parse(api.Handle(cmd, T, body).Json);
        return (bool)r["ok"] ? null : (string)r["error"];
    }

    static Dictionary<string, object> D(object o) { return (Dictionary<string, object>)o; }
    static List<object> A(object o) { return (List<object>)o; }
    static long L(object o) { return Convert.ToInt64(o); }

    static long Sale(long item, long qty, string method, long customer, long paid)
    {
        string body = "{\"lines\":[{\"itemId\":" + item + ",\"qty\":" + qty + "}],\"method\":\"" + method + "\"" +
            (customer > 0 ? ",\"customerId\":" + customer + ",\"paid\":" + paid : "") + "}";
        return L(D(Data("sale", body))["id"]);
    }

    static Dictionary<string, object> Return(long invoice, long qty)
    {
        Dictionary<string, object> v = D(Data("invoice.get", "{\"id\":" + invoice + "}"));
        long line = L(D(A(v["lines"])[0])["id"]);
        return D(Data("return", "{\"invoiceId\":" + invoice + ",\"lines\":[{\"lineId\":" + line + ",\"qty\":" + qty + "}]}"));
    }

    public static void Run(ImportTests.Check ok)
    {
        string path = Path.Combine(Path.GetTempPath(), "qshop-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".db");
        OpenOptions oo = new OpenOptions();
        oo.Clock = delegate { return now; };
        ShopDb db = ShopDb.Open(path, oo);
        api = new Api(db, delegate { return now; });
        T = (string)D(Data("login", "{\"login\":\"admin\",\"password\":\"\"}"))["token"];

        long a = L(Data("item.add", "{\"kind\":\"book\",\"title\":\"كتاب الجرد\",\"price\":10000,\"cost\":6000,\"qty\":50}"));
        long c = L(Data("customer.add", "{\"name\":\"زبون الآجل\",\"phone\":\"0911111111\"}"));
        long d = L(Data("customer.add", "{\"name\":\"زبون دفع كل شيء\"}"));

        long s1 = Sale(a, 2, "cash", 0, 0);                 // نقد 20
        Sale(a, 1, "card", 0, 0);                            // بطاقة 10
        long s3 = Sale(a, 3, "credit", c, 5000);             // آجل 30، دفع 5، عليه 25
        ok(L(Data("payment.add", "{\"customerId\":" + c + ",\"amount\":7000}")) == 7000, "تسديد 7 من دين 25");
        Dictionary<string, object> r5 = Return(s1, 1);       // إرجاع نقدي: يُردّ 10
        ok(L(r5["cashBack"]) == 10000 && L(r5["debtCut"]) == 0, "إرجاع من بيع نقدي: يُردّ نقداً", Json.Write(r5));
        Dictionary<string, object> r6 = Return(s3, 1);       // إرجاع آجل: ينقص الدين 10
        ok(L(r6["debtCut"]) == 10000 && L(r6["cashBack"]) == 0, "إرجاع من فاتورة آجلة: يُنقص الدين أولاً", Json.Write(r6));
        long sd = Sale(a, 1, "credit", d, 10000);            // آجل دفع كله: مقدّم 10
        Dictionary<string, object> r7 = Return(sd, 1);       // لا دين عليه: يُردّ 10 نقداً
        ok(L(r7["cashBack"]) == 10000, "إرجاع آجل بلا دين: يُردّ نقداً", Json.Write(r7));

        /* كتاب أمانة: يُباع بـ 5 نقداً، ويُدفع لصاحبه 3 من الدرج */
        long owner = L(Data("consign.in", "{\"name\":\"صاحب الأمانة\",\"lines\":[{\"title\":\"كتاب أمانة\",\"qty\":2,\"price\":5000,\"ownerPrice\":4000}]}"));
        long b = L(D(A(D(Data("items.page", "{\"q\":\"كتاب أمانة\",\"limit\":1}"))["items"])[0])["id"]);
        Sale(b, 1, "cash", 0, 0);
        Data("consign.pay", "{\"consignorId\":" + owner + ",\"amount\":3000}");

        /* ---------- الجرد بحساب 3.x ---------- */
        Dictionary<string, object> t = D(Data("takings", "{}"));
        ok(L(t["salesCash"]) == 15000 && L(t["upfront"]) == 15000 && L(t["debtPaid"]) == 7000 &&
            L(t["refundCredit"]) == 10000 && L(t["consOut"]) == 3000, "تفصيل الصندوق: بيع نقدي 15، مقدّم 15، تسديد 7، رُدّ 10، أمانة 3", Json.Write(t));
        ok(L(t["cash"]) == 24000, "النقد المفروض 24 كما حُسب باليد", Json.Write(t["cash"]));
        ok(L(t["card"]) == 10000 && L(t["due"]) == 15000 && L(t["creditTotal"]) == 20000, "البطاقة 10، والآجل غير المقبوض 15 من 20", Json.Write(t));
        ok(L(t["sales"]) == 5 && L(t["returns"]) == 3 && L(t["cntCash"]) == 2 && L(t["cntCard"]) == 1 && L(t["cntCredit"]) == 2,
            "5 فواتير بيع و3 إرجاعات، بعدد كل طريقة دفع", Json.Write(t));
        ok(L(t["pieces"]) == 5 && L(t["total"]) == 45000, "القطع صافية بعد الإرجاع (8 − 3)، والصافي 45", t["pieces"] + " / " + t["total"]);
        List<object> sold = A(t["sold"]);
        ok(sold.Count == 2 && (string)D(sold[0])["name"] == "كتاب الجرد" && L(D(sold[0])["qty"]) == 4 && L(D(sold[0])["profit"]) == 16000,
            "الأصناف المباعة بعد الإرجاعات بربحها", Json.Write(sold));
        ok(t["closing"] == null, "اليوم لم يُقفل بعد");

        /* لوحة اليوم بالرقم نفسه */
        Dictionary<string, object> day = D(A(D(Data("report.range", "{}"))["days"])[0]);
        ok(L(day["cash"]) == 24000 && L(day["card"]) == 10000 && L(day["credit"]) == 15000, "لوحة اليوم: نفس النقد والبطاقة والآجل", Json.Write(day));

        /* ---------- إقفال اليوم: المفروض يحسبه المحرك ---------- */
        Dictionary<string, object> cl = D(Data("day.close", "{\"counted\":23500}"));
        ok(L(cl["expected"]) == 24000 && L(cl["diff"]) == -500, "الإقفال: المفروض 24، عُدّ 23.5، عجز 0.5", Json.Write(cl));
        Data("day.close", "{\"counted\":24000,\"note\":\"وُجدت الورقة\"}");
        Dictionary<string, object> t2 = D(Data("takings", "{}"));
        ok(L(D(t2["closing"])["diff"]) == 0 && (string)D(t2["closing"])["note"] == "وُجدت الورقة", "إعادة الإقفال تحدّثه، لا تكرّره", Json.Write(t2["closing"]));
        Dictionary<string, object> month = D(Data("takings", "{\"from\":\"2026-10-01\",\"to\":\"2026-10-31\"}"));
        ok(L(month["cash"]) == 24000 && !month.ContainsKey("closing"), "جرد الشهر بلا إقفال يوم", Json.Write(month["cash"]));

        /* ---------- الإرجاع: ما أُرجع من كل سطر ---------- */
        Dictionary<string, object> v1 = D(Data("invoice.get", "{\"id\":" + s1 + "}"));
        ok(L(D(A(v1["lines"])[0])["returned"]) == 1 && A(v1["returnsList"]).Count == 1, "الفاتورة تعرف ما أُرجع من سطرها", Json.Write(v1["lines"]));
        Dictionary<string, object> again = Return(s1, 5);
        ok(L(again["total"]) == -10000, "طلب إرجاع أكثر من الباقي: يُرجع الباقي وحده (قطعة)", Json.Write(again));
        ok(Error("return", "{\"invoiceId\":" + s1 + ",\"lines\":[{\"lineId\":" + L(D(A(v1["lines"])[0])["id"]) + ",\"qty\":1}]}") != null,
            "وبعدها لا يُرجع منها شيء");

        /* ---------- الزبائن ---------- */
        Dictionary<string, object> st = D(Data("customer.statement", "{\"id\":" + c + "}"));
        List<object> mv = A(st["moves"]);
        ok(mv.Count == 3 && L(D(mv[0])["balance"]) == 25000 && L(D(mv[1])["balance"]) == 18000 && L(D(mv[2])["balance"]) == 8000,
            "كشف الحساب: فاتورة 25، تسديد 7، إرجاع 10 — الرصيد 8", Json.Write(mv));
        ok((string)D(mv[0])["reason"] == "sale" && L(D(mv[2])["refNo"]) > 0 && L(st["balance"]) == 8000, "وكل حركة بسببها ورقم فاتورتها", Json.Write(mv[2]));
        Dictionary<string, object> cp = D(Data("customers.page", "{}"));
        ok(L(cp["totalDebt"]) == 8000 && L(cp["withDebt"]) == 1 && L(cp["paidMonth"]) == 7000, "صفحة الزبائن: الديون 8 على زبون، تسديدات الشهر 7", Json.Write(cp));
        Dictionary<string, object> first = D(A(cp["customers"])[0]);
        ok((string)first["name"] == "زبون الآجل" && L(first["invoices"]) == 1, "صاحب الدين أولاً، بعدد فواتيره", Json.Write(first));
        ok(Error("customer.delete", "{\"id\":" + c + "}") != null, "زبون عليه دين لا يُحذف");

        /* ---------- إدخال البضاعة ---------- */
        long store = L(Data("place.add", "{\"parentId\":1,\"kind\":\"store\",\"name\":\"المخزن الكبير\"}"));
        long pur = L(Data("receive", "{\"note\":\"فاتورة 77\",\"lines\":[{\"itemId\":" + a + ",\"qty\":10,\"cost\":5500}," +
            "{\"itemId\":" + a + ",\"qty\":4,\"cost\":0,\"placeId\":" + store + "}]}"));
        Dictionary<string, object> pg = D(Data("purchase.get", "{\"id\":" + pur + "}"));
        ok(A(pg["lines"]).Count == 2 && L(pg["total"]) == 55000 && L(D(A(pg["lines"])[1])["placeId"]) == store, "تفاصيل الإدخال: سطران، والثاني للمخزن", Json.Write(pg));
        ok(L(D(Data("item.get", "{\"id\":" + a + "}"))["cost"]) == 5500, "سعر الشراء الجديد يحلّ محل القديم، والصفر لا يمسحه");
        Dictionary<string, object> pp = D(A(Data("purchases.page", "{}"))[0]);
        ok(L(pp["pieces"]) == 14 && L(pp["lines"]) == 2 && pp.ContainsKey("total"), "سجل الإدخالات: القطع والأسطر والتكلفة", Json.Write(pp));
        Data("user.add", "{\"name\":\"أمين المخزن\",\"login\":\"clerk\",\"password\":\"1234\",\"perms\":[\"receive\",\"search\"]}");
        string admin = T;
        T = (string)D(Data("login", "{\"login\":\"clerk\",\"password\":\"1234\"}"))["token"];
        Dictionary<string, object> pc = D(Data("purchase.get", "{\"id\":" + pur + "}"));
        ok(!pc.ContainsKey("total") && !D(A(pc["lines"])[0]).ContainsKey("cost") && !D(A(Data("purchases.page", "{}"))[0]).ContainsKey("total"),
            "ومن لا يرى سعر الشراء لا يرى التكلفة في الإدخالات");
        T = admin;

        /* ---------- اللاصقات ---------- */
        long isbn = L(Data("item.add", "{\"kind\":\"book\",\"title\":\"كتاب عليه ردمك\",\"price\":1000,\"barcode\":\"978-9953-30-507-6\"}"));
        long has = L(Data("item.add", "{\"kind\":\"book\",\"title\":\"كتاب له كود\",\"price\":1000,\"barcode\":\"K-55\"}"));
        Func<string, string, List<long>> ids = delegate (string label, string q)
        {
            List<long> r = new List<long>();
            foreach (object o in A(D(Data("items.page", "{\"label\":\"" + label + "\",\"limit\":500" + (q != null ? ",\"q\":\"" + q + "\"" : "") + "}"))["items"]))
                r.Add(L(D(o)["id"]));
            return r;
        };
        List<long> need = ids("need", null);
        ok(need.Contains(a) && need.Contains(has) && !need.Contains(isbn), "«لم تُطبع»: بلا الكتاب الذي عليه باركود الناشر", string.Join(",", need.ConvertAll(x => x.ToString()).ToArray()));
        ok(ids("printed", null).Contains(isbn) && ids("need", "ردمك").Count == 0 && ids("need", "كتاب له").Contains(has), "باركود الناشر وحده، والبحث داخل الفلتر");
        List<object> made = A(Data("labels.barcodes", "{\"ids\":[" + a + "," + has + "," + isbn + "],\"maxDigits\":8}"));
        string code = made.Count == 1 ? (string)D(made[0])["barcode"] : "";
        ok(made.Count == 1 && L(D(made[0])["id"]) == a && code.Length == 8 && System.Text.RegularExpressions.Regex.IsMatch(code, "^[1-9][0-9]{7}$"),
            "باركود يُولَّد لمن لا باركود له وحده: 8 أرقام", Json.Write(made));
        ok(L(D(Data("item.find", "{\"barcode\":\"" + code + "\"}"))["id"]) == a, "ويُمسح فوراً في البيع");
        ok(A(Data("labels.barcodes", "{\"ids\":[" + a + "]}")).Count == 0, "وما له باركود لا يُمسّ");
        Data("labels.printed", "{\"ids\":[" + a + "," + has + "]}");
        ok(!ids("need", null).Contains(a) && ids("done", null).Contains(a), "بعد الطباعة: تخرج من «لم تُطبع» إلى «طُبعت»");
        Data("labels.unprint", "{\"ids\":[" + has + "]}");
        ok(ids("need", null).Contains(has), "وإرجاع العلامة يعيدها");

        db.Dispose();
        foreach (string f in new string[] { path, path + "-wal", path + "-shm" })
            try { File.Delete(f); } catch { }
    }
}
