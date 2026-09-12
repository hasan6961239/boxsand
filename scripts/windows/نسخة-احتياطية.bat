@echo off
chcp 65001 >nul
title نسخة احتياطية - صيدليتي
cd /d "%~dp0..\.."

set STAMP=%date:~-4%-%date:~3,2%-%date:~0,2%
set DEST=data\backups
if not exist "%DEST%" mkdir "%DEST%"

echo.
echo   جاري نسخ قاعدة البيانات...
copy /Y "data\saydaliyati.db" "%DEST%\نسخة-%STAMP%.db" >nul

if errorlevel 1 (
  echo   [خطأ] فشل النسخ. تأكد أن المنظومة مغلقة ثم أعد المحاولة.
) else (
  echo   تم بنجاح: %DEST%\نسخة-%STAMP%.db
  echo.
  echo   انسخ هذا الملف على فلاش أو جوجل درايف.
)
echo.
pause
