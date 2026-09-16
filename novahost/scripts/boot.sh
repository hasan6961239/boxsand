#!/data/data/com.termux/files/usr/bin/bash
# Reference copy of the Termux:Boot script.
#
# install-termux.sh writes an equivalent file to ~/.termux/boot/novahost.
# This copy lives in the repository so the boot behaviour is reviewable and can
# be restored by hand:
#
#   mkdir -p ~/.termux/boot
#   cp scripts/boot.sh ~/.termux/boot/novahost
#   chmod +x ~/.termux/boot/novahost
#
# Termux:Boot only runs scripts in ~/.termux/boot, and only after its app has
# been opened at least once.

# Keep the CPU awake before anything else: the wake lock is what allows the
# server to survive the screen turning off.
termux-wake-lock

# Give Wi-Fi a moment to associate after a reboot; starting before the network
# is up means the first health check fails for no good reason.
sleep 15

exec "$(dirname "$(readlink -f "$0")")/start.sh"
