#!/usr/bin/env bash
# تشغيل/إيقاف خادم التطوير عبر ملف PID (بدون pkill حتى لا يقتل الصدفة نفسها)
PIDF=/tmp/sayd.pid
case "${1:-start}" in
  stop)
    [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; echo "متوقف";;
  start)
    [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null; sleep 0.6
    cd "$(dirname "$0")/.." || exit 1
    PORT="${PORT:-3111}" nohup node server/index.js > /tmp/sayd.log 2>&1 &
    echo $! > "$PIDF"
    for i in $(seq 1 30); do
      curl -s -o /dev/null "http://localhost:${PORT:-3111}/api/health" 2>/dev/null && { echo "يعمل على المنفذ ${PORT:-3111}"; exit 0; }
      sleep 0.4
    done
    echo "فشل التشغيل"; tail -20 /tmp/sayd.log; exit 1;;
esac
