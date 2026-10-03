#!/usr/bin/env bash
# Update an installation made by scripts/install-vps.sh to the latest code:
#   sudo bash /opt/mimd/scripts/update-vps.sh
# Backs up the database first, pulls the code, rebuilds, migrates, reloads PM2 and Caddy.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mimd}"
APP_USER="${APP_USER:-mimd}"
BRANCH="${BRANCH:-claude/exciting-bohr-a14mwz}"

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }
[[ -f "$APP_DIR/.env" ]] || { echo "$APP_DIR/.env not found — run install-vps.sh first" >&2; exit 1; }
run() { sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && set -a && source .env && set +a && $*"; }

echo "==> Backup before update"
run "bash scripts/backup.sh" || { [[ "${FORCE:-0}" == "1" ]] || { echo "Backup failed — set FORCE=1 to continue anyway" >&2; exit 1; }; }

echo "==> Pulling $BRANCH"
sudo -u "$APP_USER" git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$BRANCH"

echo "==> Building"
run "npm ci --include=dev --no-audit --no-fund && npx prisma migrate deploy && npm run build"
run "rm -rf .next/standalone/.next/static && cp -r .next/static .next/standalone/.next/static && mkdir -p public && cp -r public .next/standalone/"

echo "==> Reloading"
run "pm2 startOrReload deploy/ecosystem.config.cjs --update-env && pm2 save"

# Keep Caddy in sync with DOMAIN in .env (e.g. after adding a domain later).
set -a; source "$APP_DIR/.env"; set +a
SITE="${DOMAIN:-:80}"
if ! grep -q "^$SITE {" /etc/caddy/Caddyfile 2>/dev/null; then
  printf '%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:3000\n\trequest_body {\n\t\tmax_size 30MB\n\t}\n}\n' "$SITE" > /etc/caddy/Caddyfile
fi
systemctl reload caddy || systemctl restart caddy

for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 && { echo "✔ Updated and healthy: ${APP_URL:-}"; exit 0; }; sleep 2; done
echo "App not healthy — check: sudo -u $APP_USER pm2 logs --lines 100" >&2
exit 1
