#!/data/data/com.termux/files/usr/bin/bash
# Keep the server running.
#
# Android will stop processes: low memory, thermal pressure, the system killer,
# a crash. This loop restarts the server when that happens, with a backoff so a
# configuration error does not turn into a restart storm that flattens the
# battery.
#
# Run by start.sh; you normally do not call this directly.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ensure_dirs
cd "$ROOT_DIR" || exit 1

# Tells the server that an automatic restart is possible, which is what makes
# the dashboard's Restart button safe to offer.
export NOVAHOST_SUPERVISED=1

backoff=2
MAX_BACKOFF=60

cleanup() {
  local pid
  pid="$(read_pid "$PID_FILE")"
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
  rm -f "$PID_FILE" "$SUPERVISOR_PID_FILE"
  exit 0
}
trap cleanup TERM INT

while true; do
  printf '%s supervisor: starting server\n' "$(date -Iseconds)"

  node backend/src/server.js &
  child=$!
  echo "$child" > "$PID_FILE"

  # A run that lasted a while was healthy; reset the backoff so the next
  # unrelated crash restarts promptly instead of waiting a minute.
  started=$(date +%s)
  wait "$child"
  code=$?
  ended=$(date +%s)
  ran=$((ended - started))

  rm -f "$PID_FILE"

  if [ "$code" -eq 0 ] && [ "$ran" -gt 5 ]; then
    printf '%s supervisor: server exited cleanly, restarting\n' "$(date -Iseconds)"
    backoff=2
    sleep 1
    continue
  fi

  if [ "$ran" -gt 60 ]; then
    backoff=2
  else
    backoff=$((backoff * 2))
    [ "$backoff" -gt "$MAX_BACKOFF" ] && backoff=$MAX_BACKOFF
  fi

  printf '%s supervisor: server exited with code %s after %ss, retrying in %ss\n' \
    "$(date -Iseconds)" "$code" "$ran" "$backoff"
  sleep "$backoff"
done
