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

        /* ---------- الأماكن والمخازن ---------- */
        Dictionary<long, Dictionary<string, object>> sum = new Dictionary<long, Dictionary<string, object>>();
        foreach (object o in A(Data("places.summary", "{}"))) sum[L(D(o)["id"])] = D(o);
        ok(sum.ContainsKey(store) && L(sum[store]["pieces"]) == 4 && L(sum[store]["items"]) == 1, "ملخّص الأماكن: في المخزن 4 قطع من صنف واحد", Json.Write(sum[store]));
        Dictionary<string, object> pi = D(Data("place.items", "{\"placeId\":" + store + "}"));
        ok(L(pi["total"]) == 1 && L(D(A(pi["items"])[0])["placeQty"]) == 4 && (string)D(A(pi["items"])[0])["title"] == "كتاب الجرد", "ما في المخزن: كتاب الجرد × 4", Json.Write(pi));
        long shopQty = L(D(Data("item.get", "{\"id\":" + a + "}"))["qty"]);
        Data("stock.move", "{\"itemId\":" + a + ",\"from\":" + store + ",\"to\":1,\"qty\":3}");
        ok(L(D(A(D(Data("place.items", "{\"placeId\":" + store + "}"))["items"])[0])["placeQty"]) == 1 &&
            L(D(Data("item.get", "{\"id\":" + a + "}"))["qty"]) == shopQty + 3, "النقل من المخزن للمحل: 3 قطع");
        ok(L(D(Data("place.items", "{\"placeId\":1,\"q\":\"كتاب الجرد\"}"))["total"]) >= 1, "والبحث داخل مكان");

        /* ---------- جرد المخزون الفعلي ---------- */
        long sess = L(Data("count.start", "{\"scope\":\"books\"}"));
        Dictionary<string, object> cp0 = D(Data("count.page", "{}"));
        long nBooks = L(cp0["total"]);
        ok(L(cp0["id"]) == sess && L(cp0["done"]) == 0 && L(cp0["shown"]) == nBooks, "الجرد: كل كتب النطاق، لم يُعدّ شيء", Json.Write(cp0["total"]));
        long recA = shopQty + 3;
        ok(L(Data("count.set", "{\"sessionId\":" + sess + ",\"itemId\":" + a + ",\"add\":1}")) == 1, "مسحة: العدد 1");
        ok(L(Data("count.set", "{\"sessionId\":" + sess + ",\"itemId\":" + a + ",\"add\":1}")) == 2, "مسحة ثانية: 2");
        long pen = L(Data("item.add", "{\"kind\":\"stat\",\"title\":\"قلم خارج النطاق\",\"price\":500,\"qty\":3}"));
        string outErr = Error("count.set", "{\"sessionId\":" + sess + ",\"itemId\":" + pen + ",\"add\":1}");
        ok(outErr != null && outErr.Contains("خارج نطاق"), "صنف خارج نطاق الجرد لا يُعدّ", outErr);
        Sale(a, 1, "cash", 0, 0);                            // بيعة أثناء الجرد: لا تُحسب على العدّ
        Dictionary<string, object> cp1 = D(Data("count.page", "{\"show\":\"diff\"}"));
        Dictionary<string, object> row = D(A(cp1["items"])[0]);
        ok(L(cp1["done"]) == 1 && L(row["id"]) == a && L(row["rec"]) == recA && L(row["counted"]) == 2 && L(row["diff"]) == 2 - recA,
            "المسجَّل وقت العدّ لا وقت التصحيح", Json.Write(row));
        ok(L(D(Data("count.page", "{\"q\":\"كتاب له كود\"}"))["shown"]) == 1, "البحث داخل الجرد");
        long rest = L(Data("count.rest", "{\"sessionId\":" + sess + "}"));
        Dictionary<string, object> cp2 = D(Data("count.page", "{}"));
        ok(rest == nBooks - 1 && L(cp2["done"]) == nBooks && L(cp2["less"]) == 1, "«الباقي مطابق»: كل غير المعدود بأمر واحد", rest + " / " + Json.Write(cp2["done"]));
        Dictionary<string, object> ap = D(Data("count.apply", "{\"sessionId\":" + sess + "}"));
        ok(L(ap["fixed"]) == 1 && L(ap["lossQty"]) == recA - 2, "التصحيح: صنف واحد، والنقص بقطعه", Json.Write(ap));
        ok(L(D(Data("item.get", "{\"id\":" + a + "}"))["qty"]) == 1, "الكمية بعد التصحيح: المعدود (2) ناقص ما بيع بعده (1)");
        ok(Data("count.page", "{}") == null, "لا جرد مفتوح بعده");
        List<object> past = A(Data("counts.page", "{}"));
        ok(past.Count == 1 && L(D(past[0])["less"]) == 1 && A(Data("count.get", "{\"id\":" + sess + "}")).Count == 1, "الجرد في السجل بتفاصيل فروقه");

        /* ---------- كتب على المباع ---------- */
        Dictionary<string, object> own = null;
        foreach (object o in A(Data("consignors.list", "{}"))) if (L(D(o)["id"]) == owner) own = D(o);
        ok(own != null && L(own["due"]) == 1000 && L(own["left"]) == 1 && L(own["titles"]) == 1 && L(own["sold"]) == 1 && L(own["myProfit"]) == 1000,
            "أصحاب المباع: بِيع 1 بـ4 لصاحبه، سُدّد 3، المستحق 1، ربحك 1", Json.Write(own));
        Dictionary<string, object> cg = D(Data("consignor.get", "{\"id\":" + owner + "}"));
        long line = L(D(A(cg["lines"])[0])["id"]);
        ok(A(cg["lines"]).Count == 1 && L(D(A(cg["lines"])[0])["left"]) == 1 && A(cg["payments"]).Count == 1, "كشف صاحب البضاعة: الكتاب والتسديد", Json.Write(cg));
        long before = L(D(Data("item.get", "{\"id\":" + b + "}"))["qty"]);
        Data("consign.back", "{\"id\":" + line + ",\"qty\":1}");
        ok(L(D(A(D(Data("consignor.get", "{\"id\":" + owner + "}"))["lines"])[0])["left"]) == 0 &&
            L(D(Data("item.get", "{\"id\":" + b + "}"))["qty"]) == before - 1, "إرجاع النسخة الباقية لصاحبها يخصمها من المخزون");
        Data("consignor.edit", "{\"id\":" + owner + ",\"name\":\"صاحب الأمانة الجديد\",\"phone\":\"0922\"}");
        ok((string)D(Data("consignor.get", "{\"id\":" + owner + "}"))["name"] == "صاحب الأمانة الجديد", "تعديل بيانات صاحب البضاعة");

        /* ---------- الموردون ودور النشر ---------- */
        long sup = L(Data("supplier.add", "{\"name\":\"مكتبة الجملة\",\"city\":\"بنغازي\"}"));
        Data("receive", "{\"supplierId\":" + sup + ",\"lines\":[{\"itemId\":" + a + ",\"qty\":2,\"cost\":5000}]}");
        Dictionary<string, object> sp = null;
        foreach (object o in A(Data("suppliers.page", "{}"))) if (L(D(o)["id"]) == sup) sp = D(o);
        ok(sp != null && L(sp["purchases"]) == 1 && L(sp["total"]) == 10000 && (string)sp["last"] == "2026-10-28", "المورد: إدخال واحد بـ10 وتاريخه", Json.Write(sp));
        Data("publisher.save", "{\"name\":\"دار الاختبار\",\"rateBp\":2000}");
        Data("item.edit", "{\"id\":" + a + ",\"publisher\":\"دار الاختبار\"}");
        Dictionary<string, object> pub = null;
        foreach (object o in A(Data("publishers.list", "{}"))) if ((string)D(o)["name"] == "دار الاختبار") pub = D(o);
        ok(pub != null && L(pub["rateBp"]) == 2000 && L(pub["books"]) == 1, "دار النشر بخصمها وعدد كتبها", Json.Write(pub));

        /* ---------- الراكدة ---------- */
        now = now.AddDays(200);
        T = (string)D(Data("login", "{\"login\":\"admin\",\"password\":\"\"}"))["token"];
        List<object> stale = A(Data("stale", "{\"days\":150}"));
        ok(stale.Count >= 1 && D(stale[0]).ContainsKey("price") && D(stale[0]).ContainsKey("cost"), "الراكدة بعد 200 يوم: بسعرها وسعر شرائها", Json.Write(stale.Count));
        now = now.AddDays(-200);

        /* ---------- الأرباح والتقارير ---------- */
        Dictionary<string, object> tk = D(Data("takings", "{}"));
        Dictionary<string, object> ps = D(Data("profits.summary", "{}"));
        Dictionary<string, object> td = D(ps["today"]);
        ok(L(td["sales"]) == L(tk["total"]) && L(td["profit"]) == L(tk["profit"]) && L(td["n"]) == L(tk["sales"]),
            "ملخص الأرباح: اليوم كجرد اليوم", Json.Write(td));
        List<object> months = A(ps["months"]);
        ok(months.Count == 12 && (string)D(months[11])["key"] == "2026-10" && (string)D(months[0])["key"] == "2025-11" &&
            L(D(months[11])["profit"]) == L(D(ps["month"])["profit"]), "آخر 12 شهراً، وآخرها هذا الشهر", Json.Write(months[11]));
        ok(L(ps["stockCost"]) > 0 && L(ps["stockRetail"]) > L(ps["stockCost"]) && L(ps["debts"]) == L(D(Data("customers.page", "{}"))["totalDebt"]),
            "قيمة المخزون شراءً وبيعاً، والديون", Json.Write(ps["debts"]));
        Dictionary<string, object> rp = D(Data("report.period", "{\"from\":\"2026-10-01\",\"to\":\"2026-10-28\"}"));
        ok(L(rp["total"]) == L(tk["total"]) && L(rp["profit"]) == L(tk["profit"]) && L(rp["n"]) == L(tk["sales"]) &&
            L(rp["returns"]) == L(tk["returns"]) && L(rp["returnsTotal"]) == -L(tk["returnsTotal"]) && A(rp["days"]).Count == 1,
            "تقرير الشهر: كجرد اليوم (كل البيع اليوم)", Json.Write(rp["total"]));
        long soldA = 0;
        foreach (object o in A(tk["sold"])) if ((string)D(o)["name"] == "كتاب الجرد") soldA = L(D(o)["qty"]);
        Dictionary<string, object> top0 = D(A(rp["top"])[0]);
        ok((string)top0["name"] == "كتاب الجرد" && L(top0["qty"]) == soldA && top0.ContainsKey("profit"), "الأكثر مبيعاً بعد خصم الإرجاعات", Json.Write(top0));
        ok(A(D(Data("report.period", "{\"from\":\"2026-11-01\",\"to\":\"2026-11-30\"}"))["days"]).Count == 0, "وفترة بلا بيع فارغة");

        /* ---------- رمز الأرباح (قرار 0024) ---------- */
        string newCode = null;
        api.ProfitLock = delegate { return true; };
        api.ProfitCheck = delegate (string x) { return x == "1234"; };
        api.ProfitSet = delegate (string x) { newCode = x; };
        string T0 = T;
        T = (string)D(Data("login", "{\"login\":\"admin\",\"password\":\"\"}"))["token"];
        Dictionary<string, object> me = D(Data("me", "{}"));
        ok((bool)me["locked"] && (bool)me["lockable"] && !A(me["perms"]).Contains("view_cost") && A(me["perms"]).Contains("reports"),
            "المدير بلا كلمة سر على جهاز له رمز: الأرباح مقفلة", Json.Write(me));
        ok(!D(Data("item.get", "{\"id\":" + a + "}")).ContainsKey("cost") && !D(D(Data("profits.summary", "{}"))["today"]).ContainsKey("profit") &&
            !D(Data("report.period", "{}")).ContainsKey("profit"), "ولا يرى سعر الشراء ولا الأرباح في أي أمر");
        ok(Error("profit.code", "{\"code\":\"9999\"}") != null, "ولا يغيّر الرمز وهو مقفل");
        for (int i = 0; i < 4; i++) ok(Error("profit.unlock", "{\"code\":\"0000\"}") == "الرمز غير صحيح.", "رمز خاطئ " + (i + 1));
        string fifth = Error("profit.unlock", "{\"code\":\"0000\"}");
        string sixth = Error("profit.unlock", "{\"code\":\"1234\"}");
        ok(fifth == "الرمز غير صحيح." && sixth != null && sixth.Contains("محاولات كثيرة"), "بعد 5 محاولات خاطئة: انتظار ولو كان الرمز صحيحاً", sixth);
        now = now.AddMinutes(6);
        me = D(Data("profit.unlock", "{\"code\":\"1234\"}"));
        ok(!(bool)me["locked"] && A(me["perms"]).Contains("view_cost") && D(Data("item.get", "{\"id\":" + a + "}")).ContainsKey("cost"),
            "بعد دقائق، الرمز الصحيح يفتحها: سعر الشراء يظهر", Json.Write(me["locked"]));
        ok(Error("profit.code", "{\"code\":\"12\"}") != null && Data("profit.code", "{\"code\":\" 5678 \"}") == null && newCode == "5678",
            "تغيير الرمز (4 على الأقل)");
        ok((bool)D(Data("profit.lock", "{}"))["locked"] && !D(Data("item.get", "{\"id\":" + a + "}")).ContainsKey("cost"), "«إقفال» يقفلها من جديد");
        Data("user.add", "{\"name\":\"محاسب\",\"login\":\"acc\",\"password\":\"acc-pass-1\",\"perms\":[\"view_cost\",\"reports\"]}");
        string Tacc = (string)D(Data("login", "{\"login\":\"acc\",\"password\":\"acc-pass-1\"}"))["token"];
        string Tkeep = T;
        T = Tacc;
        me = D(Data("me", "{}"));
        ok(!(bool)me["locked"] && !(bool)me["lockable"] && A(me["perms"]).Contains("view_cost"), "من له كلمة سر لا يُسأل عن الرمز", Json.Write(me));
        T = T0;
        ok(!(bool)D(Data("me", "{}"))["locked"], "والجلسة القديمة (قبل الرمز) كما هي");
        api.ProfitLock = null;

        /* ---------- الإشعارات ---------- */
        List<Note> got = new List<Note>();
        api.Notified = delegate (List<Note> l) { got.AddRange(l); };
        ok(Error("notify.set", "{\"server\":\"ntfy.sh\"}") != null, "خادم إشعارات بلا https:// يُرفض");
        Data("notify.set", "{\"enabled\":true,\"topic\":\" shop-x7k \",\"server\":\"https://ntfy.example\",\"bigAmount\":100," +
            "\"kinds\":{\"sale\":true,\"debt\":true,\"pay\":true,\"low\":true,\"out\":true,\"daily\":true}}");
        Dictionary<string, object> nc = D(Data("notify.get", "{}"));
        ok((bool)nc["enabled"] && (string)nc["topic"] == "shop-x7k" && A(nc["log"]).Count == 0, "إعداد الإشعارات يُحفظ", Json.Write(nc));
        long xi = L(Data("item.add", "{\"kind\":\"book\",\"title\":\"صنف التنبيه\",\"price\":10000,\"qty\":3,\"min\":2}"));
        long n1 = L(D(Data("sale", "{\"lines\":[{\"itemId\":" + xi + ",\"qty\":1}]}"))["no"]);
        ok(got.Count == 2 && got[0].Kind == "sale" && got[0].Title == "فاتورة " + n1 + " — 10.00 د.ل" && got[0].Message == "صنف التنبيه ×1" &&
            got[0].Topic == "shop-x7k" && got[0].Server == "https://ntfy.example" &&
            got[1].Kind == "low" && got[1].Title == "قارب على النفاد: صنف التنبيه" && got[1].Message.StartsWith("المتبقي 2 فقط (حد التنبيه 2)"),
            "بيعة: إشعار الفاتورة، و«قارب على النفاد» عند عبور الحد", got.Count > 1 ? got[1].Message : got.Count.ToString());
        got.Clear();
        Sale(xi, 2, "credit", c, 0);
        Note debt = got.Find(delegate (Note q) { return q.Kind == "debt"; }), outN = got.Find(delegate (Note q) { return q.Kind == "out"; });
        long bal = L(D(Data("customer.statement", "{\"id\":" + c + "}"))["balance"]);
        ok(got.Count == 3 && debt != null && debt.Title == "دين جديد: 20.00 د.ل" && debt.Message == "زبون الآجل — إجمالي دينه الآن " + (bal / 1000m).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + " د.ل" &&
            outN != null && outN.Title == "نفد: صنف التنبيه" && outN.Priority == 4, "بيع آجل نفد به الصنف: دين جديد، ونفد", got.Count + " " + (debt != null ? debt.Message : ""));
        got.Clear();
        Data("payment.add", "{\"customerId\":" + c + ",\"amount\":1000}");
        ok(got.Count == 1 && got[0].Kind == "pay" && got[0].Title == "تسديد: 1.00 د.ل" && got[0].Message.StartsWith("زبون الآجل — المتبقي عليه"), "تسديد دين", got.Count == 1 ? got[0].Message : "");
        got.Clear();
        Data("notify.set", "{\"kinds\":{\"bigsale\":true}}");
        long y = L(Data("item.add", "{\"kind\":\"book\",\"title\":\"موسوعة\",\"price\":150000,\"qty\":5}"));
        Sale(a, 1, "cash", 0, 0);
        int small = got.Count;
        Sale(y, 1, "cash", 0, 0);
        ok(small == 0 && got.Count == 1 && got[0].Kind == "bigsale" && got[0].Priority == 4 && got[0].Title == "فاتورة كبيرة: 150.00 د.ل",
            "«فاتورة كبيرة فقط»: 150 فوق 100، لا 10", small + "/" + got.Count);
        got.Clear();
        Data("notify.set", "{\"enabled\":false}");
        Sale(y, 1, "cash", 0, 0);
        ok(got.Count == 0, "موقوفة: لا شيء");
        Note tested = null;
        api.NotifyTest = delegate (Note q) { tested = q; return null; };
        ok(Data("notify.test", "{}") == null && tested != null && tested.Topic == "shop-x7k" && tested.Kind == "test", "إشعار تجريبي بالقناة المحفوظة");
        api.NotifyTest = delegate (Note q) { return "لا يوجد اتصال بالإنترنت"; };
        ok(Error("notify.test", "{\"topic\":\"other\"}") == "تعذّر الإرسال: لا يوجد اتصال بالإنترنت", "وفشله يظهر بسببه");

        /* ملخص آخر اليوم: بعد الساعة المختارة، مرة واحدة */
        Data("notify.set", "{\"enabled\":true,\"kinds\":{\"daily\":true},\"dailyHour\":20}");
        string nday;
        ok(api.DailyNote("", out nday) == null && nday == "2026-10-28", "قبل الثامنة مساءً: لا ملخص");
        DateTime keep = now;
        now = new DateTime(2026, 10, 28, 20, 5, 0);
        Note dn = api.DailyNote("", out nday);
        Dictionary<string, object> tk2 = D(Data("takings", "{}"));
        ok(dn != null && dn.Title == "ملخص اليوم — " + (L(tk2["total"]) / 1000m).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + " د.ل" &&
            dn.Message.StartsWith("عدد الفواتير: " + L(tk2["sales"]) + "\nأصناف تحتاج شراء: ") && !dn.Message.Contains("الربح"),
            "بعد الثامنة: ملخص اليوم بلا الربح", dn != null ? dn.Title + " | " + dn.Message : "null");
        ok(api.DailyNote("2026-10-28", out nday) == null, "ومرة واحدة في اليوم");
        Data("notify.set", "{\"dailyProfit\":true}");
        ok(api.DailyNote("", out nday).Message.Contains("\nالربح: "), "والربح إن اختاره صاحب المحل");
        now = keep;
        api.Notified = null;
        T = Tkeep;

        db.Dispose();
        foreach (string f in new string[] { path, path + "-wal", path + "-shm" })
            try { File.Delete(f); } catch { }
    }
}
