# النشر — من الصفر إلى موقع على الإنترنت

عشر خطوات. كل خطوة قابلة للتحقق قبل الانتقال إلى التالية.

---

## المرحلة الأولى: التطوير على اللابتوب

### خطوة 1 — Node.js

نزّل **Node 24** (أو 22.5 على الأقل) من [nodejs.org](https://nodejs.org).

```powershell
node -v    # يجب أن تكون v22.5.0 أو أعلى
```

### خطوة 2 — تجهيز المشروع

```powershell
cd novahost
.\scripts\dev.ps1 setup
```

> إن رفضت PowerShell تشغيل السكربت:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

**لا يوجد `npm install`.** المشروع بلا تبعيات — هذا مقصود، وشرحه في
[ANALYSIS.md](ANALYSIS.md#٢-ما-أفضل-stack).

### خطوة 3 — التشغيل والاختبار

```powershell
.\scripts\dev.ps1 start
```

افتح `http://localhost:8080` ← معالج الإعداد ← أنشئ حساباً ← أنشئ مشروعاً ←
ارفع ZIP ← افتح الموقع.

```powershell
.\scripts\dev.ps1 test    # 118 اختباراً
```

**لا تنتقل للهاتف قبل أن يعمل كل شيء هنا.** تصحيح الأخطاء على الهاتف أبطأ بكثير.

---

## المرحلة الثانية: النقل إلى Samsung A36

### خطوة 4 — تجهيز الهاتف

اتبع [ANDROID-SERVER.md](ANDROID-SERVER.md) الأقسام ١ إلى ٣. باختصار:

```bash
# على الهاتف
pkg update && pkg install -y git
git clone <رابط-المستودع> ~/novahost
cd ~/novahost/novahost
bash scripts/install-termux.sh
```

ثم **الخطوات الثلاث اليدوية** في أندرويد (فتح Termux:Boot، إلغاء تقييد
البطارية، إبقاء الواي فاي نشطاً). هذه ليست اختيارية.

### خطوة 5 — إعداد `.env` للإنتاج

السكربت ولّد `SESSION_SECRET` وضبط `NODE_ENV=production`. راجع:

```bash
nano .env
```

```ini
NODE_ENV=production
HOST=0.0.0.0              # ليصل إليه اللابتوب والآيفون
PORT=8080
SITES_PORT=8081
PUBLIC_URL=http://192.168.1.XX:8080
SESSION_SECRET=<مولَّد>
```

### خطوة 6 — التشغيل

```bash
scripts/start.sh
scripts/status.sh
```

### خطوة 7 — التحقق من الشبكة المحلية

- من اللابتوب: `http://192.168.1.XX:8080`
- من الآيفون على الواي فاي: نفس الرابط
- أنشئ مشروعاً وارفع ZIP وافتح الموقع

### خطوة 8 — اختبار الإقلاع التلقائي

**أعد تشغيل الهاتف فعلاً.** انتظر دقيقة، ثم افتح اللوحة من اللابتوب.

إن لم تعمل: افتح Termux، `cd ~/novahost/novahost && scripts/logs.sh server`.
السبب الأشيع: لم تفتح تطبيق Termux:Boot ولو مرة.

---

## المرحلة الثالثة: الإنترنت

### خطوة 9 — النفق

**تجربة سريعة بلا نطاق:**

```bash
pkg install cloudflared
scripts/tunnel.sh quick
```

خذ الرابط، وافتحه من **الآيفون مع إطفاء الواي فاي**. إن عمل، فالنفق يعمل.

**للعنوان الدائم:** اتبع [NETWORKING.md](NETWORKING.md#mode-c--نفق-مسمى--نطاقك).

### خطوة 10 — التأمين بعد النشر

بعد أن تصبح اللوحة متاحة على الإنترنت:

```ini
PUBLIC_URL=https://panel.example.com
PANEL_HOST=panel.example.com
SITES_DOMAIN=example.com
TRUST_PROXY=true          # ليرى السيرفر عنوان الزائر الحقيقي
SECURE_COOKIES=auto       # يفعّل Secure تلقائياً على HTTPS
```

`scripts/restart.sh` ثم تحقق:

```bash
curl -sI https://panel.example.com/health | head -5
```

**إجراء إضافي مجاني وقوي:** ضع **Cloudflare Access** أمام `panel.example.com`
(مجاني حتى ٥٠ مستخدماً). بعدها لن يصل أحد إلى شاشة تسجيل الدخول أصلاً قبل
إثبات هويته برمز يصل إلى بريدك — طبقة قبل المنصة نفسها.

---

## الاستخدام اليومي

```
افتح اللوحة → New Project → اكتب الاسم → Create
            → Deployments → اسحب ملف ZIP → انتظر → Open Site
```

للتعديل السريع:
```
Files → افتح index.html → عدّل → Save → Publish changes
```

للتراجع:
```
Deployments → اختر نسخة سابقة → Roll back
```

---

## الصيانة

| متى | ماذا |
|---|---|
| أسبوعياً | `scripts/backup.sh --to-downloads` وانسخ الملف إلى اللابتوب |
| شهرياً | `pkg upgrade` ثم `scripts/restart.sh` ثم `npm test` |
| عند أي شك | `npm run doctor` |
| عند امتلاء التخزين | صفحة Server ← Run cleanup |

## التحديث إلى نسخة أحدث من المنصة

```bash
cd ~/novahost/novahost
scripts/backup.sh          # دائماً قبل التحديث
git pull
node backend/src/cli.js migrate
scripts/restart.sh
npm run doctor
```

الهجرات تعمل داخل معاملة واحدة: إما تنجح كاملة أو لا يتغيّر شيء.

---

## الاستعادة بعد كارثة

**الهاتف ضاع أو تلف، ومعك ملف نسخة احتياطية:**

```bash
# على الهاتف الجديد
bash scripts/install-termux.sh
scripts/stop.sh
node backend/src/cli.js restore /path/to/backup-....zip
scripts/start.sh
```

الاستعادة تأخذ **نسخة أمان من الحالة الحالية أولاً**، وتُبقي القديم جانباً حتى
لو نجحت — حتى يكون التراجع اليدوي ممكناً دائماً.

**نسيت كلمة المرور:**

```bash
node backend/src/cli.js reset-password
```

يتطلب وصولاً إلى الجهاز أو SSH — وهذا هو المقصود.

---

## النقل إلى جهاز آخر لاحقاً

المشروع لا يحتوي شيئاً خاصاً بأندرويد في المسار الحرج. للنقل إلى
Raspberry Pi أو VPS أو حاسب منزلي:

```bash
# على الجهاز الجديد
git clone <repo> && cd novahost
cp .env.example .env && nano .env
node backend/src/cli.js migrate
node backend/src/cli.js restore backup.zip
node backend/src/server.js
```

على نظام فيه systemd، استبدل `scripts/supervise.sh` بوحدة خدمة:

```ini
[Unit]
Description=NOVA HOST
After=network.target

[Service]
Type=simple
User=novahost
WorkingDirectory=/opt/novahost
ExecStart=/usr/bin/node backend/src/server.js
Restart=always
RestartSec=5
Environment=NOVAHOST_SUPERVISED=1

[Install]
WantedBy=multi-user.target
```
