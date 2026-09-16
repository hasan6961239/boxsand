# ANDROID-SERVER-SETUP

**الجهاز:** Samsung Galaxy A36 5G · Android 15 · One UI 7
**الهدف:** سيرفر يعمل ٢٤/٧ يستضيف لوحة NOVA HOST والمواقع المرفوعة.

كل الأوامر هنا **جاهزة للنسخ واللصق**. نفّذها بالترتيب.

> اقرأ هذا أولاً: الأقسام **17 و18** ليست تحسينات اختيارية. بدونها سيتوقف
> السيرفر خلال دقائق من إطفاء الشاشة، ولا يوجد أي حل برمجي يتجاوز ذلك.

---

## 1) تثبيت Termux من المصدر الصحيح

**لا تستخدم Google Play.** نسخة المتجر متوقفة عن التحديث منذ سنوات وستفشل عند
`pkg install`.

نزّل F-Droid من [f-droid.org](https://f-droid.org)، ثم ثبّت منه **Termux**.

أو مباشرة من GitHub:
[github.com/termux/termux-app/releases](https://github.com/termux/termux-app/releases)
← اختر `termux-app_v*+apt-android-7-github-debug_arm64-v8a.apk`

افتح Termux ثم:

```bash
pkg update -y && pkg upgrade -y
```

## 2) تثبيت Termux:Boot

من **نفس المصدر** الذي ثبّت منه Termux:

- F-Droid: [f-droid.org/packages/com.termux.boot](https://f-droid.org/packages/com.termux.boot/)
- GitHub: [github.com/termux/termux-boot/releases](https://github.com/termux/termux-boot/releases)

> **لماذا نفس المصدر؟** أندرويد يرفض تثبيت تطبيق إضافي موقّع بمفتاح مختلف عن
> التطبيق الأساسي. الخلط بين المصدرين يعطي رسالة فشل غامضة.

**ثم افتح تطبيق Termux:Boot مرة واحدة.** ستظهر شاشة شبه فارغة — هذا طبيعي.
**قبل هذه الضغطة لن يعمل أي سكربت إقلاع مهما كان صحيحاً.**

## 3) تثبيت Termux:API

نحتاجه لقراءة **البطارية والحرارة** في صفحة السيرفر. بدونه تظهران «غير متاح»
(والمنصة لن تخترع رقماً).

ثبّت التطبيق من نفس المصدر، ثم:

```bash
pkg install -y termux-api
```

تحقّق:

```bash
termux-battery-status
```

يجب أن يطبع JSON. إن ظهر طلب إذن، اقبله.

## 4) الصلاحيات

```bash
# تخزين مشترك — لنسخ النسخ الاحتياطية إلى مجلد التنزيلات
termux-setup-storage
```

اقبل نافذة الإذن التي تظهر. تتحقق بـ:

```bash
ls ~/storage/downloads
```

## 5) تثبيت Node.js

```bash
pkg install -y nodejs-lts
node -v
```

يجب أن تكون **v22.5.0 أو أعلى**. إن كانت أقدم:

```bash
pkg install -y nodejs
node -v
```

> `nodejs-lts` هو الخيار الأنسب لجهاز يُفترض أن يبقى يعمل أسابيع.

## 6) تثبيت باقي الأدوات

```bash
pkg install -y git openssh termux-services
```

| الأداة | لماذا |
|---|---|
| `git` | لجلب المشروع وتحديثه |
| `openssh` | لإدارة الهاتف من اللابتوب |
| `termux-services` | لتشغيل sshd تلقائياً |

## 7) نسخ مشروع novahost إلى الهاتف

**الطريقة الأولى — من Git (موصى بها):**

```bash
cd ~
git clone https://github.com/hasan6961239/boxsand.git novahost-repo
cd ~/novahost-repo/novahost
pwd
```

آخر أمر يطبع مسار المشروع. **احفظه** — سنسميه `$NOVA` في بقية الدليل.

**الطريقة الثانية — من اللابتوب عبر SSH** (بعد إتمام القسم 21):

```powershell
.\scripts\dev.ps1 push -PhoneHost 192.168.1.XX -PhoneUser u0_aXXX
```

## 8) إنشاء مجلدات البيانات

```bash
cd ~/novahost-repo/novahost
mkdir -p data/logs data/run data/storage/{sites,tmp,backups}
ls -la data
```

> السكربت في القسم 10 ينشئها تلقائياً أيضاً؛ هذه الخطوة للتأكد فقط.

## 9) إنشاء ملف الإعداد وقاعدة البيانات

```bash
cd ~/novahost-repo/novahost
cp .env.example .env

# توليد مفتاح الجلسات — لا تتركه فارغاً
SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" .env
sed -i "s|^NODE_ENV=.*|NODE_ENV=production|" .env

grep -E '^(NODE_ENV|HOST|PORT|SITES_PORT)=' .env
```

يجب أن ترى:
```
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
SITES_PORT=8081
```

> `HOST=0.0.0.0` ضروري ليصل اللابتوب والآيفون. لو تركته `127.0.0.1` فلن يصل
> إليه شيء غير الهاتف نفسه.

## 10) تشغيل migrations

```bash
cd ~/novahost-repo/novahost
node backend/src/cli.js migrate
```

المتوقع:
```
applied: 1/1
database is up to date
```

**أو بدلاً من الأقسام 8–10 كلها، سكربت واحد يفعل كل شيء:**

```bash
cd ~/novahost-repo/novahost
bash scripts/install-termux.sh
```

## 11) إنشاء حساب المدير

طريقتان — اختر واحدة:

**أ. من المتصفح (الأسهل):** شغّل السيرفر (القسم 12) وافتح اللوحة؛ سيظهر معالج
الإعداد تلقائياً في أول مرة.

**ب. من الطرفية:**

```bash
cd ~/novahost-repo/novahost
node backend/src/cli.js create-admin
```

يسألك عن اسم المستخدم والبريد وكلمة المرور (لا تظهر أثناء الكتابة).

> شرط كلمة المرور: **١٠ أحرف على الأقل**، ولا تحتوي كلمات شائعة. الطول أهم من
> الرموز.

## 12) تشغيل السيرفر

```bash
cd ~/novahost-repo/novahost
scripts/start.sh
```

المتوقع:
```
==> starting supervisor
==> waiting for the server to answer /health
ok  NOVA HOST is up
```

**للتشغيل في المقدمة ورؤية السجل مباشرة** (مفيد عند حل مشكلة):

```bash
scripts/start.sh --foreground
```
`Ctrl+C` للإيقاف.

## 13) اختبار السيرفر محلياً على الهاتف

```bash
curl http://localhost:8080/health
```

المتوقع:
```json
{"success":true,"data":{"status":"ok","checks":{"database":"ok","storage":"ok","disk":"ok"},...}}
```

إن نجح هذا، فالسيرفر يعمل. أي مشكلة بعد ذلك هي **مشكلة شبكة وليست مشكلة سيرفر**.

فحص أشمل:
```bash
node backend/src/cli.js doctor
scripts/status.sh
```

## 14) تشغيل termux-wake-lock

هذا يمنع أندرويد من تجميد العملية عند إطفاء الشاشة.

```bash
termux-wake-lock
```

`scripts/start.sh` يستدعيه تلقائياً، لكن للتشغيل اليدوي استخدم الأمر أعلاه.

**للتحقق:** اسحب شريط الإشعارات — يجب أن ترى إشعار Termux الدائم يذكر
`wake lock held`. **إن لم يظهر، فالسيرفر سيتوقف عند إطفاء الشاشة.**

للإلغاء: `termux-wake-unlock`

## 15) إعداد termux-services

هذا لتشغيل **SSH** تلقائياً مع Termux (السيرفر نفسه يديره سكربت الإشراف):

```bash
pkg install -y termux-services
# أغلق Termux تماماً وافتحه من جديد حتى تُحمَّل الخدمات
sv-enable sshd
sv status sshd
```

المتوقع: `run: sshd: (pid NNNN) Ns`

## 16) إعداد Termux:Boot

```bash
mkdir -p ~/.termux/boot

cat > ~/.termux/boot/novahost <<'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
sleep 15
exec /data/data/com.termux/files/home/novahost-repo/novahost/scripts/start.sh
BOOT

chmod +x ~/.termux/boot/novahost
cat ~/.termux/boot/novahost
```

> **عدّل المسار** إن كنت نسخت المشروع في مكان آخر. تحقق بـ:
> `ls /data/data/com.termux/files/home/novahost-repo/novahost/scripts/start.sh`

`sleep 15` ليست عشوائية: تعطي الواي فاي وقتاً للاتصال بعد الإقلاع، وإلا فشل أول
فحص صحة بلا سبب حقيقي.

**تذكير:** لن يعمل هذا إطلاقاً حتى تفتح تطبيق Termux:Boot مرة واحدة (القسم 2).

## 17) ⚠️ إعدادات بطارية Samsung — الأهم في الدليل كله

`الإعدادات` ← `التطبيقات` ← `Termux` ← `البطارية` ← اختر **«غير مقيّد»**
(Unrestricted).

**كرّر نفس الشيء لـ:**
- `Termux:Boot`
- `Termux:API`

ثم:

`الإعدادات` ← `العناية بالجهاز` ← `البطارية` ← `حدود الاستخدام في الخلفية`:
- تأكد أن Termux **ليس** في «التطبيقات النائمة» (Sleeping apps)
- تأكد أنه **ليس** في «النائمة بعمق» (Deep sleeping apps)
- أطفئ **«إيقاف التطبيقات غير المستخدمة»** (Put unused apps to sleep)

> One UI أكثر عدوانية من أندرويد الخام في إنهاء التطبيقات. تخطّي هذا القسم هو
> **السبب الأول** لتوقف السيرفر، وأكثر شكوى متكررة في هذا النوع من الإعدادات.

## 18) ⚠️ إعدادات Wi-Fi

`الإعدادات` ← `الاتصالات` ← `Wi-Fi` ← اضغط (⋮) ← `إعدادات متقدمة`:
- فعّل **«إبقاء Wi-Fi مشغّلاً أثناء السكون»**
- أطفئ **«التبديل الذكي للشبكة»** (Smart network switch / Adaptive Wi-Fi) —
  وإلا قد ينتقل الهاتف إلى بيانات الجوال ويتغير مسار الوصول المحلي

## 19) معرفة عنوان IP المحلي

```bash
scripts/status.sh
```

يطبع قسم `reachable at:` بكل العناوين.

أو مباشرة:

```bash
ip addr show wlan0 | grep 'inet '
```

أو:

```bash
node -e "const o=require('os');for(const[n,l]of Object.entries(o.networkInterfaces()))for(const a of l||[])if(a.family==='IPv4'&&!a.internal)console.log(n,a.address)"
```

المتوقع شيء مثل `192.168.1.14`.

## 20) تثبيت عنوان IP للهاتف من الراوتر

بدون هذا سيتغيّر العنوان عند إعادة التشغيل وتتعطل روابطك المحفوظة.

1. افتح صفحة الراوتر: `192.168.1.1` أو `192.168.8.1` (اقرأ الملصق خلف الراوتر).
2. ابحث عن **DHCP Reservation** أو **Static Lease** أو **Address Reservation**
   (يختلف الاسم بين الشركات؛ غالباً تحت `LAN` أو `DHCP Server`).
3. أضف عنصراً يربط **MAC address** للهاتف بالعنوان الذي تريده.

لمعرفة MAC الهاتف:
```bash
cat /sys/class/net/wlan0/address 2>/dev/null || ip link show wlan0 | grep ether
```

> إن لم يعمل الأمر (بعض أجهزة أندرويد تحجبه)، اقرأه من:
> `الإعدادات` ← `حول الهاتف` ← `الحالة` ← `عنوان MAC للواي فاي`.
>
> **مهم في أندرويد الحديث:** قد يكون "MAC العشوائي" مفعّلاً لكل شبكة. من
> إعدادات شبكة الواي فاي غيّر **«نوع عنوان MAC»** إلى **«MAC الهاتف»**
> (Phone MAC) وإلا فالحجز في الراوتر لن يثبت.

## 21) الوصول من اللابتوب

**المتصفح:**
```
http://192.168.1.XX:8080
```

**SSH — إعداد لمرة واحدة على الهاتف:**

```bash
passwd          # اختر كلمة مرور لحساب Termux
whoami          # اكتب الناتج، مثل u0_a234 — هذا اسم المستخدم
sshd            # تشغيل خادم SSH
```

**من ويندوز (PowerShell):**

```powershell
ssh -p 8022 u0_a234@192.168.1.XX
```

> منفذ SSH في Termux هو **8022** وليس 22 — المنافذ تحت 1024 تحتاج صلاحيات لا
> يملكها تطبيق عادي على أندرويد.

**مفاتيح بدل كلمة المرور (أفضل):**

```powershell
ssh-keygen -t ed25519
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh -p 8022 u0_a234@192.168.1.XX "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

**نقل المشروع من اللابتوب:**
```powershell
.\scripts\dev.ps1 push -PhoneHost 192.168.1.XX -PhoneUser u0_a234
```

## 22) الوصول من iPhone

**على نفس الواي فاي:** افتح Safari على
```
http://192.168.1.XX:8080
```

**أضفه إلى الشاشة الرئيسية** ليبدو كتطبيق: زر المشاركة ← `إضافة إلى الشاشة
الرئيسية`.

**من خارج المنزل:** يحتاج نفقاً — انظر [NETWORKING.md](NETWORKING.md).

> ⚠️ على HTTP (بلا TLS) لن يعمل زر النسخ في Safari لأن `navigator.clipboard`
> يتطلب سياقاً آمناً. المنصة تتعامل مع ذلك: تُحدِّد النص تلقائياً لتنسخه يدوياً.

## 23) إعادة تشغيل السيرفر

```bash
cd ~/novahost-repo/novahost
scripts/restart.sh
```

أو من اللوحة: صفحة **Server** ← زر **Restart service**
(يعمل فقط عندما يكون السيرفر تحت سكربت الإشراف).

## 24) إيقاف السيرفر

```bash
cd ~/novahost-repo/novahost
scripts/stop.sh
```

يوقف المشرف أولاً (حتى لا يعيد التشغيل)، ثم السيرفر، ثم يحرّر wake lock.

## 25) مشاهدة السجلات

```bash
cd ~/novahost-repo/novahost

scripts/logs.sh              # سجل التطبيق، متابعة حية
scripts/logs.sh server       # سجل المشرف — هنا تظهر أخطاء الإقلاع
scripts/logs.sh -n 200       # آخر ٢٠٠ سطر ثم خروج
```

ومن اللوحة: صفحة **Logs** فيها ثلاثة تبويبات (التطبيق · الأمان · النشاطات).

## 26) أخذ نسخة احتياطية

```bash
cd ~/novahost-repo/novahost

scripts/backup.sh                    # إلى data/storage/backups/
scripts/backup.sh --to-downloads     # + نسخة في مجلد التنزيلات
```

النسخة تحتوي: قاعدة البيانات (عبر `VACUUM INTO`، وهي الطريقة الوحيدة الآمنة
أثناء التشغيل) + كل ملفات المواقع والنشرات + الإعدادات.

**لا تحتوي** `.env` ولا مفاتيح النفق — الأسرار لا تدخل النسخ الاحتياطية.

**انقلها إلى اللابتوب:**
```powershell
scp -P 8022 u0_a234@192.168.1.XX:~/novahost-repo/novahost/data/storage/backups/*.zip .
```

## 27) الاستعادة

**من اللوحة:** صفحة Backups ← زر **Restore** ← اختر الملف ← اكتب `restore`.

**من الطرفية:**
```bash
cd ~/novahost-repo/novahost
node backend/src/cli.js restore /path/to/backup-2026-09-16T10-24-10-8smp.zip
scripts/restart.sh
```

الاستعادة **تأخذ نسخة أمان من حالتك الحالية أولاً**، وتُبقي القديم جانباً حتى
بعد النجاح — التراجع اليدوي ممكن دائماً.

## 28) ماذا أفعل إذا توقف السيرفر

**بالترتيب:**

```bash
cd ~/novahost-repo/novahost

# 1. هل يعمل أصلاً؟
scripts/status.sh

# 2. ما آخر شيء قاله؟
scripts/logs.sh server -n 50

# 3. فحص شامل
node backend/src/cli.js doctor

# 4. أعد التشغيل
scripts/restart.sh
```

| العرض | السبب الأرجح | الحل |
|---|---|---|
| توقف بعد دقائق من إطفاء الشاشة | إعدادات البطارية | القسم 17، وتحقق من إشعار wake lock |
| `Port 8080 is already in use` | نسخة تعمل بالفعل | `scripts/stop.sh` ثم `scripts/start.sh` |
| `SESSION_SECRET is empty` | `.env` ناقص | القسم 9 |
| لا يصل من اللابتوب لكن `curl localhost` ينجح | شبكة | `HOST=0.0.0.0`؟ نفس الواي فاي؟ AP Isolation في الراوتر؟ |
| `pkg install` يفشل | مرآة سيئة | `termux-change-repo` ثم `pkg update` |
| `disk: low` في doctor | التخزين ممتلئ | صفحة Server ← Run cleanup |
| البطارية/الحرارة «غير متاح» | Termux:API غير مثبت | القسم 3 — أو الجهاز لا يصرّح بها |
| الشبكة «غير متاح» | **طبيعي** | أندرويد 10+ يحجب `/proc/net/dev` |

## 29) ماذا أفعل بعد إعادة تشغيل الهاتف

**إن كان القسم 16 مضبوطاً: لا شيء.** انتظر دقيقة وافتح اللوحة.

**للتحقق:**
```bash
cd ~/novahost-repo/novahost && scripts/status.sh
```

**إن لم يعمل تلقائياً:**

```bash
# تشغيل يدوي
cd ~/novahost-repo/novahost && scripts/start.sh

# ثم شخّص السبب:
ls -la ~/.termux/boot/novahost          # موجود وقابل للتنفيذ؟
cat ~/.termux/boot/novahost             # المسار صحيح؟
```

الأسباب الثلاثة الممكنة، بالترتيب:
1. **لم تفتح تطبيق Termux:Boot ولو مرة** ← افتحه الآن وأعد تشغيل الهاتف
2. **تحسين البطارية يمنعه** ← القسم 17، وشمل Termux:Boot نفسه
3. **المسار في السكربت خاطئ** ← صحّحه وتحقق بـ`ls`

بياناتك آمنة في الحالات الثلاث: كل شيء في `data/` على تخزين Termux الداخلي
ولا يتأثر بإعادة التشغيل.

---

## قائمة تحقق نهائية

```
□ Termux من F-Droid أو GitHub (ليس Play Store)
□ Termux:Boot مثبّت ومفتوح مرة واحدة
□ Termux:API مثبّت
□ node -v ≥ v22.5.0
□ .env فيه SESSION_SECRET وHOST=0.0.0.0
□ node backend/src/cli.js migrate نجح
□ حساب مدير مُنشأ
□ scripts/start.sh يعمل
□ curl http://localhost:8080/health يرد ok
□ إشعار wake lock ظاهر
□ بطارية Termux + Termux:Boot + Termux:API = غير مقيّد
□ Wi-Fi يبقى مشغّلاً أثناء السكون
□ IP محجوز في الراوتر
□ الوصول من اللابتوب يعمل
□ الوصول من الآيفون يعمل
□ ~/.termux/boot/novahost موجود وقابل للتنفيذ
□ أعدتُ تشغيل الهاتف فعلاً وعاد السيرفر وحده
□ أخذتُ نسخة احتياطية ونقلتها إلى اللابتوب
```
