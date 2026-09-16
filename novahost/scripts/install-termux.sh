#!/data/data/com.termux/files/usr/bin/bash
# One-time Termux setup for NOVA HOST.
#
# Idempotent: safe to run again after a Termux upgrade or a failed attempt.
# It installs packages, prepares .env, initialises the database and prints the
# manual Android settings you still have to change by hand.

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$ROOT_DIR" || exit 1

printf '\n%sNOVA HOST — Termux setup%s\n\n' "$C_BLUE" "$C_RESET"

# ---------------------------------------------------------------------------
# 1. Packages
# ---------------------------------------------------------------------------
info "updating package lists"
pkg update -y >/dev/null 2>&1 || warn "pkg update reported a problem; continuing"

# nodejs-lts is the safer default for a machine meant to stay up for weeks.
# openssh gives you SSH from the laptop; the rest are small and genuinely used.
PACKAGES="nodejs-lts openssh termux-api termux-services git curl"
info "installing: $PACKAGES"
# shellcheck disable=SC2086
pkg install -y $PACKAGES || die "package installation failed"

# cloudflared is only needed once you want the site reachable from outside the
# house. Setup should not fail over it, so it is installed separately and a
# missing package is reported rather than fatal.
if pkg install -y cloudflared >/dev/null 2>&1; then
  ok "cloudflared $(cloudflared --version 2>/dev/null | head -1)"
else
  warn "cloudflared did not install — local network access still works.
     Retry later with:  pkg install cloudflared"
fi

if ! command -v node >/dev/null 2>&1; then
  info "nodejs-lts did not provide node; trying the latest nodejs package"
  pkg install -y nodejs || die "could not install Node.js"
fi

require_node
ok "node $(node -v)"

# ---------------------------------------------------------------------------
# 2. Configuration
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  ok "created .env from the example"
else
  info ".env already exists, leaving it alone"
fi

if grep -qE '^SESSION_SECRET=\s*$' .env; then
  secret="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  # A portable in-place edit: Termux's sed -i works, but a temp file is safer
  # if the phone is low on space and the edit is interrupted.
  awk -v s="$secret" '/^SESSION_SECRET=/ {print "SESSION_SECRET=" s; next} {print}' .env > .env.tmp \
    && mv .env.tmp .env
  ok "generated SESSION_SECRET"
fi

if grep -qE '^NODE_ENV=development' .env; then
  awk '/^NODE_ENV=/ {print "NODE_ENV=production"; next} {print}' .env > .env.tmp && mv .env.tmp .env
  ok "set NODE_ENV=production"
fi

ensure_dirs

# ---------------------------------------------------------------------------
# 3. Database
# ---------------------------------------------------------------------------
info "initialising the database"
node backend/src/cli.js migrate || die "migrations failed"

# ---------------------------------------------------------------------------
# 4. Start on boot
# ---------------------------------------------------------------------------
BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"
# Install the reviewed script itself rather than generating a second version of
# it here. scripts/boot.sh locates the project whether it is copied or linked,
# so there is one boot behaviour to read and one to debug.
cp "$SCRIPT_DIR/boot.sh" "$BOOT_DIR/novahost"
chmod +x "$BOOT_DIR/novahost"
ok "boot script installed at $BOOT_DIR/novahost"

# ---------------------------------------------------------------------------
# 5. What the script cannot do for you
# ---------------------------------------------------------------------------
printf '\n%sSetup finished. Three things still need you:%s\n\n' "$C_GREEN" "$C_RESET"

cat <<'NOTES'
  1. Install Termux:Boot from the SAME source as Termux (F-Droid or GitHub),
     then OPEN IT ONCE. It does nothing until it has been launched by hand,
     and the boot script above will never run until you do.

  2. Android settings → Apps → Termux → Battery → Unrestricted.
     Do the same for Termux:Boot and Termux:API.
     On One UI also turn off "Pause app activity if unused" for all three.
     Without this, Android suspends the server minutes after the screen goes off.

  3. Settings → Wi-Fi → (gear) → advanced → keep Wi-Fi on during sleep.

  Then start it:

     scripts/start.sh

  and open the dashboard from your laptop at the address status.sh prints.
NOTES

printf '\n'
"$SCRIPT_DIR/status.sh" 2>/dev/null || true
