@echo off
chcp 65001 >nul
REM دندنة — تشغيل الخادم على ويندوز
cd /d "%~dp0"
where python >nul 2>nul || (echo Install Python 3 from https://www.python.org/downloads/ & pause & exit /b 1)
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install -q --upgrade pip
python -m pip install -q --upgrade -r requirements.txt
where ffmpeg >nul 2>nul || echo [!] ffmpeg missing: winget install Gyan.FFmpeg
where deno   >nul 2>nul || echo [!] deno missing: winget install DenoLand.Deno
python server.py
pause
