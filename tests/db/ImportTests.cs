using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Qirtasiya.Data;

/* ============================================================
   نقل بيانات 3.x: ملف صغير مكتوب باليد فيه كل حالة صعبة نعرفها
   ------------------------------------------------------------
     DbTests.exe import <store.json> [قاعدة.db]
   ينقل ملفاً حقيقياً ويطبع تقرير المطابقة (لنسخة المحل الحقيقية:
   محلياً فقط، قرار 0013).
   ============================================================ */
static class ImportTests
{
    /* بأسماء صناعية. كل سطر فيه حالة: باركود مكرر، رمز مكرر، رمز فارغ،
       كمية سالبة، غرفة خزين أكبر من الكمية، خزانة غير موجودة في القائمة،
       مخزن فيه صنف محذوف، إرجاع قديم بلا debtCut، إرجاع أصله مؤرشف، سطر
       بكمية صفر، رقم فاتورة مكرر، تسديد لزبون محذوف، جرد مفتوح... */
    public const string Store = @"{
 ""meta"": {""shopName"": ""مكتبة تجربة"", ""libraries"": [""A"", ""B""], ""shelves"": 3,
   ""bookCats"": [""علوم"", ""روايات"", ""علوم""], ""statCats"": [""أقلام""], ""units"": [""قطعة""], ""theme"": ""green""},
 ""branch"": {""id"": ""misrata-test"", ""name"": ""مصراتة تجربة"", ""no"": 1},
 ""sync"": {""url"": """", ""key"": """"},
 ""notify"": {""enabled"": false},
 ""phoneDone"": {""ph-1"": 3},
 ""futureThing"": {""x"": 1},
 ""publishers"": [{""id"": ""pb1"", ""name"": ""دار التجربة"", ""rate"": 0.2}],
 ""suppliers"": [{""id"": ""sp1"", ""name"": ""مورّد تجربة"", ""phone"": ""0900000001""}],
 ""books"": [
  {""id"": ""b1"", ""code"": ""K0001"", ""title"": ""الفيزياء الأساسية"", ""author"": ""د. تجربة"", ""publisher"": ""دار التجربة"",
   ""supplierId"": ""sp1"", ""lib"": ""A"", ""shelf"": ""2"", ""cat"": ""علوم"", ""catFull"": ""علوم / فيزياء"", ""barcode"": ""9789953000011"",
   ""cost"": 30, ""price"": 45.5, ""priceW"": 40, ""qty"": 10, ""store"": 4, ""min"": 2, ""note"": """",
   ""created"": ""2026-01-05 10:30"", ""updated"": ""2026-02-01 11:00"", ""labelPrinted"": ""2026-01-06"", ""lastSold"": ""2026-03-01"", ""soldTotal"": 7},
  {""id"": ""b2"", ""code"": ""K0002"", ""title"": ""رواية تجربة"", ""lib"": ""Z"", ""shelf"": ""9"", ""cat"": ""روايات"", ""barcode"": ""9789953000011"",
   ""cost"": 10, ""price"": 0, ""qty"": -2, ""min"": 0, ""created"": ""2026-01-05 10:31""},
  {""id"": ""b3"", ""code"": ""K0001"", ""title"": ""كتاب برمز مكرر"", ""lib"": ""B"", ""shelf"": ""1"", ""cat"": """", ""barcode"": """",
   ""cost"": 5, ""price"": 8, ""qty"": 3, ""store"": 9, ""min"": 0},
  {""id"": ""b4"", ""code"": """", ""title"": ""كتاب بلا رمز"", ""lib"": """", ""shelf"": """", ""cat"": ""علوم"", ""cost"": 1.25, ""price"": 2.5, ""qty"": 1}
 ],
 ""stationery"": [
  {""id"": ""s1"", ""code"": ""Q0001"", ""name"": ""قلم تجربة"", ""brand"": ""ماركة"", ""unit"": ""قطعة"", ""loc"": ""الدرج 2"", ""cat"": ""أقلام"",
   ""barcode"": ""6000000000017"", ""cost"": 0.5, ""price"": 0.75, ""priceW"": 0.6, ""qty"": 100, ""min"": 10}
 ],
 ""warehouses"": [{""id"": ""w1"", ""name"": ""مخزن السوق"", ""place"": ""السوق"", ""phone"": """", ""note"": """",
   ""stock"": [{""type"": ""book"", ""itemId"": ""b1"", ""qty"": 20}, {""type"": ""book"", ""itemId"": ""gone"", ""qty"": 5}]}],
 ""customers"": [
  {""id"": ""c1"", ""name"": ""زبون أول"", ""phone"": ""0900000002"", ""balance"": 75.5, ""note"": """", ""created"": ""2026-01-10 09:00""},
  {""id"": ""c2"", ""name"": ""زبون ثانٍ"", ""phone"": """", ""balance"": 0}
 ],
 ""invoices"": [
  {""id"": ""i6"", ""no"": 6, ""kind"": ""return"", ""refNo"": 99, ""date"": ""2026-03-04"", ""at"": ""2026-03-04 12:00"",
   ""items"": [{""type"": ""book"", ""id"": ""b1"", ""name"": ""الفيزياء الأساسية"", ""qty"": 1, ""price"": 45.5, ""cost"": 30}],
   ""subtotal"": -45.5, ""discount"": 0, ""total"": -45.5, ""profit"": -15.5, ""method"": ""cash"", ""customerId"": """", ""paid"": -45.5, ""due"": 0,
   ""cashBack"": 45.5, ""debtCut"": 0},
  {""id"": ""i5"", ""no"": 5, ""kind"": ""return"", ""refNo"": 2, ""date"": ""2026-03-03"", ""at"": ""2026-03-03 12:00"",
   ""items"": [{""type"": ""book"", ""id"": ""b1"", ""name"": ""الفيزياء الأساسية"", ""qty"": 1, ""price"": 45.5, ""cost"": 30}],
   ""subtotal"": -45.5, ""discount"": 0, ""total"": -45.5, ""profit"": -15.5, ""method"": ""credit"", ""customerId"": ""c1"", ""paid"": 0, ""due"": 0},
  {""id"": ""i4"", ""no"": 4, ""kind"": ""sale"", ""date"": ""2026-03-02"", ""at"": ""2026-03-02 10:00"",
   ""items"": [{""type"": ""stat"", ""id"": ""s1"", ""name"": ""قلم تجربة"", ""qty"": 0, ""price"": 0.75, ""cost"": 0.5}],
   ""subtotal"": 0, ""discount"": 0, ""total"": 0, ""profit"": 0, ""method"": ""cash"", ""customerId"": """", ""paid"": 0, ""due"": 0},
  {""id"": ""i3b"", ""no"": 3, ""kind"": ""sale"", ""date"": ""2026-03-01"", ""at"": ""2026-03-01 18:00"",
   ""items"": [{""type"": ""stat"", ""id"": ""s1"", ""name"": ""قلم تجربة"", ""qty"": 2, ""price"": 0.75, ""cost"": 0.5}],
   ""subtotal"": 1.5, ""discount"": 0, ""total"": 1.5, ""profit"": 0.5, ""method"": ""cash"", ""customerId"": """", ""paid"": 1.5, ""due"": 0,
   ""source"": ""phone"", ""device"": ""تلفون تجربة"", ""phoneId"": ""ph-1""},
  {""id"": ""i3"", ""no"": 3, ""kind"": ""sale"", ""date"": ""2026-03-01"", ""at"": ""2026-03-01 09:00"",
   ""items"": [{""type"": ""book"", ""id"": ""deleted-book"", ""name"": ""كتاب حُذف"", ""qty"": 1, ""price"": 20, ""cost"": 12}],
   ""subtotal"": 20, ""discount"": 0, ""total"": 20, ""profit"": 8, ""method"": ""card"", ""customerId"": """", ""paid"": 20, ""due"": 0},
  {""id"": ""i2"", ""no"": 2, ""kind"": ""sale"", ""mode"": ""retail"", ""date"": ""2026-02-20"", ""at"": ""2026-02-20 10:00"",
   ""items"": [{""type"": ""book"", ""id"": ""b1"", ""name"": ""الفيزياء الأساسية"", ""qty"": 2, ""price"": 45.5, ""cost"": 30}],
   ""subtotal"": 91, ""discount"": 1, ""total"": 90, ""profit"": 29, ""method"": ""credit"", ""customerId"": ""c1"", ""paid"": 0, ""due"": 90},
  {""id"": ""i1"", ""no"": 1, ""kind"": ""sale"", ""date"": ""2026-02-01"", ""at"": ""2026-02-01 09:15"",
   ""items"": [{""type"": ""book"", ""id"": ""b1"", ""name"": ""الفيزياء الأساسية"", ""qty"": 1, ""price"": 45.5, ""cost"": 30},
              {""type"": ""stat"", ""id"": ""s1"", ""name"": ""قلم تجربة"", ""qty"": 3, ""price"": 0.75, ""cost"": 0.5}],
   ""subtotal"": 47.75, ""discount"": 0, ""total"": 47.75, ""profit"": 16.25, ""method"": ""cash"", ""customerId"": """", ""paid"": 47.75, ""due"": 0,
   ""editedAt"": ""2026-02-01 09:20""}
 ],
 ""payments"": [
  {""id"": ""y1"", ""customerId"": ""c1"", ""amount"": 14.5, ""date"": ""2026-02-25"", ""at"": ""2026-02-25 12:00"", ""note"": """"},
  {""id"": ""y2"", ""customerId"": ""gone"", ""amount"": 5, ""date"": ""2026-02-26"", ""at"": ""2026-02-26 12:00"", ""note"": """"}
 ],
 ""purchases"": [{""id"": ""pu1"", ""date"": ""2026-01-20"", ""supplierId"": ""sp1"", ""note"": """", ""total"": 300, ""at"": ""2026-01-20 13:00"",
   ""lines"": [{""type"": ""book"", ""id"": ""b1"", ""name"": ""الفيزياء الأساسية"", ""qty"": 10, ""cost"": 30, ""st"": 4}]}],
 ""consignors"": [{""id"": ""o1"", ""name"": ""صاحب كتب"", ""phone"": """", ""note"": """", ""at"": ""2026-01-15 10:00""}],
 ""consignments"": [{""id"": ""cs1"", ""ownerId"": ""o1"", ""itemId"": ""b4"", ""type"": ""book"", ""title"": ""كتاب بلا رمز"", ""author"": """",
   ""code"": """", ""qty"": 3, ""sold"": 2, ""returned"": 0, ""price"": 2.5, ""ownerPrice"": 2, ""at"": ""2026-01-15"", ""note"": """"}],
 ""consPayments"": [{""id"": ""cp1"", ""ownerId"": ""o1"", ""amount"": 1.5, ""date"": ""2026-02-01"", ""at"": ""2026-02-01 10:00"", ""note"": """", ""fromDrawer"": false}],
 ""closings"": [{""id"": ""cl1"", ""date"": ""2026-02-01"", ""kind"": ""day"", ""expected"": 47.75, ""counted"": 47, ""diff"": -0.75, ""at"": ""2026-02-01 21:00""}],
 ""counts"": [{""id"": ""ct1"", ""at"": ""2026-01-31 08:00"", ""doneAt"": ""2026-01-31 12:00"", ""scope"": ""all"", ""total"": 5, ""done"": 2, ""ok"": 1,
   ""less"": 1, ""more"": 0, ""lossQty"": 1, ""lossVal"": 30, ""lines"": [{""name"": ""الفيزياء الأساسية"", ""rec"": 11, ""got"": 10, ""diff"": -1, ""cost"": 30}]}],
 ""countSession"": {""id"": ""cs-open"", ""at"": ""2026-03-05 09:00"", ""scope"": ""lib"", ""lib"": ""A"", ""counted"": {""b1"": 9, ""nothing"": 1}, ""base"": {""b1"": 10}, ""n"": 1},
 ""outbox"": [{""id"": ""m1"", ""kind"": ""req"", ""to"": ""tripoli-test"", ""from"": ""misrata-test"", ""note"": """",
   ""lines"": [{""n"": ""الفيزياء الأساسية"", ""b"": ""9789953000011"", ""qty"": 2}], ""at"": ""2026-03-01 10:00""}],
 ""remotes"": [{""id"": ""tripoli-test"", ""items"": []}],
 ""log"": [
  {""id"": ""l3"", ""at"": ""2026-03-02 10:00"", ""action"": ""بيع"", ""detail"": ""فاتورة 2""},
  {""id"": ""l2"", ""at"": ""2026-02-01 09:15"", ""action"": ""بيع"", ""detail"": ""فاتورة 1""},
  {""id"": ""l1"", ""at"": ""2026-01-05 10:30"", ""action"": ""إضافة كتاب"", ""detail"": ""الفيزياء الأساسية""}
 ],
 ""counters"": {""invoice"": 6, ""book"": 3, ""stat"": 1}
}";

    public delegate void Check(bool cond, string name, object detail = null);

    public static void Run(Check ok)
    {
        string path = Path.Combine(Path.GetTempPath(), "qimport-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".db");
        ShopDb d = ShopDb.Open(path, null);
        ImportReport r = d.Import3x(Store, 1);
        Func<string, long> L = delegate (string sql) { return d.Read<long>(delegate (Sqlite c) { return c.Long(sql, 0); }); };
        Func<string, string> S = delegate (string sql) { return d.Read<string>(delegate (Sqlite c) { return c.Text(sql); }); };
        Func<string, bool> Warned = delegate (string w) { foreach (string x in r.Warnings) if (x.Contains(w)) return true; return false; };

        ok(d.FullCheck().Count == 0, "القاعدة بعد النقل سليمة (الفحص الكامل)", string.Join("؛ ", d.FullCheck().ToArray()));
        /* ثلاثة فروق مقصودة، وكل واحد له تنبيه: التقرير يقولها ولا يخفيها */
        Dictionary<string, string> diff = new Dictionary<string, string>();
        diff["النسخ في المخازن"] = "25 ← 20";                 // 5 قطع لصنف محذوف
        diff["فواتير البيع"] = "5 ← 4";                        // فاتورة 4 كل أسطرها بكمية صفر
        diff["تسديدات الديون"] = "2 بـ 19.5 ← 1 بـ 14.5";      // تسديد لزبون محذوف
        foreach (ImportReport.Row row in r.Rows)
        {
            if (diff.ContainsKey(row.Name))
                ok(!row.Ok && row.Source + " ← " + row.Db == diff[row.Name], "التقرير يُظهر الفرق المقصود في " + row.Name + ": " + diff[row.Name], row.Source + " ← " + row.Db);
            else ok(row.Ok, "مطابقة: " + row.Name + " = " + row.Source, row.Db);
        }
        ok(!r.AllOk, "والتقرير كله «غير مطابق» بسببها، فلا تمرّ بصمت");
        ok(L("SELECT COUNT(*) FROM places WHERE kind = 'cabinet'") == 3 && L("SELECT COUNT(*) FROM places WHERE kind = 'shelf'") == 7,
            "الخزائن من الإعدادات (A وB × 3 رفوف) وخزانة Z التي لم تكن فيها برفّها", L("SELECT COUNT(*) FROM places WHERE kind = 'shelf'"));
        long b1 = L("SELECT id FROM items WHERE old_id = 'b1'");
        ItemRow it = d.GetItem(b1);
        ok(it.Price == 45500 && it.PriceW == 40000 && it.Cost == 30000, "الأسعار بالدرهم: 45.5 ← 45500");
        ok(it.LabelPrinted == "2026-01-06" && it.LastSold == "2026-03-01" && it.SoldTotal == 7 && it.CreatedAt == "2026-01-05 10:30:00",
            "تاريخ اللاصقة وآخر بيع ومجموع المبيع وتاريخ الإضافة", it.CreatedAt);
        ok(S("SELECT p.code || '/' || s.code FROM items i JOIN places s ON s.id = i.home_place_id JOIN places p ON p.id = s.parent_id WHERE i.id = " + b1) == "A/2",
            "مكان الكتاب: خزانة A رف 2");
        Dictionary<long, long> st = d.StockOf(b1);
        long room = L("SELECT id FROM places WHERE kind = 'room'"), wh = L("SELECT id FROM places WHERE kind = 'store'");
        ok(st[room] == 4 && st[it.HomePlaceId] == 6 && st[wh] == 20, "10 نسخ: 6 على الرف و4 في غرفة الخزين، و20 في مخزن السوق");
        ok(d.GetItem(L("SELECT id FROM items WHERE old_id = 'b2'")).Barcode == "" && Warned("مكرر: بقي على «الفيزياء الأساسية»"),
            "الباركود المكرر بقي على الأول، والتنبيه يذكر الكتابين");
        ok(d.ShopQty(L("SELECT id FROM items WHERE old_id = 'b2'")) == -2, "الكمية السالبة تبقى كما هي (-2)");
        ok(d.GetItem(L("SELECT id FROM items WHERE old_id = 'b2'")).Price == 0, "السعر الصفر يبقى صفراً");
        long b3 = L("SELECT id FROM items WHERE old_id = 'b3'");
        ok(d.GetItem(b3).Code != "K0001" && Warned("الرمز K0001 مكرر"), "الرمز المكرر يأخذ رمزاً جديداً بتنبيه", d.GetItem(b3).Code);
        ok(d.StockOf(b3)[room] == 3 && d.ShopQty(b3) == 3, "غرفة الخزين لا تزيد على الكمية (9 ← 3)");
        ok(d.GetItem(b3).Code == "K0004" && d.GetItem(L("SELECT id FROM items WHERE old_id = 'b4'")).Code == "K0005",
            "الرموز الجديدة بعد آخر رمز في الملف: المكرر K0004، والذي بلا رمز K0005");
        ok(S("SELECT loc_note FROM items WHERE old_id = 's1'") == "الدرج 2" && S("SELECT brand FROM items WHERE old_id = 's1'") == "ماركة",
            "القرطاسية: الماركة ومكانها المكتوب");
        ok(Warned("لصنف محذوف"), "المخزن: صنف محذوف يُذكر ولا يُنقل");
        ok(L("SELECT balance FROM customers WHERE old_id = 'c1'") == 75500, "دين الزبون 75.5 ← 75500");
        ok(S("SELECT group_concat(name, '،') FROM (SELECT name FROM categories WHERE kind = 'book' ORDER BY sort)") == "علوم،روايات",
            "قائمة التصنيفات بترتيبها بلا تكرار");
        ok(S("SELECT group_concat(DISTINCT cat) FROM items WHERE kind = 'book' AND cat <> ''") == "علوم,روايات", "تصنيف كل كتاب نصه كما هو");

        ok(Warned("فاتورة برقم مكرر") && L("SELECT no FROM invoices WHERE old_id = 'i3b'") == 7, "رقم الفاتورة المكرر يأخذ رقماً جديداً (7) بتنبيه");
        ok(L("SELECT value FROM counters WHERE name = 'invoice'") == 7, "عدّاد الفواتير بعد آخر رقم");
        ok(L("SELECT COUNT(*) FROM invoices WHERE old_id = 'i4'") == 0 && Warned("الفاتورة 4 بلا أسطر صالحة"), "فاتورة كل أسطرها بكمية صفر لا تُنقل، بتنبيه");
        ok(L("SELECT item_id IS NULL FROM invoice_lines WHERE name = 'كتاب حُذف'") == 1, "سطر لكتاب محذوف يبقى باسمه بلا ربط");
        ok(S("SELECT phone_id || '|' || device || '|' || source FROM invoices WHERE old_id = 'i3b'") == "ph-1|تلفون تجربة|phone", "بيانات فاتورة التلفون");
        ok(S("SELECT debt_cut || '|' || cash_back FROM invoices WHERE old_id = 'i5'") == "45500|0",
            "إرجاع قديم بلا debtCut على زبون: أنقص الدين بقيمته كلها كما فعلت 3.x وقتها");
        ok(L("SELECT ref_id IS NULL FROM invoices WHERE old_id = 'i6'") == 1 && Warned("فاتورته الأصلية 99 غير موجودة"), "إرجاع أصله غير موجود يُنقل بتنبيه");
        ok(S("SELECT edited_at FROM invoices WHERE old_id = 'i1'") == "2026-02-01 09:20:00", "وقت تعديل الفاتورة");
        ok(L("SELECT COUNT(*) FROM payments") == 1 && Warned("لزبون غير موجود"), "تسديد لزبون محذوف لا يُنقل، بتنبيه");
        ok(L("SELECT COUNT(*) FROM purchase_lines WHERE place_id = " + room) == 1 && L("SELECT SUM(qty) FROM purchase_lines") == 10,
            "سطر الاستلام: 6 للرف و4 لغرفة الخزين");
        ok(d.ConsignDue(L("SELECT id FROM consignors")) == 2500, "المستحق لصاحب الكتب: 2×2 − 1.5 = 2.5");
        ok(L("SELECT from_drawer FROM consignment_payments") == 0, "تسديد على المباع من خارج الدرج");
        ok(L("SELECT diff FROM day_closings") == -750, "إقفال اليوم: الفرق −0.75");
        ok(L("SELECT COUNT(*) FROM count_sessions WHERE status = 'applied'") == 1 && L("SELECT base_qty FROM count_entries WHERE item_id IS NULL") == 11,
            "تقرير الجرد القديم بأسطره");
        ok(L("SELECT COUNT(*) FROM count_sessions WHERE status = 'open' AND scope = 'place'") == 1 &&
           L("SELECT base_qty * 100 + counted_qty FROM count_entries WHERE item_id = " + b1) == 1009, "الجرد المفتوح ينتقل مفتوحاً: المسجَّل 10 والمعدود 9");
        ok(S("SELECT kind || '|' || to_branch FROM branch_messages") == "req|tripoli-test", "طلب التحويل للفرع الآخر");
        ok(S("SELECT detail FROM ops WHERE kind = 'log3' ORDER BY id LIMIT 1") == "إضافة كتاب: الفيزياء الأساسية", "سجل العمليات من الأقدم");
        ok(S("SELECT value FROM settings WHERE key = 'phoneDone'") == "{\"ph-1\":3}" && S("SELECT value FROM settings WHERE key = 'x3.futureThing'") == "{\"x\":1}",
            "الإعدادات وما لا نعرفه من الأقسام محفوظ كما هو");
        ok(L("SELECT COUNT(*) FROM change_log WHERE op_id = (SELECT id FROM ops WHERE kind = 'import3x')") == 1, "النقل نقطة بداية: صف واحد في سجل التغييرات (صف الأمر)");
        ok(S("SELECT detail FROM ops WHERE kind = 'import3x'").Contains("4 كتاب"), "والنقل في سجل العمليات");

        /* العمل يكمل على المنقول */
        long i2 = L("SELECT id FROM invoices WHERE old_id = 'i2'");
        InvoiceRow v2 = d.GetInvoice(i2);
        InvoiceResult back = d.Return(i2, new ReturnLine[] { new ReturnLine(v2.Lines[0].Id, 5) }, "", 1);
        /* بِيعت نسختان وأُرجعت واحدة في 3.x (إرجاع بلا رقم سطر): يبقى للإرجاع نسخة.
           90 من 91 بعد الخصم ← 45.5 × 90 ÷ 91 = 45، تُنقص من دين الزبون */
        ok(back.Total == -45000 && back.DebtCut == 45000 && L("SELECT balance FROM customers WHERE old_id = 'c1'") == 30500,
            "إرجاع من فاتورة منقولة: الإرجاع القديم يُحسب (نسخة لا 5)، والقيمة بعد الخصم من الدين", back.Total);
        SaleInput s = new SaleInput();
        s.Lines.Add(new SaleLine(b1, 1, 45500));
        InvoiceResult sold = d.Sell(s, 1);
        ok(sold.No == 9 && d.StockOf(b1)[it.HomePlaceId] == 6, "وبيعة جديدة تأخذ الرقم التالي وتُنقص من رفّه", sold.No);
        ok(d.FullCheck().Count == 0, "وبعد العمل عليها تبقى سليمة");
        Exception again = null;
        try { d.Import3x(Store, 1); } catch (ShopException e) { again = e; }
        ok(again != null && again.Message.Contains("مرة واحدة"), "النقل لا يتكرر على قاعدة فيها بيانات", again == null ? "" : again.Message);
        d.Dispose();
        try { File.Delete(path); File.Delete(path + "-wal"); File.Delete(path + "-shm"); } catch { }
    }

    /* DbTests.exe import <store.json> [db] */
    public static int Cli(string[] args)
    {
        if (args.Length < 2) { Console.WriteLine("الاستعمال: DbTests.exe import <store.json> [قاعدة.db]"); return 2; }
        string db = args.Length > 2 ? args[2] : Path.Combine(Path.GetTempPath(), "qimport-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".db");
        ShopDb d = ShopDb.Open(db, null);
        ImportReport r = d.Import3x(File.ReadAllText(args[1], Encoding.UTF8), 1);
        Console.WriteLine("نُقل في " + r.Ms + " ms ← " + db);
        Console.Write(r.ToText());
        List<string> bad = d.FullCheck();
        Console.WriteLine(bad.Count == 0 ? "  الفحص الكامل: سليمة" : "  الفحص الكامل: " + string.Join("؛ ", bad.ToArray()));
        d.Dispose();
        return r.AllOk && bad.Count == 0 ? 0 : 1;
    }
}
