#!/data/data/com.termux/files/usr/bin/bash
# Cloudflare Tunnel helper.
#
#   scripts/tunnel.sh quick      temporary public URL, no account, no domain
#   scripts/tunnel.sh run <name> run a named tunnel you already configured
#   scripts/tunnel.sh status     is a tunnel running?
#   scripts/tunnel.sh stop       stop it
#
# Full setup instructions are in docs/NETWORKING.md.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
ensure_dirs

TUNNEL_LOG="$LOG_DIR/tunnel.log"
TUNNEL_PID_FILE="$RUN_DIR/tunnel.pid"

command -v cloudflared >/dev/null 2>&1 || die "cloudflared is not installed. Run: pkg install cloudflared

Do not download the binary from Cloudflare's GitHub releases — those builds are
linked against glibc and will not run on Android."

port="$(env_value PORT 8080)"

case "${1:-}" in
  quick)
    info "starting a quick tunnel to http://localhost:$port"
    dim "The URL is random and changes every time this restarts."
    dim "Cloudflare documents quick tunnels as unsuitable for production."
    printf '\n'
    nohup cloudflared tunnel --no-autoupdate --url "http://localhost:$port" >"$TUNNEL_LOG" 2>&1 &
    echo $! > "$TUNNEL_PID_FILE"
    disown 2>/dev/null || true

    info "waiting for the public URL"
    for _ in $(seq 1 30); do
      url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)"
      if [ -n "$url" ]; then
        printf '\n'
        ok "public URL: $url"
        printf '\n'
        dim "Open it on the iPhone over mobile data to confirm it works from outside your home."
        dim "Set PUBLIC_URL in .env to this address, then: scripts/restart.sh"
        exit 0
      fi
      sleep 1
    done
    warn "no URL appeared within 30s; check $TUNNEL_LOG"
    exit 1
    ;;

  run)
    name="${2:-}"
    [ -n "$name" ] || die "usage: scripts/tunnel.sh run <tunnel-name>"
    info "starting named tunnel: $name"
    nohup cloudflared tunnel --no-autoupdate run "$name" >"$TUNNEL_LOG" 2>&1 &
    echo $! > "$TUNNEL_PID_FILE"
    disown 2>/dev/null || true
    sleep 3
    if is_running "$TUNNEL_PID_FILE"; then
      ok "tunnel running (pid $(read_pid "$TUNNEL_PID_FILE"))"
      dim "logs: tail -f $TUNNEL_LOG"
    else
      warn "tunnel exited immediately — last lines:"
      tail -n 20 "$TUNNEL_LOG"
      exit 1
    fi
    ;;

  status)
    if is_running "$TUNNEL_PID_FILE"; then
      ok "tunnel running (pid $(read_pid "$TUNNEL_PID_FILE"))"
      url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1)"
      [ -n "$url" ] && dim "  $url"
    else
      info "no tunnel is running"
    fi
    ;;

  stop)
    if is_running "$TUNNEL_PID_FILE"; then
      kill "$(read_pid "$TUNNEL_PID_FILE")" 2>/dev/null
      ok "tunnel stopped"
    else
      info "no tunnel was running"
    fi
    rm -f "$TUNNEL_PID_FILE"
    ;;

  *)
    printf 'usage: scripts/tunnel.sh {quick|run <name>|status|stop}\n'
    exit 1
    ;;
esac
