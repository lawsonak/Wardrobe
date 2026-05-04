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

# Snapshot the DB before applying migrations. SQLite is one file —
# a copy is a complete backup. If a migration corrupts state, the
# pre-migration backup is sitting next to the live DB; stop the service
# and `mv data/wardrobe.db.bak.<stamp> data/wardrobe.db` to roll back.
# Backups older than 14 days are pruned to keep the directory tidy.
if [[ -f data/wardrobe.db ]]; then
  step "backup db"
  stamp=$(date +%Y%m%d-%H%M%S)
  cp data/wardrobe.db "data/wardrobe.db.bak.${stamp}"
  echo "  saved data/wardrobe.db.bak.${stamp}"
  find data -maxdepth 1 -name 'wardrobe.db.bak.*' -mtime +14 -delete 2>/dev/null || true
fi

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
