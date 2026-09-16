#!/data/data/com.termux/files/usr/bin/bash
# Shared helpers for the NOVA HOST scripts.
# Sourced by the others; not meant to be run on its own.

set -uo pipefail

# Resolve the project root from this script's own location, so every script
# works no matter which directory you call it from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RUN_DIR="$ROOT_DIR/data/run"
PID_FILE="$RUN_DIR/novahost.pid"
SUPERVISOR_PID_FILE="$RUN_DIR/supervisor.pid"
LOG_DIR="$ROOT_DIR/data/logs"
SERVER_LOG="$LOG_DIR/server.log"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[36m'
else
  C_RESET=; C_DIM=; C_RED=; C_GREEN=; C_YELLOW=; C_BLUE=
fi

info()  { printf '%s\n' "${C_BLUE}==>${C_RESET} $*"; }
ok()    { printf '%s\n' "${C_GREEN}ok ${C_RESET} $*"; }
warn()  { printf '%s\n' "${C_YELLOW}warn${C_RESET} $*" >&2; }
die()   { printf '%s\n' "${C_RED}error${C_RESET} $*" >&2; exit 1; }
dim()   { printf '%s\n' "${C_DIM}$*${C_RESET}"; }

ensure_dirs() {
  mkdir -p "$RUN_DIR" "$LOG_DIR"
}

# Read a port from .env, falling back to the documented default.
env_value() {
  local key="$1" fallback="$2"
  local value=""
  if [ -f "$ROOT_DIR/.env" ]; then
    value="$(grep -E "^${key}=" "$ROOT_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
  fi
  printf '%s' "${value:-$fallback}"
}

# True when a pid file points at a process that is actually alive. A stale pid
# file after a reboot is the normal case on a phone, not an error.
is_running() {
  local pid_file="$1"
  [ -f "$pid_file" ] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

read_pid() {
  cat "$1" 2>/dev/null || true
}

require_node() {
  command -v node >/dev/null 2>&1 || die "node is not installed. Run: pkg install nodejs"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt 22 ]; then
    die "Node $major is too old — NOVA HOST needs Node 22.5 or newer (24 recommended). Run: pkg upgrade nodejs"
  fi
}

health_url() {
  printf 'http://127.0.0.1:%s/health' "$(env_value PORT 8080)"
}

# Poll /health until it answers or the timeout expires.
wait_for_health() {
  local timeout="${1:-30}" url
  url="$(health_url)"
  local i=0
  while [ "$i" -lt "$timeout" ]; do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then return 0; fi
    else
      # curl is not installed by default everywhere; Node always is here.
      if node -e "fetch('$url').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
        return 0
      fi
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}
