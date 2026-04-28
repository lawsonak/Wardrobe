#!/usr/bin/env bash
# One-liner update for the running app on the Proxmox container.
# Usage:
#   cd /opt/wardrobe && ./scripts/update.sh
# or via npm:
#   cd /opt/wardrobe && npm run deploy:update
#
# Pulls the latest code, installs deps, applies any new migrations,
# rebuilds, and restarts the systemd service. Exits at the first
# failure so a broken build doesn't restart the service.

set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }

step "git pull"
git pull --ff-only

step "npm install"
npm install --no-audit --no-fund

step "prisma migrate deploy"
npx prisma migrate deploy

step "npm run build"
npm run build

# Skip the service restart if we're not on a systemd host or the
# service isn't installed (eg. running this on a dev laptop).
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files wardrobe.service >/dev/null 2>&1; then
  step "systemctl restart wardrobe"
  systemctl restart wardrobe
  systemctl --no-pager --full status wardrobe | head -10
else
  echo
  echo "(systemd not detected — restart your dev server manually.)"
fi

printf '\n\033[1;32m✓ Update complete.\033[0m\n'
