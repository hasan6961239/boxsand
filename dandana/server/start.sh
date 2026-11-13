#!/usr/bin/env bash
# دندنة — تشغيل الخادم على ماك أو لينكس.
# أول مرة: يجهّز بيئة بايثون ويثبّت المتطلبات. بعدها: يشغّل مباشرة.
set -e
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null; then
  echo "ثبّت Python 3 أولاً: https://www.python.org/downloads/"; exit 1
fi
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
. .venv/bin/activate
pip install -q --upgrade pip
pip install -q --upgrade -r requirements.txt

command -v ffmpeg >/dev/null || echo "تنبيه: ffmpeg غير مثبت (ماك: brew install ffmpeg)"
command -v deno   >/dev/null || echo "تنبيه: deno غير مثبت (ماك: brew install deno) — بدونه قد يفشل تحميل يوتيوب"

exec python server.py
