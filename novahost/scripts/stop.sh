#!/data/data/com.termux/files/usr/bin/bash
# Stop NOVA HOST and its supervisor.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

stopped=0

# The supervisor first, so it does not restart the server we are about to stop.
if is_running "$SUPERVISOR_PID_FILE"; then
  pid="$(read_pid "$SUPERVISOR_PID_FILE")"
  kill "$pid" 2>/dev/null && ok "supervisor stopped (pid $pid)"
  stopped=1
fi
rm -f "$SUPERVISOR_PID_FILE"

if is_running "$PID_FILE"; then
  pid="$(read_pid "$PID_FILE")"
  kill "$pid" 2>/dev/null
  # Give it a moment to checkpoint the database and close cleanly.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "server did not exit in 5s, forcing"
    kill -9 "$pid" 2>/dev/null
  fi
  ok "server stopped (pid $pid)"
  stopped=1
fi
rm -f "$PID_FILE"

if command -v termux-wake-unlock >/dev/null 2>&1; then
  termux-wake-unlock && ok "wake lock released"
fi

[ "$stopped" -eq 0 ] && info "nothing was running"
exit 0
