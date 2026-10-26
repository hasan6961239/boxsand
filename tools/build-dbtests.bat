@echo off
REM ============================================================
REM  اختبارات قاعدة البيانات على ويندوز (المرحلة 1)
REM  المترجم المدمج في ويندوز (قرار 0002) وملفا sqlite3.dll اللذان
REM  يُشحنان مع البرنامج: 64 بت (DbTests.exe) و32 بت (DbTests32.exe).
REM
REM    tools\build-dbtests.bat
REM    build\DbTests.exe            كل الاختبارات
REM    build\DbTests.exe crash 150  القتل وسط العمل
REM ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0\.."

set CSC=
if exist "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if "!CSC!"=="" if exist "%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if "!CSC!"=="" (
  echo   [خطأ] لم يُعثر على مترجم C# داخل ويندوز.
  exit /b 1
)

if not exist build\x64 mkdir build\x64
if not exist build\x86 mkdir build\x86
copy /y vendor\sqlite\x64\sqlite3.dll build\x64\ >nul
copy /y vendor\sqlite\x86\sqlite3.dll build\x86\ >nul

set SRC=src\Data\*.cs tests\db\*.cs
set REF=/reference:System.dll /reference:System.Core.dll
"!CSC!" /nologo /optimize+ /out:build\DbTests.exe !REF! !SRC!
if errorlevel 1 exit /b 1
"!CSC!" /nologo /optimize+ /platform:x86 /out:build\DbTests32.exe !REF! !SRC!
if errorlevel 1 exit /b 1
echo   build\DbTests.exe (64 بت) و build\DbTests32.exe (32 بت)
