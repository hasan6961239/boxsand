#!/data/data/com.termux/files/usr/bin/bash
# Register NOVA HOST as a real termux-services (runit) service.
#
#   scripts/service-install.sh          install and enable it
#   scripts/service-install.sh --remove uninstall it
#
# After this you manage the server with sv, not with start.sh:
#
#   sv up novahost        start
#   sv down novahost      stop
#   sv restart novahost   restart
#   sv status novahost    is it running, and for how long
#
# Two supervisors, one server: runit here, or scripts/supervise.sh via
# start.sh. Running both would start the server twice and the second would
# die on "port already in use", so this script stops the other one first and
# the boot script picks whichever is installed.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SERVICE_DIR="${PREFIX:-/data/data/com.termux/files/usr}/var/service/novahost"

if [ "${1:-}" = "--remove" ]; then
  [ -d "$SERVICE_DIR" ] || die "no service is installed at $SERVICE_DIR"
  sv down novahost 2>/dev/null
  # Removing the "down" marker is not enough; runsvdir watches the directory.
  rm -rf "$SERVICE_DIR"
  ok "service removed — use scripts/start.sh again"
  exit 0
fi

command -v sv >/dev/null 2>&1 || die "termux-services is not installed. Run:
  pkg install -y termux-services
then close Termux completely and open it again, then run this script."

require_node
[ -f "$ROOT_DIR/.env" ] || die ".env is missing — run scripts/install-termux.sh first"

# A service that starts before the database exists just crash-loops.
[ -f "$ROOT_DIR/data/novahost.db" ] || warn "no database yet — run: node backend/src/cli.js migrate"

if is_running "$SUPERVISOR_PID_FILE"; then
  info "stopping the start.sh supervisor first (only one may run)"
  "$SCRIPT_DIR/stop.sh" >/dev/null 2>&1
fi

mkdir -p "$SERVICE_DIR/log"

# runit expects the run script to stay in the foreground: the process it
# spawns IS the service. exec keeps the pid runit is watching the pid that
# matters, so `sv status` reports the server and not a shell wrapping it.
cat > "$SERVICE_DIR/run" <<RUN
#!/data/data/com.termux/files/usr/bin/sh
exec 2>&1
cd "$ROOT_DIR" || exit 1

# The wake lock has to be re-taken on every start: Android drops it when the
# process that held it goes away.
termux-wake-lock 2>/dev/null

# Tells the server an automatic restart is possible, which is what makes the
# dashboard's Restart button safe to offer — runit brings it straight back.
export NOVAHOST_SUPERVISED=1

exec node backend/src/server.js
RUN
chmod +x "$SERVICE_DIR/run"

# svlogd rotates for us, so the service log cannot fill the phone.
cat > "$SERVICE_DIR/log/run" <<LOGRUN
#!/data/data/com.termux/files/usr/bin/sh
mkdir -p "$LOG_DIR/sv"
exec svlogd -tt "$LOG_DIR/sv"
LOGRUN
chmod +x "$SERVICE_DIR/log/run"

ok "service written to $SERVICE_DIR"

# sv-enable makes it start whenever runsvdir runs; without it the service is
# there but stays down.
if command -v sv-enable >/dev/null 2>&1; then
  sv-enable novahost 2>/dev/null && ok "enabled at startup"
fi

# runsvdir rescans its directory every few seconds, so a brand-new service is
# not manageable the instant it is written. Waiting here avoids an alarming
# "unable to open supervise/ok" on an install that is actually fine.
info "waiting for runit to pick up the service"
i=0
while [ "$i" -lt 15 ]; do
  sv status novahost >/dev/null 2>&1 && break
  sleep 1
  i=$((i + 1))
done

info "starting"
sv up novahost 2>/dev/null

if wait_for_health 30; then
  ok "NOVA HOST is up under runit"
  printf '\n'
  sv status novahost
  printf '\n'
  dim "  start    sv up novahost"
  dim "  stop     sv down novahost"
  dim "  restart  sv restart novahost"
  dim "  status   sv status novahost"
  dim "  logs     tail -f $LOG_DIR/sv/current"
  printf '\n'
else
  warn "the server did not answer /health within 30s. Last log lines:"
  tail -n 25 "$LOG_DIR/sv/current" 2>/dev/null || warn "no service log yet at $LOG_DIR/sv/current"
  exit 1
fi
