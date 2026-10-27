@echo off
REM ============================================================
REM  بناء منظومة المكتبة والقرطاسية
REM  شغّله بالنقر عليه مرتين على أي جهاز ويندوز.
REM  لا يحتاج تنصيب أي برنامج — مترجم C# موجود داخل ويندوز نفسه.
REM
REM   build.bat              ->  يبني الفرع الأول (مصراتة)
REM   build.bat tripoli 2    ->  يبني تطبيق طرابلس: اسمه ولونه ومجلد بياناته (قرار 0022)
REM ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

set BRANCH=%1
set NUMBER=%2
if "%BRANCH%"=="" set BRANCH=misrata
if "%NUMBER%"=="" set NUMBER=1
REM تطبيقان منفصلان: طرابلس بأيقونتها البنفسجية، وكل فرع آخر بتطبيق مصراتة
set EDITION=misrata
set ICO=app\app.ico
set PNG=app\icon.png
if /i "%BRANCH%"=="tripoli" (
  set EDITION=tripoli
  set ICO=app\app-tripoli.ico
  set PNG=app\icon-tripoli.png
)

echo.
echo   بناء منظومة القرطاسية — الفرع: %BRANCH% (رقم %NUMBER%)
echo   ============================================================
echo.

REM --- إيجاد مترجم C# داخل ويندوز ---
REM مترجم .NET 4 وحده: الكود يحتاجه. كانت القائمة (v4.0.30319 v3.5) وآخر
REM موجود يغلب، فإن كان .NET 3.5 مثبّتاً أيضاً (شائع في ويندوز 10) اختير
REM مترجمه القديم وفشل البناء بأخطاء لا تدل على السبب.
set CSC=
if exist "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if "!CSC!"=="" if exist "%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
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
set RES=!RES! /resource:!PNG!,icon.png
REM كود الـWorker يُنسخ من داخل البرنامج، فيبقى أصلاً واحداً لا نسختين
set RES=!RES! /resource:cloud\worker.js,worker.js
for %%f in (jsbarcode core inventory branches notify consign count sales people stale labels reports) do (
  set RES=!RES! /resource:app\js\%%f.js,js/%%f.js
)
REM واجهة 4.0 (قرار 0021): كل ما في app\v4 باسم v4/<الملف>
for %%f in (app\v4\*) do set RES=!RES! /resource:%%f,v4/%%~nxf

REM --- ختم تاريخ البناء، ليعرف صاحب المحل أي نسخة يشغّل ---
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set STAMP=%%d
> src\BuildInfo.cs echo namespace Qirtasiya { static class BuildInfo { public const string Stamp = "!STAMP!"; public const string Edition = "!EDITION!"; } }

echo   يبني... (بناء !STAMP!)
"!CSC!" /nologo /target:winexe /optimize+ /out:%OUT% ^
  /win32icon:!ICO! ^
  /reference:System.dll /reference:System.Drawing.dll ^
  /reference:System.Windows.Forms.dll /reference:System.Core.dll ^
  /reference:vendor\webview2\Microsoft.Web.WebView2.Core.dll /reference:vendor\webview2\Microsoft.Web.WebView2.WinForms.dll ^
  !RES! ^
  src\Program.cs src\AppWindow.cs src\BuildInfo.cs src\Data\*.cs src\Engine\*.cs

if errorlevel 1 (
  echo.
  echo   [خطأ] فشل البناء — راجع الرسائل أعلاه.
  pause
  exit /b 1
)

REM --- مكتبة SQLite بجانب البرنامج (للقاعدة الجديدة؛ لا تُحمَّل بدونها) ---
if not exist build\x64 mkdir build\x64
if not exist build\x86 mkdir build\x86
copy /y vendor\sqlite\x64\sqlite3.dll build\x64\ >nul
copy /y vendor\sqlite\x86\sqlite3.dll build\x86\ >nul

REM --- نافذة البرنامج (WebView2): ملفان بجانبه، والمحمِّل لكل معمارية ---
copy /y vendor\webview2\Microsoft.Web.WebView2.Core.dll build\ >nul
copy /y vendor\webview2\Microsoft.Web.WebView2.WinForms.dll build\ >nul
copy /y vendor\webview2\x64\WebView2Loader.dll build\x64\ >nul
copy /y vendor\webview2\x86\WebView2Loader.dll build\x86\ >nul

REM --- ملف الإعداد المسبق للفرع ---
> build\preset.json echo {"branch":{"id":"%BRANCH%","no":%NUMBER%}}

echo.
echo   ============================================================
echo   تم. الملف جاهز:  %OUT%
echo.
echo   للتشغيل: انقر عليه مرتين.
echo   ============================================================
echo.
pause
