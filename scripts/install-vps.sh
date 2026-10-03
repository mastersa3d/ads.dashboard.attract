#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-command installer for a fresh Hostinger VPS (Ubuntu 22.04 / 24.04 or Debian 12).
#
#   curl -fsSL https://raw.githubusercontent.com/mastersa3d/ads.dashboard.attract/claude/exciting-bohr-a14mwz/scripts/install-vps.sh -o install.sh
#   sudo bash install.sh
#
# Installs: Node.js 22, PostgreSQL, PM2, Caddy (automatic HTTPS via Let's Encrypt).
# Creates:  database + user with a random password, /opt/mimd/.env (chmod 600) with random
#           ENCRYPTION_KEY / CRON_SECRET, your organization + first Super Admin (no demo data),
#           PM2 processes (web + worker) that start on boot, a daily backup cron job.
# Re-running is safe: existing .env, database and data are kept; the code is updated instead.
#
# Non-interactive: DOMAIN=app.example.com ORG_NAME="Acme" ADMIN_EMAIL=me@acme.com \
#                  ADMIN_PASSWORD='…' sudo -E bash install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mastersa3d/ads.dashboard.attract.git}"
BRANCH="${BRANCH:-claude/exciting-bohr-a14mwz}"
APP_DIR="${APP_DIR:-/opt/mimd}"
APP_USER="${APP_USER:-mimd}"
DB_NAME="${DB_NAME:-mimd}"
DB_USER="${DB_USER:-mimd}"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo bash install.sh"
command -v apt-get >/dev/null || die "This installer supports Ubuntu/Debian (apt) only."

# ── 1. Questions ─────────────────────────────────────────────────────────────
FIRST_INSTALL=1
[[ -f "$APP_DIR/.env" ]] && FIRST_INSTALL=0

PUBLIC_IP="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
if [[ -z "${DOMAIN+set}" && $FIRST_INSTALL -eq 1 ]]; then
  echo
  echo "Domain for the platform (e.g. app.yourcompany.com)."
  echo "Point its DNS A record to this server ($PUBLIC_IP) first, so HTTPS can be issued."
  read -rp "Domain (leave empty to use http://$PUBLIC_IP for now): " DOMAIN < /dev/tty || DOMAIN=""
fi
if [[ $FIRST_INSTALL -eq 1 ]]; then
  [[ -n "${ORG_NAME:-}" ]] || read -rp "Company / agency name: " ORG_NAME < /dev/tty
  [[ -n "${ADMIN_EMAIL:-}" ]] || read -rp "Super Admin e-mail: " ADMIN_EMAIL < /dev/tty
  if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
    while true; do
      read -rsp "Super Admin password (10+ chars, letters and digits): " ADMIN_PASSWORD < /dev/tty; echo
      read -rsp "Repeat password: " P2 < /dev/tty; echo
      [[ "$ADMIN_PASSWORD" == "$P2" ]] || { echo "Passwords don't match."; continue; }
      [[ ${#ADMIN_PASSWORD} -ge 10 && "$ADMIN_PASSWORD" =~ [A-Za-z] && "$ADMIN_PASSWORD" =~ [0-9] ]] && break
      echo "Too weak — use 10+ characters with letters and digits."
    done
  fi
  [[ -n "$ORG_NAME" && "$ADMIN_EMAIL" == *@* ]] || die "Company name and a valid e-mail are required."
fi

# ── 2. System packages ───────────────────────────────────────────────────────
say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg openssl postgresql postgresql-contrib debian-keyring debian-archive-keyring apt-transport-https

# The app runs as a system user with the default PATH, so check the system Node in /usr/bin.
if [[ ! -x /usr/bin/node ]] || [[ "$(/usr/bin/node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
PM2_BIN="$(/usr/bin/npm prefix -g)/bin/pm2"
[[ -x "$PM2_BIN" ]] || /usr/bin/npm install -g pm2@latest
[[ -x "$PM2_BIN" ]] || die "pm2 was not installed ($PM2_BIN)"

if ! command -v caddy >/dev/null; then
  say "Installing Caddy (automatic HTTPS)"
  # Official Caddy repo first; fall back to the distribution package if it is unreachable.
  if curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list; then
    apt-get update -y
  else
    rm -f /etc/apt/sources.list.d/caddy-stable.list /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  fi
  apt-get install -y caddy
fi

systemctl enable --now postgresql

# ── 3. App user + code ───────────────────────────────────────────────────────
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /bin/bash "$APP_USER"
if [[ -d "$APP_DIR/.git" ]]; then
  say "Updating code ($BRANCH)"
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  say "Downloading code ($BRANCH)"
  mkdir -p "$APP_DIR"
  chown "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

# ── 4. Database + .env (first install only) ─────────────────────────────────
if [[ $FIRST_INSTALL -eq 1 ]]; then
  say "Creating database"
  DB_PASS="$(openssl rand -hex 24)"
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
    sudo -u postgres psql -c "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';"
  else
    sudo -u postgres psql -c "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';"
  fi
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

  if [[ -n "${DOMAIN:-}" ]]; then APP_URL="https://$DOMAIN"; else APP_URL="http://$PUBLIC_IP"; fi
  say "Writing $APP_DIR/.env"
  umask 077
  cat > "$APP_DIR/.env" <<EOF
# Generated by scripts/install-vps.sh on $(date -u +%F). Keep this file secret.
NODE_ENV=production
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public
ENCRYPTION_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 24)
APP_URL=$APP_URL
DOMAIN=${DOMAIN:-}
NEXT_PUBLIC_APP_NAME="Marketing Intelligence"
DEFAULT_LOCALE=ar
UPLOAD_DIR=$APP_DIR/uploads
BACKUP_DIR=$APP_DIR/backups
LOG_LEVEL=info
# Optional — fill in later, then run: sudo bash $APP_DIR/scripts/update-vps.sh
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=
ANTHROPIC_API_KEY=
META_APP_ID=
META_APP_SECRET=
META_AD_LIBRARY_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_ADS_DEVELOPER_TOKEN=
TIKTOK_APP_ID=
TIKTOK_APP_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
EOF
  umask 022
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi
mkdir -p "$APP_DIR/uploads" "$APP_DIR/backups" "$APP_DIR/logs"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/uploads" "$APP_DIR/backups" "$APP_DIR/logs"

# ── 5. Build ─────────────────────────────────────────────────────────────────
say "Installing dependencies and building (takes a few minutes)"
# Small VPS plans: give the build some swap so `next build` doesn't run out of memory.
if [[ "$(free -m | awk '/Mem:/{print $2}')" -lt 3000 && ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sudo -u "$APP_USER" bash -c "export PATH=/usr/bin:\$PATH && cd '$APP_DIR' && set -a && source .env && set +a && npm ci --include=dev --no-audit --no-fund && npx prisma migrate deploy && npm run build"
sudo -u "$APP_USER" bash -c "export PATH=/usr/bin:\$PATH && cd '$APP_DIR' && rm -rf .next/standalone/.next/static && cp -r .next/static .next/standalone/.next/static && mkdir -p public && cp -r public .next/standalone/"

# ── 6. First Super Admin (first install only, no demo data) ─────────────────
if [[ $FIRST_INSTALL -eq 1 ]]; then
  say "Creating organization and Super Admin"
  sudo -u "$APP_USER" env ORG_NAME="$ORG_NAME" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    bash -c "export PATH=/usr/bin:\$PATH && cd '$APP_DIR' && set -a && source .env && set +a && npx tsx scripts/seed-if-empty.ts"
  unset ADMIN_PASSWORD P2
fi

# ── 7. Processes (PM2, start on boot) ────────────────────────────────────────
say "Starting the app with PM2"
sudo -u "$APP_USER" bash -c "export PATH=/usr/bin:\$PATH && cd '$APP_DIR' && '$PM2_BIN' startOrReload deploy/ecosystem.config.cjs --update-env && '$PM2_BIN' save"
env PATH="/usr/bin:$PATH" "$PM2_BIN" startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null
systemctl enable "pm2-$APP_USER" >/dev/null 2>&1 || true

# ── 8. Caddy (HTTPS reverse proxy) ───────────────────────────────────────────
set -a; source "$APP_DIR/.env"; set +a
SITE="${DOMAIN:-:80}"
say "Configuring Caddy for $SITE"
cat > /etc/caddy/Caddyfile <<EOF
$SITE {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
	request_body {
		max_size 30MB
	}
}
EOF
systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy

# ── 9. Firewall + backups ────────────────────────────────────────────────────
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi
cat > /etc/cron.d/mimd-backup <<EOF
# Daily database + uploads backup at 03:15 server time (kept 14 days, weekly copies 8 weeks)
15 3 * * * $APP_USER cd $APP_DIR && bash scripts/backup.sh >> $APP_DIR/logs/backup.log 2>&1
EOF

# ── 10. Health check ─────────────────────────────────────────────────────────
say "Checking health"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
[[ "${OK:-0}" == "1" ]] || die "The app did not become healthy. Logs: sudo -u $APP_USER $PM2_BIN logs --lines 100"

echo
printf '\033[1;32m✔ Installed.\033[0m  Open: %s\n' "$APP_URL"
[[ -z "${DOMAIN:-}" ]] && echo "  (HTTP only — re-run with a domain later: add DOMAIN=… to $APP_DIR/.env, set APP_URL=https://…, then sudo bash $APP_DIR/scripts/update-vps.sh)"
echo "  Logs:     sudo -u $APP_USER $PM2_BIN logs"
echo "  Update:   sudo bash $APP_DIR/scripts/update-vps.sh"
echo "  Secrets:  $APP_DIR/.env (SMTP, AI and platform API keys go here)"
