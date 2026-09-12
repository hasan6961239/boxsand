@echo off
chcp 65001 >nul
title منظومة صيدليتي
cd /d "%~dp0..\.."

echo.
echo   ================================================
echo     منظومة صيدليتي - جاري التشغيل
echo   ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [خطأ] لم يتم العثور على Node.js
  echo.
  echo   ثبّت Node.js من الرابط التالي ثم أعد المحاولة:
  echo   https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   أول تشغيل - جاري تجهيز المنظومة، انتظر قليلاً...
  call npm install --omit=dev
  if errorlevel 1 (
    echo   [خطأ] فشل التجهيز. تأكد من الاتصال بالإنترنت في هذه الخطوة فقط.
    pause
    exit /b 1
  )
)

if not exist "data\saydaliyati.db" (
  echo   جاري إنشاء قاعدة البيانات...
  call node server/seed.js
)

echo   المنظومة تعمل الآن. سيفتح المتصفح تلقائياً.
echo   لإيقافها: أغلق هذه النافذة.
echo.

start "" http://localhost:3000
node server/index.js

pause
