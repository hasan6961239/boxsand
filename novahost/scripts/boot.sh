#!/data/data/com.termux/files/usr/bin/sh
# Termux:Boot entry point — starts NOVA HOST after the phone reboots.
#
# Install it with either of these; both work:
#
#   mkdir -p ~/.termux/boot
#   cp scripts/boot.sh ~/.termux/boot/novahost && chmod +x ~/.termux/boot/novahost
#
#   ln -sf "$PWD/scripts/boot.sh" ~/.termux/boot/novahost
#
# Termux:Boot only runs scripts in ~/.termux/boot, and only after its app has
# been opened by hand at least once.
#
# sh, not bash: Termux:Boot runs these with a bare environment, and sh is the
# one interpreter guaranteed to be there.

# Keep the CPU awake before anything else. The wake lock is what allows the
# server to survive the screen turning off; everything below is pointless
# without it.
termux-wake-lock 2>/dev/null

# Two ways to run the server, and the phone may have either installed:
#
#   runit   — scripts/service-install.sh registered a termux-services service.
#             Starting runsvdir is enough; runit brings the service up itself.
#   start.sh — the built-in supervisor.
#
# Check for the service first, because when it exists start.sh would be a
# second copy of the same server fighting for port 8080.
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
if [ -d "$PREFIX/var/service/novahost" ]; then
  if [ -f "$PREFIX/etc/profile.d/start-services.sh" ]; then
    . "$PREFIX/etc/profile.d/start-services.sh"
  else
    # termux-services normally starts this from the login shell, which never
    # runs at boot.
    nohup runsvdir "$PREFIX/var/service" >/dev/null 2>&1 &
  fi
  exit 0
fi

# Find the project. A copy of this file in ~/.termux/boot has no start.sh next
# to it, so trying that first and then falling back is what makes both install
# methods above work — a symlink resolves to the repository, a copy does not.
HERE="$(dirname "$(readlink -f "$0")")"
for candidate in \
  "$HERE/start.sh" \
  "$HOME/novahost/scripts/start.sh" \
  "$HOME/novahost-repo/novahost/scripts/start.sh" \
  "$HOME/boxsand/novahost/scripts/start.sh"
do
  [ -x "$candidate" ] && START="$candidate" && break
done

if [ -z "${START:-}" ]; then
  # Nothing to exec. Leave a trace, because a boot script that fails silently
  # looks exactly like a boot script that never ran.
  mkdir -p "$HOME/.termux/boot"
  echo "$(date -Iseconds) novahost boot: no start.sh found; edit $0 and set the path" \
    >> "$HOME/.termux/boot/novahost.log"
  exit 1
fi

# Wi-Fi is usually still associating this early after a reboot. Starting before
# the network is up makes the first health check fail for no real reason, so
# wait for an address — but bounded, because the server should come up on a
# phone with no Wi-Fi at all rather than hang here forever.
i=0
while [ "$i" -lt 30 ]; do
  ip addr show 2>/dev/null | grep 'inet ' | grep -qv '127\.0\.0\.1' && break
  sleep 1
  i=$((i + 1))
done

exec "$START"
