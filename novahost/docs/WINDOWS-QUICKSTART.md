# التشغيل على Windows — قبل الانتقال إلى الهاتف

الهدف: دورة كاملة على HP Victus بلا لمس الهاتف إطلاقاً.

---

## المتطلب الوحيد

**Node.js 22.5 أو أحدث** (24 مُفضَّل) من [nodejs.org](https://nodejs.org).

```powershell
node -v
```

**لا يوجد `npm install`.** المشروع بلا تبعيات.

---

## ثلاث خطوات

```powershell
cd novahost
.\scripts\dev.ps1 setup
.\scripts\dev.ps1 start
```

إن رفضت PowerShell تشغيل السكربت:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

افتح `http://localhost:8080`.

---

## الدورة الكاملة — جرّبها بالترتيب

### 1. الإعداد الأول
تظهر شاشة **إعداد أول مرة**. أنشئ حساباً — ١٠ أحرف على الأقل لكلمة المرور.
هذه الشاشة تُغلق نفسها بعد أول حساب.

### 2. مشروع جديد
`New Project` ← اكتب اسماً (جرّب اسماً عربياً — سيولّد slug إنجليزياً تلقائياً)
← `Create`.

### 3. جهّز ملف ZIP للتجربة

```powershell
mkdir test-site\images
cd test-site

@'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My First Site</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1 id="title">Hello from NOVA HOST</h1>
  <p>Served from my own machine.</p>
  <script src="script.js"></script>
</body>
</html>
'@ | Set-Content -Encoding UTF8 index.html

@'
body { font-family: system-ui; background:#0b1020; color:#e8ecf5;
       display:grid; place-items:center; min-height:100vh; margin:0; }
h1 { color:#6d84ff; }
'@ | Set-Content -Encoding UTF8 style.css

'document.getElementById("title").textContent += " ✓";' |
  Set-Content -Encoding UTF8 script.js

cd ..
Compress-Archive -Path test-site\* -DestinationPath test-site.zip -Force
```

> `Compress-Archive` يضغط **محتويات** المجلد لأننا استخدمنا `test-site\*`.
> لو ضغطت المجلد نفسه (`-Path test-site`) فسيكتشف النظام الجذر تلقائياً
> ويزيل الغلاف — كلا الشكلين يعمل.

### 4. الرفع والنشر
افتح المشروع ← تبويب **Deployments** ← اسحب `test-site.zip` أو اضغط للاختيار.

سترى المراحل: رفع ← فك ضغط وتحقق ← نشر ← **تم النشر بنجاح**.

### 5. افتح الموقع
اضغط **فتح الموقع**. يفتح على `http://localhost:8081/s/<slug>/`.

> **منفذ مختلف عن اللوحة عن قصد.** منفذ مختلف = أصل مختلف في المتصفح، فلا
> يستطيع أي موقع ترفعه قراءة جلسة لوحة التحكم أو مناداة الـAPI.

### 6. عدّل ملفاً
تبويب **Files** ← اضغط `index.html` ← يفتح المحرر بتلوين نحوي.
غيّر النص ← `Ctrl+S` أو زر **حفظ**.

**افتح الموقع الآن: لم يتغيّر.** هذا مقصود — التعديلات في نسخة عمل.

### 7. انشر التعديل
اضغط **نشر التعديلات**. الآن افتح الموقع → التعديل ظاهر، ورقم نشر جديد.

### 8. تراجع
تبويب **Deployments** ← اضغط زر الرجوع عند النسخة الأولى ← أكّد.
الموقع يعود فوراً للنسخة القديمة. **بلا إعادة رفع** — مجرد تبديل مؤشر.

### 9. جرّب الفشل
ارفع ملفاً ليس ZIP، أو ZIP بلا `index.html`.
**سيُرفض برسالة واضحة، والموقع المنشور لن يتأثر إطلاقاً.**

### 10. نسخة احتياطية واستعادة
`Backups` ← **إنشاء نسخة** ← نزّلها.
ثم احذف مشروعاً، ثم **Restore** وارفع النسخة ← اكتب `restore` ← سيعود كل شيء.

---

## الاختبارات

```powershell
.\scripts\dev.ps1 test
```

المتوقع: `# pass 136` و`# fail 0`.

---

## أوامر مفيدة

```powershell
.\scripts\dev.ps1 status    # الإعدادات + فحص صحة
.\scripts\dev.ps1 dev       # تشغيل مع إعادة تحميل عند تعديل الكود
.\scripts\dev.ps1 backup    # نسخة احتياطية
.\scripts\dev.ps1 reset     # حذف data/ والبدء من جديد
```

---

## الاختبار من الآيفون على نفس الواي فاي

1. اعرف عنوان اللابتوب:
   ```powershell
   ipconfig | Select-String IPv4
   ```
2. اسمح للمنفذين في جدار حماية ويندوز (مرة واحدة، PowerShell كمسؤول):
   ```powershell
   New-NetFirewallRule -DisplayName "NOVA HOST panel" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
   New-NetFirewallRule -DisplayName "NOVA HOST sites" -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow
   ```
3. من الآيفون: `http://192.168.1.XX:8080`

---

## ما الذي يختلف على الهاتف

| | ويندوز | Samsung |
|---|---|---|
| كل وظائف المنصة | ✅ | ✅ |
| البطارية والحرارة | «غير متاح» | ✅ مع Termux:API |
| إصدار أندرويد واسم الجهاز | «غير متاح» | ✅ |
| إحصاءات الشبكة | ✅ | «غير متاح» (أندرويد ١٠+ يحجبها) |
| الإقلاع التلقائي | — | Termux:Boot |

**السلوك متطابق فيما عدا ذلك.** إن عملت الدورة هنا، ستعمل هناك.

الخطوة التالية: [ANDROID-SERVER-SETUP.md](ANDROID-SERVER-SETUP.md).
