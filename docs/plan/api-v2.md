# أوامر المحرك `/api/v2` (المرحلة 2)

> الكود: `src/Engine/`. الاختبارات: `tests/db/ApiTests.cs` (داخل البرنامج)، و`tools/test-engine.js`
> (البرنامج الحقيقي عبر HTTP). الواجهة تنتقل لهذه الأوامر في المرحلة 4.

## الشكل

- **الطلب:** `POST /api/v2/<الأمر>` وجسمه JSON.
- **الحارس:** نفس حارس `/api` في 3.x:
  - `Host` هو `127.0.0.1:<المنفذ>`.
  - `Origin` إن وُجد هو الأصل نفسه.
  - ترويسة `X-Qirtasiya: 1`.
  - البرنامج مفعَّل.
- **الجلسة:**
  - `login` يعطي `token`، وكل أمر بعده يحمله في ترويسة `X-Session`.
  - تنتهي الجلسة بعد 12 ساعة بلا استعمال، ومع إعادة تشغيل البرنامج.
- **الرد:**
  - `{ok: true, data}` عند النجاح.
  - `{ok: false, error}` عند رفض مشروع، مثل «لا دين على الزبون».
  - `401` بلا جلسة.
  - `403` بلا صلاحية، والرد يحمل `perm` واسم الصلاحية بالعربي.
  - `404` لأمر غير معروف، و`405` لغير `POST`.
- **المبالغ بالدرهم أعداداً صحيحة** (قرار 0006)، والكميات أعداد صحيحة. `12.5` تُرفض بسببها،
  والواجهة تحوّل للعرض.
- **سعر الشراء والربح** لا يُرسلان لمن لا يملك `view_cost`، وسعر شراء يرسله لا يُعتمد.
- **تعديل الصنف يدمج:** الحقل غير المرسل يبقى كما هو. تغيير أي سعر يحتاج `edit_prices` فوق
  `edit_items`.

## قبل القاعدة الجديدة وبعدها

- **بلا `data/qirtasiya.db`:** البرنامج يعمل على `store.json` كما كان، وأوامر v2 ترد `409`
  (`code: "no-db"`).
- **`/api/v2/import`:** ينقل `store.json` مرة واحدة، من النافذة المالكة للكتابة (`X-Owner`):
  1. نسخة من `store.json`.
  2. النقل في معاملة واحدة.
  3. نسخة كاملة من القاعدة.
  4. الرد هو تقرير المطابقة.
- **بعد النقل:** `/api/save` و`/api/restore` يرفضان، فلا تعيش البيانات في مكانين.

## الأوامر (63) وصلاحية كل منها

| الصلاحية | الأوامر |
|---|---|
| أي موظف داخل | `me`، `me.password`، `shop.info` |
| `sell` البيع | `sale`، `invoice.get`، `invoices.page`، `customers.list` |
| `search` البحث | `items.page`، `item.find`، `categories.list` |
| `view_stock` مشاهدة المخزون | `item.get`، `places.list`، `alerts` |
| `returns` الإرجاع | `return` |
| `edit_invoice` تعديل الفواتير | `invoice.edit` |
| `delete_invoice` حذف الفواتير | `invoice.delete` |
| `edit_items` الأصناف | `item.add`، `item.edit`، `item.delete`، `stock.adjust`، `labels.printed`، `suppliers.list`، `publishers.list` |
| `edit_prices` تعديل الأسعار | (مع `item.edit` حين يتغير سعر) |
| `view_cost` سعر الشراء والأرباح | (يُظهر `cost` و`profit` في الردود) |
| `receive` إدخال البضاعة | `receive`، `purchases.page` |
| `move_stock` النقل بين الأماكن | `stock.move` |
| `count` الجرد | `count.start`، `count.set`، `count.apply`، `count.cancel`، `count.current` |
| `customers` الزبائن | `customer.add`، `customer.edit`، `customer.delete`، `customer.get` |
| `debts` الديون | `payment.add`، `customer.balance` (ودين سابق عند `customer.add`) |
| `suppliers` الموردون ودور النشر | `supplier.add`، `supplier.edit`، `supplier.delete`، `publisher.save`، `publisher.delete` |
| `consign` المباع | `consign.in`، `consign.back`، `consign.pay`، `consignors.list` |
| `reports` التقارير | `report.range`، `stale` |
| `closing` إقفال اليوم | `day.close` |
| `places` الأماكن والمخازن | `place.add`، `place.edit`، `place.delete` |
| `settings` الإعدادات | `settings.get`، `setting.set`، `categories.set`، `health` |
| `users` الموظفون | `users.list`، `user.add`، `user.password`، `user.perms`، `user.active`، `perms.list` |
| `log` سجل العمليات | `ops.page` |

- **المدير** (`role: admin`) يملك كل الصلاحيات.
- **الموظف الجديد** يبدأ بـ `sell` و`search` و`view_stock`.
- **تغيير صلاحيات موظف أو إيقافه** يسري على جلساته المفتوحة فوراً.
- اختبار آلي يتأكد أن كل أمر يعلن صلاحية معروفة (قرار 0011).

## أمثلة

```
POST /api/v2/login  {"login": "admin", "password": ""}
→ {"ok": true, "data": {"token": "…", "userId": 1, "name": "المدير", "role": "admin", "perms": [...]}}

POST /api/v2/sale  {"lines": [{"itemId": 12, "qty": 2}], "method": "cash"}      ← بلا سعر: سعر الصنف
→ {"ok": true, "data": {"id": 40, "no": 35, "total": 91000, "due": 0, "fromRoom": [], …}}

POST /api/v2/return  {"invoiceId": 40, "lines": [{"lineId": 77, "qty": 1}]}
POST /api/v2/items.page  {"q": "فيزياء", "sort": "title", "limit": 50, "offset": 0}
```

## ما يأتي بعد

- **المرحلة 3:** البحث المتسامح بالفهرس بدل `LIKE` في `items.page`.
- **المرحلة 4:** الواجهة على هذه الأوامر، وملخص الصندوق لإقفال اليوم بنفس حساب 3.x.
- **المرحلة 5:** شاشات الموظفين والصلاحيات.
