#!/data/data/com.termux/files/usr/bin/bash
# Start NOVA HOST under the supervisor, in the background.
#
#   scripts/start.sh            start supervised (restarts on crash)
#   scripts/start.sh --foreground   run in this terminal, Ctrl+C to stop

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ensure_dirs
require_node
cd "$ROOT_DIR" || die "cannot enter $ROOT_DIR"

[ -f .env ] || die ".env is missing. Copy it first:  cp .env.example .env  and set SESSION_SECRET."

if grep -qE '^SESSION_SECRET=\s*$' .env 2>/dev/null; then
  die "SESSION_SECRET is empty in .env.
Generate one with:
  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
fi

if [ "${1:-}" = "--foreground" ] || [ "${1:-}" = "-f" ]; then
  info "starting in the foreground (Ctrl+C to stop)"
  exec node backend/src/server.js
fi

if is_running "$SUPERVISOR_PID_FILE"; then
  warn "already running (supervisor pid $(read_pid "$SUPERVISOR_PID_FILE"))"
  exit 0
fi

# Hold a wake lock so Android does not freeze the process once the screen goes
# off. Without this the server stops responding within minutes — it is the
# single most important line in this file.
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock && ok "wake lock acquired"
else
  warn "termux-wake-lock not found — Android will suspend the server when the screen turns off"
fi

info "starting supervisor"
nohup "$SCRIPT_DIR/supervise.sh" >>"$SERVER_LOG" 2>&1 &
echo $! > "$SUPERVISOR_PID_FILE"
disown 2>/dev/null || true

info "waiting for the server to answer /health"
if wait_for_health 30; then
  ok "NOVA HOST is up"
  printf '\n'
  dim "  dashboard : http://127.0.0.1:$(env_value PORT 8080)"
  dim "  sites     : http://127.0.0.1:$(env_value SITES_PORT 8081)"
  dim "  logs      : scripts/logs.sh"
  printf '\n'
  "$SCRIPT_DIR/status.sh"
else
  warn "the server did not become healthy in 30s — last log lines:"
  tail -n 25 "$SERVER_LOG" 2>/dev/null
  exit 1
fi
