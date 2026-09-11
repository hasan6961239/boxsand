@echo off
REM ============================================================
REM  بناء منظومة المكتبة والقرطاسية
REM  شغّله بالنقر عليه مرتين على أي جهاز ويندوز.
REM  لا يحتاج تنصيب أي برنامج — مترجم C# موجود داخل ويندوز نفسه.
REM
REM   build.bat              ->  يبني الفرع الأول (مصراتة)
REM   build.bat tripoli 2    ->  يبني فرعاً ثانياً برمز ومدينة مختلفين
REM ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

set BRANCH=%1
set NUMBER=%2
if "%BRANCH%"=="" set BRANCH=misrata
if "%NUMBER%"=="" set NUMBER=1

echo.
echo   بناء منظومة القرطاسية — الفرع: %BRANCH% (رقم %NUMBER%)
echo   ============================================================
echo.

REM --- إيجاد مترجم C# داخل ويندوز ---
set CSC=
for %%v in (v4.0.30319 v3.5) do (
  if exist "%WINDIR%\Microsoft.NET\Framework64\%%v\csc.exe" set CSC=%WINDIR%\Microsoft.NET\Framework64\%%v\csc.exe
)
if "!CSC!"=="" (
  for %%v in (v4.0.30319 v3.5) do (
    if exist "%WINDIR%\Microsoft.NET\Framework\%%v\csc.exe" set CSC=%WINDIR%\Microsoft.NET\Framework\%%v\csc.exe
  )
)
if "!CSC!"=="" (
  echo   [خطأ] لم يُعثر على مترجم C# داخل ويندوز.
  echo   ثبّت .NET Framework 4 من موقع مايكروسوفت ثم أعد المحاولة.
  pause
  exit /b 1
)
echo   المترجم: !CSC!

if not exist build mkdir build
set OUT=build\Qirtasiya-%NUMBER%.exe

REM --- الواجهة تُدمج داخل الملف التنفيذي، فلا ملفات جانبية يعبث بها أحد ---
set RES=/resource:app\index.html,index.html
set RES=!RES! /resource:app\styles.css,styles.css
set RES=!RES! /resource:app\icon.png,icon.png
for %%f in (core inventory branches notify consign count sales people reports) do (
  set RES=!RES! /resource:app\js\%%f.js,js/%%f.js
)

echo   يبني...
"!CSC!" /nologo /target:winexe /optimize+ /out:%OUT% ^
  /win32icon:app\app.ico ^
  /reference:System.dll /reference:System.Drawing.dll ^
  /reference:System.Windows.Forms.dll /reference:System.Core.dll ^
  !RES! ^
  src\Program.cs

if errorlevel 1 (
  echo.
  echo   [خطأ] فشل البناء — راجع الرسائل أعلاه.
  pause
  exit /b 1
)

REM --- ملف الإعداد المسبق للفرع ---
> build\preset.json echo {"branch":{"id":"%BRANCH%","no":%NUMBER%}}

echo.
echo   ============================================================
echo   تم. الملف جاهز:  %OUT%
echo.
echo   للتشغيل: انقر عليه مرتين.
echo   لبناء المثبّت: افتح installer\qirtasiya.nsi ببرنامج NSIS.
echo   ============================================================
echo.
pause
