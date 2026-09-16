#!/data/data/com.termux/files/usr/bin/bash
# Restart NOVA HOST.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
"$SCRIPT_DIR/stop.sh"
sleep 1
exec "$SCRIPT_DIR/start.sh" "$@"
