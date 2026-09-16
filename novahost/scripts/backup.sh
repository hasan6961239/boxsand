#!/data/data/com.termux/files/usr/bin/bash
# Create a backup, and optionally copy it to shared storage so it survives
# uninstalling Termux.
#
#   scripts/backup.sh
#   scripts/backup.sh --to-downloads

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$ROOT_DIR" || exit 1
require_node

info "creating backup"
output="$(node backend/src/cli.js backup)" || die "backup failed"
printf '%s\n' "$output"

file="$(printf '%s\n' "$output" | grep -E '\.zip$' | head -1)"

if [ "${1:-}" = "--to-downloads" ]; then
  [ -n "$file" ] || die "could not work out which file was created"
  target="$HOME/storage/downloads"
  if [ ! -d "$target" ]; then
    die "shared storage is not set up. Run: termux-setup-storage  (and allow the permission prompt)"
  fi
  cp "$file" "$target/" || die "copy failed"
  ok "copied to $target/$(basename "$file")"
  dim "It is now visible in the phone's Downloads folder and in any file manager."
fi
