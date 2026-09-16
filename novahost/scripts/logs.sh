#!/data/data/com.termux/files/usr/bin/bash
# Tail the logs.
#
#   scripts/logs.sh          follow today's application log
#   scripts/logs.sh server   follow the supervisor / stdout log
#   scripts/logs.sh -n 200   show the last 200 lines and exit

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

target="app"
lines=""
follow=1

while [ $# -gt 0 ]; do
  case "$1" in
    server) target="server"; shift ;;
    app) target="app"; shift ;;
    -n) lines="$2"; follow=0; shift 2 ;;
    *) shift ;;
  esac
done

if [ "$target" = "server" ]; then
  file="$SERVER_LOG"
else
  file="$LOG_DIR/app-$(date +%Y-%m-%d).log"
fi

[ -f "$file" ] || die "no log file yet at $file"

if [ "$follow" -eq 1 ]; then
  info "following $file (Ctrl+C to stop)"
  exec tail -n 50 -f "$file"
else
  exec tail -n "$lines" "$file"
fi
