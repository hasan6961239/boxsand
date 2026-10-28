using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Qirtasiya.Data;
using Qirtasiya.Engine;

/* المزامنة في القاعدة والمحرك (قرار 0023)، بلا شبكة: جهاز محل وجهاز ثانٍ على
   ملفين، والقطع والأوامر تُنقل بينهما هنا كما ينقلها البرنامج عبر الخادم */
static class SyncTests
{
    static ImportTests.Check ok;
    static DateTime now = new DateTime(2026, 10, 28, 10, 0, 0);

    static Dictionary<string, object> D(object o) { return (Dictionary<string, object>)o; }

    static object Data(Api api, string cmd, string token, string body)
    {
        Dictionary<string, object> r = (Dictionary<string, object>)Json.Parse(api.Handle(cmd, token, body).Json);
        if (!(bool)r["ok"]) throw new Exception(cmd + ": " + r["error"]);
        object d;
        r.TryGetValue("data", out d);
        return d;
    }

    static string Login(Api api)
    {
        return (string)D(Data(api, "login", null, "{\"login\":\"admin\",\"password\":\"\"}"))["token"];
    }

    /* قطع السجل كلها من جهاز المحل للجهاز الثاني، كما تفعل حلقة المزامنة */
    static int Pull(ShopDb main, ShopDb second, int maxRows)
    {
        int chunks = 0;
        while (true)
        {
            long after = second.LocalLong("sync.applied", -1);
            long from, to;
            string json = main.LogChunk(after, maxRows, 100000, out from, out to);
            if (json == null) return chunks;
            /* عبر الخادم: مضغوطاً ونصاً */
            second.ApplyRemote(ShopDb.ParseChunk(ShopDb.Unpack(ShopDb.Pack(json))), to);
            chunks++;
        }
    }

    /* محتوى الجداول المسجَّلة صفاً صفاً: الجهازان سواء */
    static string Dump(ShopDb d)
    {
        return d.Read<string>(delegate (Sqlite c)
        {
            StringBuilder sb = new StringBuilder();
            foreach (string t in Schema.LoggedTables(c))
            {
                sb.Append('#').Append(t).Append('\n');
                foreach (object[] r in c.Rows("SELECT * FROM \"" + t + "\" ORDER BY id"))
                {
                    for (int i = 0; i < r.Length; i++) sb.Append(Convert.ToString(r[i])).Append('|');
                    sb.Append('\n');
                }
            }
            return sb.ToString();
        });
    }

    public static void Run(ImportTests.Check check)
    {
        ok = check;
        string dir = Path.Combine(Path.GetTempPath(), "qsync-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        Directory.CreateDirectory(dir);
        OpenOptions oo = new OpenOptions();
        oo.Clock = delegate { return now; };
        ShopDb main = ShopDb.Open(Path.Combine(dir, "main.db"), oo);
        Api mainApi = new Api(main, delegate { return now; });
        string ma = Login(mainApi);
        main.SetSetting("branch", "{\"id\":\"misrata\",\"name\":\"دار الحكمة\",\"city\":\"مصراتة\",\"no\":1}", 1);
        long shelf = main.AddPlace(1, "shelf", "رف 1", "1", 1);
        long book = (long)Data(mainApi, "item.add", ma, "{\"title\":\"الفيزياء الأساسية\",\"author\":\"عبد الله السويحلي\",\"price\":30000,\"homePlaceId\":" + shelf + ",\"qty\":10,\"barcode\":\"9789953305076\"}");
        Data(mainApi, "sale", ma, "{\"lines\":[{\"itemId\":" + book + ",\"qty\":2}]}");

        /* ---------- نسخة التجربة لا تُربط بالخادم الحقيقي (قرار 0014) ---------- */
        ok(SyncClient.LocalUrl("http://127.0.0.1:8787") && SyncClient.LocalUrl("http://localhost:9000/") &&
            !SyncClient.LocalUrl("https://maktaba-sync.x.workers.dev") && !SyncClient.LocalUrl("") && !SyncClient.LocalUrl("127.0.0.1"),
            "خادم على الجهاز نفسه يُعرف من عنوانه");
        ok(!SyncClient.DemoBlocked(main, "https://maktaba-sync.x.workers.dev"), "القاعدة الحقيقية تُربط بالخادم الحقيقي");
        main.SetSetting("demo", "true", 1);
        ok(SyncClient.DemoBlocked(main, "https://maktaba-sync.x.workers.dev") && !SyncClient.DemoBlocked(main, "http://127.0.0.1:8787"),
            "ونسخة التجربة بخادم تجربة على الجهاز وحده");
        main.SetSetting("demo", "false", 1);

        /* ---------- النسخة الكاملة ← الجهاز الثاني ---------- */
        string snap = Path.Combine(dir, "snap.db");
        main.SnapshotTo(snap);
        long snapSeq = ShopDb.CheckSnapshotFile(snap, "misrata");
        ok(snapSeq == main.LogSeq() && snapSeq > 0, "النسخة الكاملة تعرف آخر رقم في سجلها", snapSeq + " / " + main.LogSeq());
        bool wrong = false;
        try { ShopDb.CheckSnapshotFile(snap, "tripoli"); }
        catch (ShopException) { wrong = true; }
        ok(wrong, "ونسخة فرع آخر تُرفض");
        File.Copy(snap, Path.Combine(dir, "second.db"));
        ShopDb second = ShopDb.Open(Path.Combine(dir, "second.db"), oo);
        Dictionary<string, string> st = new Dictionary<string, string>();
        st["sync.role"] = "second"; st["sync.device"] = "dev2abcdef"; st["sync.applied"] = snapSeq.ToString();
        second.SetLocals(st);
        ok(second.Replica && !main.Replica, "الجهاز الثاني يعرف أنه ثانٍ");
        Api secApi = new Api(second, delegate { return now; });

        /* ---------- السجل: جهاز المحل ← الجهاز الثاني ---------- */
        long cust = (long)Data(mainApi, "customer.add", ma, "{\"name\":\"محمد\",\"phone\":\"091\"}");
        long book2 = (long)Data(mainApi, "item.add", ma, "{\"title\":\"مدخل إلى الكيمياء\",\"price\":25000,\"qty\":5}");
        Data(mainApi, "sale", ma, "{\"lines\":[{\"itemId\":" + book + ",\"qty\":1},{\"itemId\":" + book2 + ",\"qty\":2}],\"method\":\"credit\",\"customerId\":" + cust + ",\"paid\":0}");
        Data(mainApi, "item.edit", ma, "{\"id\":" + book2 + ",\"title\":\"مدخل إلى الكيمياء العامة\",\"price\":26000}");
        int chunks = Pull(main, second, 4);
        ok(chunks > 1, "السجل يصل قطعاً صغيرة (" + chunks + " قطع)");
        ok(Dump(main) == Dump(second), "بعدها: الجهاز الثاني مثل جهاز المحل صفاً صفاً");
        ok(second.FullCheck().Count == 0, "وفحصه الكامل سليم (الكميات من حركاتها، والفهرس)", string.Join("؛ ", second.FullCheck().ToArray()));
        string sa = Login(secApi);
        Dictionary<string, object> found = D(Data(secApi, "search", sa, "{\"q\":\"الكيمياء العامه\",\"limit\":5}"));
        List<object> fi = (List<object>)found["items"];
        ok(fi.Count > 0 && (string)D(fi[0])["title"] == "مدخل إلى الكيمياء العامة", "والبحث فيه يجد الاسم الجديد بعد التعديل", fi.Count);
        ok(Pull(main, second, 4) == 0, "ولا شيء يُطبَّق مرتين", "");

        /* ---------- الجهاز الثاني لا يكتب بنفسه ---------- */
        long opsBefore = second.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM ops", 0); });
        Login(secApi);
        long opsAfter = second.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM ops", 0); });
        ok(opsBefore == opsAfter, "الدخول على الجهاز الثاني لا يكتب شيئاً", opsBefore + " → " + opsAfter);
        bool blocked = false;
        try { second.AddPlace(1, "shelf", "رف", "", 1); }
        catch (ReplicaWriteException) { blocked = true; }
        ok(blocked, "أي كتابة مباشرة في قاعدته ترفض");
        Dictionary<string, object> q1 = D(Data(secApi, "item.add", sa, "{\"title\":\"كتاب من جهازي\",\"price\":15000,\"qty\":3,\"barcode\":\"111222333\"}"));
        ok((bool)q1["queued"] && (long)q1["n"] == 1 && ((string)q1["label"]).Contains("كتاب من جهازي"), "إضافة كتاب منه تنتظر جهاز المحل بوصفها", q1);
        Dictionary<string, object> q2 = D(Data(secApi, "sale", sa, "{\"lines\":[{\"itemId\":" + book + ",\"qty\":1}]}"));
        Dictionary<string, object> q3 = D(Data(secApi, "item.add", sa, "{\"title\":\"باركود مكرر\",\"price\":1000,\"barcode\":\"9789953305076\"}"));
        ok((bool)q2["queued"] && (long)q2["n"] == 2 && ((string)q2["label"]).StartsWith("بيعة") && (bool)q3["queued"] && (long)q3["n"] == 3,
            "والبيعة والصنف الثاني ينتظران بأرقامهما", new object[] { q2, q3 });
        List<ShopDb.OutboxRow> unsent = second.OutboxUnsent();
        ok(unsent.Count == 3 && unsent[1].Cmd == "sale" && unsent[1].Body.Contains("\"at\":\"2026-10-28 10:00:00\""), "البيعة تنتظر بوقتها هنا", unsent.Count);
        ok(Dump(main) == Dump(second), "وقاعدة الجهاز الثاني لم تتغيّر");
        List<Dictionary<string, object>> view = second.OutboxView();
        ok(view.Count == 3 && (string)view[0]["state"] == "waiting", "قائمة المنتظر: 3 تنتظر", view.Count);

        /* ---------- جهاز المحل ينفّذها، كل أمر مرة واحدة ---------- */
        long sid = 100;
        foreach (ShopDb.OutboxRow o in unsent)
        {
            second.OutboxSent(o.N, ++sid);
            string data = "{\"user\":" + o.UserId + ",\"cmd\":" + Json.Write(o.Cmd) + ",\"body\":" + o.Body + "}";
            string err = mainApi.ExecRemote(sid, "dev2abcdef", "جهازي", o.N, data);
            if (o.N == 3) ok(err != null && err.Contains("الباركود"), "الباركود المكرر يُرفض عند جهاز المحل بسببه", err);
            else ok(err == null, "نُفّذ: " + o.Label, err);
        }
        long added = main.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM items WHERE title = 'كتاب من جهازي'", 0); });
        ok(added == 1, "الكتاب صار عند جهاز المحل", added);
        /* كأن الكهرباء انقطعت قبل حفظ «آخر أمر نُفّذ»: الأوامر تُعاد */
        sid = 100;
        foreach (ShopDb.OutboxRow o in unsent)
        {
            string data = "{\"user\":" + o.UserId + ",\"cmd\":" + Json.Write(o.Cmd) + ",\"body\":" + o.Body + "}";
            mainApi.ExecRemote(++sid, "dev2abcdef", "جهازي", o.N, data);
        }
        added = main.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM items WHERE title = 'كتاب من جهازي'", 0); });
        long sales = main.Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM invoices", 0); });
        ok(added == 1 && sales == 3, "إعادتها لا تكرّر الكتاب ولا البيعة", added + " / " + sales);
        string saleAt = main.Read<string>(delegate (Sqlite c) { return c.Text("SELECT at FROM invoices ORDER BY id DESC LIMIT 1"); });
        ok(saleAt == "2026-10-28 10:00:00", "البيعة سُجّلت بوقتها على الجهاز الثاني", saleAt);
        string dev = main.Read<string>(delegate (Sqlite c) { return c.Text("SELECT device FROM ops WHERE kind = 'item-add' ORDER BY id DESC LIMIT 1"); });
        ok(dev != null && dev.Contains("جهازي"), "وسجل العمليات يقول إنها من الجهاز الثاني", dev);

        Pull(main, second, 50);
        ok(Dump(main) == Dump(second), "بعد السجل: الجهاز الثاني فيه ما أضافه مثل جهاز المحل");
        view = second.OutboxView();
        ok(view.Count == 3 && (string)view[0]["state"] == "done" && (string)view[2]["state"] == "failed" && ((string)view[2]["error"]).Contains("الباركود"),
            "قائمة المنتظر: نُفّذ اثنان، ورُفض واحد بسببه", Json.Write(view));
        second.OutboxDismiss(3);
        ok(second.OutboxView().Count == 2, "المرفوض يُزال من القائمة بعد قراءته");
        Data(secApi, "item.add", sa, "{\"title\":\"ينتظر\",\"price\":1000}");
        bool keep = false;
        try { second.OutboxDismiss(4); }
        catch (ShopException) { keep = true; }
        ok(keep, "والمنتظر لا يُزال: جهاز المحل سينفّذه");

        /* ---------- صلاحيات صاحب الأمر عند جهاز المحل ---------- */
        long staff = (long)Data(mainApi, "user.add", ma, "{\"name\":\"سالم\",\"login\":\"salem\",\"password\":\"1234\"}");
        string err2 = mainApi.ExecRemote(500, "dev2abcdef", "جهازي", 50, "{\"user\":" + staff + ",\"cmd\":\"item.delete\",\"body\":{\"id\":" + book + "}}");
        ok(err2 != null && err2.Contains("صلاحية"), "أمر بلا صلاحية صاحبه عند جهاز المحل يُرفض", err2);
        string err3 = mainApi.ExecRemote(501, "dev2abcdef", "جهازي", 51, "{oops");
        ok(err3 != null, "وأمر غير مفهوم يُرفض ولا يوقف ما بعده", err3);

        /* ---------- قائمة كتب الفرع للفروع الأخرى ---------- */
        int count;
        string cat = main.CatalogJson(out count);
        /* الفيزياء والكيمياء وكتاب الجهاز الثاني (المكرر رُفض، و«ينتظر» لم يصل بعد) */
        ok(count == 3 && cat.Contains("\"id\":\"misrata\""), "قائمة كتب مصراتة: 3 أصناف ومعها الفرع", count);
        ShopDb trip = ShopDb.Open(Path.Combine(dir, "tripoli.db"), oo);
        int got = trip.SetRemoteCatalog("misrata", "دار الحكمة", "مصراتة", "ver000000001", 123, ShopDb.Unpack(ShopDb.Pack(cat)));
        ok(got == 3, "طرابلس تحفظها", got);
        List<Dictionary<string, object>> rs = trip.SearchRemote("الفيزياء الاساسيه", null, 10);
        ok(rs.Count == 1 && (string)rs[0]["branchName"] == "دار الحكمة" && (long)rs[0]["qty"] == 6 && (long)rs[0]["price"] == 30000 &&
            ((string)rs[0]["place"]).Contains("رف 1"), "والبحث فيها بلا همزة: الفرع والكمية (6) والسعر والمكان", rs.Count > 0 ? Json.Write(rs[0]) : "");
        rs = trip.SearchRemote("السويحلي", null, 10);
        ok(rs.Count == 1, "وبالمؤلف", rs.Count);
        rs = trip.SearchRemote("9789953305076", null, 10);
        ok(rs.Count == 1, "وبالباركود", rs.Count);
        ok(trip.SearchRemote("كتاب غير موجود أبداً", null, 10).Count == 0, "وما ليس عندهم لا يظهر");
        List<Dictionary<string, object>> bl = trip.RemoteBranches();
        ok(bl.Count == 1 && (long)bl[0]["items"] == 3 && (string)bl[0]["city"] == "مصراتة", "قائمة الفروع المرتبطة", Json.Write(bl));
        trip.SetRemoteCatalog("misrata", "دار الحكمة", "مصراتة", "ver000000002", 124, cat.Replace("الفيزياء الأساسية", "الفيزياء الحديثة"));
        ok(trip.SearchRemote("الاساسيه", null, 10).Count == 0 && trip.SearchRemote("الحديثه", null, 10).Count == 1, "قائمة جديدة تحلّ محل القديمة كلها");

        /* ---------- الأوامر الكبيرة لا تُقطع في وسطها ---------- */
        long from, to;
        string big = main.LogChunk(0, 3, 100000, out from, out to);
        List<SyncRow> rows = ShopDb.ParseChunk(big);
        long lastOp = main.Read<long>(delegate (Sqlite c) { return c.Long("SELECT op_id FROM change_log WHERE seq = ?", 0, to); });
        long nextOp = main.Read<long>(delegate (Sqlite c) { return c.Long("SELECT op_id FROM change_log WHERE seq = ?", -1, to + 1); });
        ok(rows.Count >= 3 && lastOp != nextOp, "القطعة تنتهي بآخر صف من أمرها", rows.Count + " صف");

        main.Dispose(); second.Dispose(); trip.Dispose();
        try { Directory.Delete(dir, true); }
        catch { }
    }
}
