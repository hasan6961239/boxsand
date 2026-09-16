#!/data/data/com.termux/files/usr/bin/bash
# Stability recorder for the 24-hour and 48-hour tests.
#
#   scripts/monitor.sh start [--interval 300]   record in the background
#   scripts/monitor.sh once                     write a single row now
#   scripts/monitor.sh report                   summarise what was recorded
#   scripts/monitor.sh stop                     stop recording
#
# Every reading is taken from the running system. Where Android refuses to
# expose one — battery without Termux:API, thermal zones on a locked-down
# build — the column says Unavailable. Nothing here is estimated or filled in.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
ensure_dirs

CSV="$LOG_DIR/stability.csv"
MONITOR_PID_FILE="$RUN_DIR/monitor.pid"
STATE_FILE="$RUN_DIR/monitor.state"
INTERVAL=300

# One reading, as a CSV line. systemStats() is the same function the dashboard
# calls, imported directly: no database is opened, so recording cannot slow
# down or lock anything the server is doing.
sample() {
  node --input-type=module -e "
    import { systemStats } from '$ROOT_DIR/backend/src/services/stats.js';
    const n = (v) => (v === null || v === undefined ? 'Unavailable' : v);
    const s = await systemStats();
    const health = await fetch('$(health_url)', { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? 'up' : 'http' + r.status))
      .catch(() => 'down');
    const addr = (s.host?.addresses ?? []).map((a) => a.address).join('|') || 'Unavailable';
    console.log([
      new Date().toISOString(),
      health,
      n(s.uptime?.processSeconds),
      n(s.uptime?.systemSeconds),
      n(s.cpu?.usagePercent),
      n(s.memory?.usedPercent),
      n(s.storage?.usedPercent),
      n(s.battery?.percentage),
      n(s.temperature?.celsius),
      addr,
    ].join(','));
  " 2>/dev/null
}

write_header() {
  [ -s "$CSV" ] && return 0
  printf 'timestamp,health,process_uptime_s,system_uptime_s,cpu_percent,mem_percent,disk_percent,battery_percent,temperature_c,addresses\n' > "$CSV"
}

case "${1:-}" in
  once)
    write_header
    row="$(sample)"
    [ -n "$row" ] || die "could not read the system statistics"
    printf '%s\n' "$row" >> "$CSV"
    ok "recorded to $CSV"
    printf '%s\n' "$row"
    ;;

  start)
    shift
    [ "${1:-}" = "--interval" ] && INTERVAL="${2:-300}"
    if is_running "$MONITOR_PID_FILE"; then
      warn "already recording (pid $(read_pid "$MONITOR_PID_FILE"))"
      exit 0
    fi
    write_header
    # The loop runs detached so closing Termux does not end the test. The wake
    # lock the server already holds keeps this alive too. SCRIPT_DIR is
    # absolute, so the loop does not depend on the directory it was started
    # from or on how the script was invoked.
    nohup bash "$SCRIPT_DIR/monitor.sh" __loop "$INTERVAL" >/dev/null 2>&1 &
    echo $! > "$MONITOR_PID_FILE"
    disown 2>/dev/null || true
    ok "recording every ${INTERVAL}s to $CSV"
    dim "  stop with:    scripts/monitor.sh stop"
    dim "  summarise:    scripts/monitor.sh report"
    ;;

  __loop)
    # Internal: the body of `start`. Not documented in the usage line because
    # running it by hand would record without a pid file to stop it by.
    interval="${2:-300}"
    while true; do
      write_header
      row="$(sample)"
      [ -n "$row" ] && printf '%s\n' "$row" >> "$CSV"
      sleep "$interval"
    done
    ;;

  stop)
    if is_running "$MONITOR_PID_FILE"; then
      kill "$(read_pid "$MONITOR_PID_FILE")" 2>/dev/null
      ok "recording stopped"
    else
      info "nothing was recording"
    fi
    rm -f "$MONITOR_PID_FILE" "$STATE_FILE"
    ;;

  report)
    [ -f "$CSV" ] || die "no recording yet at $CSV — run: scripts/monitor.sh start"
    awk -F, '
      NR == 1 { next }
      {
        rows++
        if ($2 == "up") up++; else { downs++; down_at = down_at (down_at ? " " : "") $1 }
        if (first == "") first = $1
        last = $1
        # A process uptime that went backwards means the server restarted
        # between two samples. That is the number this whole test exists to
        # find, so it is counted rather than smoothed over.
        if ($3 != "Unavailable") {
          if (prev_proc != "" && $3 + 0 < prev_proc + 0) { restarts++; restart_at = restart_at (restart_at ? " " : "") $1 }
          prev_proc = $3
        }
        if ($4 != "Unavailable") {
          if (prev_sys != "" && $4 + 0 < prev_sys + 0) reboots++
          prev_sys = $4
        }
        if ($10 != "Unavailable") {
          if (prev_addr != "" && $10 != prev_addr) { reconnects++ }
          prev_addr = $10
        }
        for (c = 5; c <= 9; c++) {
          if ($c == "Unavailable") { unavail[c]++; continue }
          n[c]++; sum[c] += $c
          if (n[c] == 1 || $c + 0 > max[c] + 0) max[c] = $c
          if (n[c] == 1 || $c + 0 < min[c] + 0) min[c] = $c
        }
      }
      function stat(c, label,   avg) {
        if (n[c] == 0) { printf "  %-14s Unavailable (%d samples)\n", label, unavail[c]; return }
        avg = sum[c] / n[c]
        printf "  %-14s min %-8.1f avg %-8.1f max %-8.1f", label, min[c], avg, max[c]
        if (unavail[c] > 0) printf "  (%d of %d Unavailable)", unavail[c], rows
        printf "\n"
      }
      END {
        if (rows == 0) { print "  no samples recorded yet"; exit }
        printf "\n  samples        %d\n", rows
        printf "  first          %s\n", first
        printf "  last           %s\n", last
        printf "  health up      %d / %d\n", up, rows
        printf "  health down    %d\n", downs + 0
        if (downs > 0) printf "  down at        %s\n", down_at
        printf "  server restarts %d\n", restarts + 0
        if (restarts > 0) printf "  restarted at   %s\n", restart_at
        printf "  phone reboots  %d\n", reboots + 0
        printf "  IP changes     %d\n", reconnects + 0
        printf "\n"
        stat(5, "cpu %")
        stat(6, "memory %")
        stat(7, "disk %")
        stat(8, "battery %")
        stat(9, "temp C")
        printf "\n"
      }
    ' "$CSV"
    ;;

  *)
    printf 'usage: scripts/monitor.sh {start [--interval N]|once|report|stop}\n'
    exit 1
    ;;
esac
