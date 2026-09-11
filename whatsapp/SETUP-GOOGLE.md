# ربط جوجل — التقويم والدرايف

نحتاج `GOOGLE_CLIENT_ID` و`GOOGLE_CLIENT_SECRET` ثم نولّد `GOOGLE_REFRESH_TOKEN`.

كل شيء هنا **مجاني**.

## 1) أنشئ مشروعاً

<https://console.cloud.google.com/> ← من الأعلى `Select a project` ← `New Project` ← سمّه `boxsand` ← `Create`

## 2) فعّل الخدمتين

من `APIs & Services` ← `Library`، ابحث وفعّل:

- **Google Calendar API** ← `Enable`
- **Google Drive API** ← `Enable`

## 3) اضبط شاشة الموافقة

`APIs & Services` ← `OAuth consent screen`

| الحقل | القيمة |
|---|---|
| User Type | **External** |
| App name | `boxsand` |
| User support email | بريدك |
| Developer contact | بريدك |

في خطوة **Scopes** تقدر تتجاوز وتضغط `Save and Continue`.

في خطوة **Test users** ← `Add Users` ← **ضع بريدك الإلكتروني**. ⚠️ هذه الخطوة ضرورية، وبدونها بيرفض تسجيل الدخول.

> التطبيق بيبقى في وضع `Testing` وهذا كافي تماماً لاستعمالك الشخصي. لا تحتاج مراجعة من جوجل.

## 4) أنشئ بيانات الاعتماد

`APIs & Services` ← `Credentials` ← `Create Credentials` ← `OAuth client ID`

| الحقل | القيمة |
|---|---|
| Application type | **Desktop app** |
| Name | `boxsand` |

انسخ `Client ID` و`Client Secret` وضعهم في ملف `.env`:

```
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx
```

## 5) ولّد الرمز الدائم

على السيرفر:

```bash
npm run auth:google
```

بيطلعلك رابط:

1. افتحه في **أي متصفح** — جوالك يكفي
2. اختر حسابك ← لو ظهر تحذير "Google hasn't verified this app" اضغط `Advanced` ← `Go to boxsand (unsafe)` — هذا طبيعي لأن التطبيق تاعك ولسه في وضع الاختبار
3. وافق على الأذونات
4. المتصفح بيحاول يفتح `localhost:5555` ويعطيك **صفحة خطأ — هذا متوقع وصحيح**
5. **انسخ رابط الصفحة كامل** من شريط العنوان والصقه في الطرفية

بيطلعلك `GOOGLE_REFRESH_TOKEN` — ضعه في `.env`.

## 6) حدّد مجلد الدرايف (اختياري لكن مستحسن)

أنشئ مجلداً في درايف اسمه مثلاً `ملفات السكرتير`، افتحه، وخذ المعرّف من الرابط:

```
drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp
                               └────── هذا هو ──────┘
```

```
DRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOp
```

بهذا البوت يحفظ ويبحث داخل المجلد هذا فقط بدل درايفك كله — أنظف وأأمن.

## تأكد إن كل شيء تمام

```bash
npm run check
```

لازم تشوف: `✅ جوجل مربوط: true`

---

## مشاكل شائعة

| المشكلة | الحل |
|---|---|
| `access_denied` | ما ضفتش بريدك في **Test users** في الخطوة 3 |
| `ما وصلش refresh token` | احذف صلاحية التطبيق من <https://myaccount.google.com/permissions> وأعد `npm run auth:google` |
| `invalid_grant` | الرمز انتهى أو أُلغي — ولّد واحداً جديداً |
| `insufficient permissions` | الصلاحيات ناقصة — أعد التوليد وتأكد من الموافقة على كل الأذونات |
