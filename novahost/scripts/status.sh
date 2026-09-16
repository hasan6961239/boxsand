#!/data/data/com.termux/files/usr/bin/bash
# Show whether NOVA HOST is running, and what it thinks of itself.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$ROOT_DIR" || exit 1

port="$(env_value PORT 8080)"
sites_port="$(env_value SITES_PORT 8081)"

printf '%s\n' "${C_BLUE}NOVA HOST${C_RESET}"
printf '  root        %s\n' "$ROOT_DIR"

if is_running "$SUPERVISOR_PID_FILE"; then
  printf '  supervisor  %srunning%s (pid %s)\n' "$C_GREEN" "$C_RESET" "$(read_pid "$SUPERVISOR_PID_FILE")"
else
  printf '  supervisor  %sstopped%s\n' "$C_DIM" "$C_RESET"
fi

if is_running "$PID_FILE"; then
  pid="$(read_pid "$PID_FILE")"
  printf '  server      %srunning%s (pid %s)\n' "$C_GREEN" "$C_RESET" "$pid"
  # /proc is readable for your own processes even on restricted Android builds.
  if [ -r "/proc/$pid/status" ]; then
    rss="$(awk '/VmRSS/ {print $2 " " $3}' "/proc/$pid/status" 2>/dev/null)"
    [ -n "$rss" ] && printf '  memory      %s\n' "$rss"
  fi
else
  printf '  server      %sstopped%s\n' "$C_RED" "$C_RESET"
fi

printf '  ports       %s (dashboard) · %s (sites)\n' "$port" "$sites_port"

if wait_for_health 1; then
  printf '  health      %sok%s\n' "$C_GREEN" "$C_RESET"
else
  printf '  health      %snot answering%s\n' "$C_RED" "$C_RESET"
fi

# Local addresses, so you know what to type on the iPhone.
addresses="$(node -e '
  const os = require("os");
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  console.log(out.join(" "));
' 2>/dev/null)"
if [ -n "$addresses" ]; then
  printf '\n  reachable at:\n'
  for address in $addresses; do
    printf '    http://%s:%s\n' "$address" "$port"
  done
fi

if command -v cloudflared >/dev/null 2>&1; then
  if pgrep -f 'cloudflared tunnel' >/dev/null 2>&1; then
    printf '\n  tunnel      %srunning%s\n' "$C_GREEN" "$C_RESET"
  else
    printf '\n  tunnel      %snot running%s\n' "$C_DIM" "$C_RESET"
  fi
fi

printf '\n'
node backend/src/cli.js doctor 2>/dev/null || true
