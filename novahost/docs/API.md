# NOVA HOST — واجهة البرمجة (API)

كل الردود بنفس الشكل:

```jsonc
// نجاح
{ "success": true, "data": { ... } }

// فشل
{ "success": false, "error": { "code": "PROJECT_NOT_FOUND", "message": "Project not found" } }
```

الـ`code` ثابت ومخصص للبرمجة؛ الـ`message` بالإنجليزية للسجلات. الواجهة تترجم
الأكواد إلى العربية (انظر `frontend/assets/js/i18n.js`).

## المصادقة

- كوكي جلسة `nh_session` — HttpOnly، SameSite=Lax، بلا `Domain` (host-only).
- كل طلب يغيّر حالة (POST/PUT/PATCH/DELETE) يحتاج ترويسة `X-CSRF-Token` بقيمة
  `csrfToken` التي تعيدها `/api/auth/me`.
- كذلك يُفحص `Origin`/`Referer` مقابل المضيفين المعروفين.

```bash
# مثال كامل بـcurl
curl -c jar.txt -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}'

CSRF=$(curl -sb jar.txt http://localhost:8080/api/auth/me \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.csrfToken')

curl -b jar.txt -X POST http://localhost:8080/api/projects \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"name":"My Site"}'
```

## حدود المعدل

| الفئة | الحد |
|---|---|
| `/api/auth/login` | 10 / 15 دقيقة لكل IP |
| `/api/setup` | 5 / ساعة |
| الرفع والنشر والنسخ | 30 / ساعة |
| الكتابة العامة | 120 / دقيقة |
| باقي الـAPI | 300 / دقيقة |
| المواقع المستضافة | 600 / دقيقة |

---

## الإعداد الأول

| | | |
|---|---|---|
| `GET` | `/api/setup/status` | هل يحتاج النظام إعداداً؟ |
| `POST` | `/api/setup` | إنشاء المدير — يُغلق نفسه بعد أول حساب (410 بعدها) |

## الجلسة

| | | |
|---|---|---|
| `POST` | `/api/auth/login` | `{username, password, remember}` |
| `POST` | `/api/auth/logout` | |
| `GET` | `/api/auth/me` | المستخدم + `csrfToken` |
| `PATCH` | `/api/auth/profile` | `{displayName, email, locale, theme}` |
| `POST` | `/api/auth/password` | `{currentPassword, newPassword}` — يُنهي الجلسات الأخرى |
| `GET` | `/api/auth/sessions` | الجلسات النشطة |
| `DELETE` | `/api/auth/sessions/:id` | إنهاء جلسة |

## المشاريع

| | | |
|---|---|---|
| `GET` | `/api/projects` | `?search=&limit=&offset=&sort=updated\|created\|name\|size&dir=` |
| `POST` | `/api/projects` | `{name, slug?, description?, visibility?, framework?}` |
| `GET` | `/api/projects/:id` | بالمعرّف أو الـslug |
| `PATCH` | `/api/projects/:id` | تعديل — تغيير `slug` يغيّر كل روابط الموقع |
| `POST` | `/api/projects/:id/enabled` | `{enabled}` — إيقاف/تشغيل الموقع |
| `DELETE` | `/api/projects/:id?confirm=<slug>` | حذف نهائي، يتطلب الـslug كتأكيد |
| `GET` | `/api/projects/:id/stats` | حجم وعدد الملفات والنشرات |
| `GET` | `/api/projects/:id/download` | تنزيل الموقع المنشور كـZIP |
| `GET` | `/api/slug-preview?name=` | معاينة الـslug أثناء الكتابة |

## النشر

| | | |
|---|---|---|
| `POST` | `/api/projects/:id/deploy?message=` | **جسم الطلب = ملف ZIP خام** |
| `POST` | `/api/projects/:id/publish` | نشر نسخة العمل من محرر الملفات |
| `GET` | `/api/projects/:id/deployments` | سجل النسخ |
| `POST` | `/api/projects/:id/rollback` | `{deploymentId}` — تبديل مؤشر فقط |
| `GET` | `/api/deployments` | آخر النشرات عبر كل المشاريع |
| `GET` | `/api/deployments/:deploymentId` | تفاصيل + قائمة ملفات |
| `GET` | `/api/deployments/:deploymentId/logs` | سجل النشر خطوة بخطوة |

**لماذا جسم خام وليس `multipart/form-data`؟** لأن المتصفح يستطيع إرسال كائن
`File` مباشرة كجسم XHR، وهذا يعطي شريط تقدّم مجاناً، ويُلغي الحاجة إلى محلّل
multipart — وهو تاريخياً مصدر غني للثغرات في خادم يجب أن يكون جديراً بالثقة.

```js
// من المتصفح
const xhr = new XMLHttpRequest();
xhr.open('POST', `/api/projects/${id}/deploy`);
xhr.setRequestHeader('Content-Type', 'application/zip');
xhr.setRequestHeader('X-CSRF-Token', csrfToken);
xhr.upload.onprogress = (e) => console.log(e.loaded / e.total);
xhr.send(file);
```

```bash
# من سطر الأوامر
curl -b jar.txt -X POST "http://localhost:8080/api/projects/my-site/deploy?message=v2" \
  -H 'Content-Type: application/zip' -H "X-CSRF-Token: $CSRF" \
  --data-binary @site.zip
```

## الملفات

كلها تعمل على **نسخة العمل** لا على النشر المنشور.

| | | |
|---|---|---|
| `GET` | `/api/projects/:id/files?path=` | سرد مجلد |
| `GET` | `/api/projects/:id/files/content?path=` | قراءة ملف نصي |
| `GET` | `/api/projects/:id/files/raw?path=&download=1` | الملف الخام |
| `PUT` | `/api/projects/:id/files?path=` | **جسم خام** — كتابة/رفع ملف |
| `POST` | `/api/projects/:id/files/folder` | `{path}` |
| `POST` | `/api/projects/:id/files/rename` | `{from, to}` |
| `DELETE` | `/api/projects/:id/files?path=` | حذف |
| `POST` | `/api/projects/:id/files/discard` | إلغاء التعديلات |

## النطاقات

| | | |
|---|---|---|
| `GET` | `/api/domains` | |
| `POST` | `/api/projects/:id/domains` | `{hostname}` — يعيد تعليمات DNS |
| `POST` | `/api/domains/:domainId/verify` | تحقق من سجل TXT |
| `DELETE` | `/api/domains/:domainId` | |

## السيرفر

| | | |
|---|---|---|
| `GET` | `/health` | **بلا مصادقة** — للمشرف وسكربتات الإقلاع |
| `GET` | `/api/overview` | كل ما تحتاجه الصفحة الرئيسية في طلب واحد |
| `GET` | `/api/server/stats` | إحصاءات حقيقية (`null` لما لا يمكن قراءته) |
| `GET` | `/api/server/info` | البيئة والإعداد والهجرات |
| `GET` | `/api/server/storage` | تفصيل التخزين |
| `POST` | `/api/server/rescan` | إعادة حساب أحجام المشاريع |
| `POST` | `/api/server/cleanup` | تنظيف فوري |
| `POST` | `/api/server/restart` | `{confirm:"restart"}` — يعمل تحت المشرف فقط |
| `GET` | `/api/search?q=` | بحث في المشاريع والنشرات والسجلات |

## السجلات والإعدادات والنسخ

| | | |
|---|---|---|
| `GET` | `/api/logs` | `?level=&projectId=&search=&limit=` |
| `DELETE` | `/api/logs` | |
| `GET` | `/api/logs/security` | أحداث تسجيل الدخول |
| `GET` | `/api/logs/audit` | من فعل ماذا ومتى |
| `GET` / `PATCH` | `/api/settings` | القيم والحدود والمخطط |
| `GET` / `POST` | `/api/backups` | |
| `GET` | `/api/backups/:id/download` | |
| `DELETE` | `/api/backups/:id` | |
| `POST` | `/api/backups/restore?confirm=restore` | **جسم خام** — استعادة (مدمّرة) |

---

## أكواد الأخطاء

| الكود | HTTP | المعنى |
|---|---|---|
| `UNAUTHORIZED` | 401 | لا جلسة |
| `FORBIDDEN` | 403 | CSRF أو أصل غير معروف |
| `VALIDATION_ERROR` | 422 | حقول غير صالحة (مع `details`) |
| `RATE_LIMITED` | 429 | مع ترويسة `Retry-After` |
| `PROJECT_NOT_FOUND` | 404 | |
| `SLUG_TAKEN` / `SLUG_RESERVED` / `SLUG_INVALID` | 409/422 | |
| `UPLOAD_TOO_LARGE` | 413 | أكبر من `maxUploadMb` |
| `ZIP_INVALID` / `ZIP_EMPTY` / `ZIP_CORRUPT` | 422 | أرشيف غير صالح |
| `ZIP_BOMB` / `ZIP_TOO_LARGE` / `ZIP_TOO_MANY_FILES` | 422 | تجاوز الحدود |
| `ZIP_PATH_TRAVERSAL` / `ZIP_SYMLINK` | 422 | محاولة خروج من المجلد |
| `NO_INDEX_HTML` | 422 | لا صفحة رئيسية في الأرشيف |
| `INVALID_PATH` | 400 | مسار غير مسموح |
| `DISK_FULL` | 507 | لا مساحة |
| `CONFIRMATION_REQUIRED` | 400 | عملية مدمّرة تحتاج تأكيداً |
| `NOT_SUPERVISED` | 400 | إعادة التشغيل تحتاج سكربت الإشراف |

## مفاتيح API (المرحلة الثانية)

جدول `api_keys` والدوال موجودة بالفعل في `backend/src/db/repo/apikeys.js`،
والصيغة `nh_<prefix>_<secret>` مع تخزين التجزئة فقط. لم تُوصَل بعد بمسارات
HTTP — أُنشئت مبكراً حتى تكون إضافة الـCLI لاحقاً **إضافة** لا هجرة على تثبيت
يعمل.
