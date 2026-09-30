#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy the current checkout on a Hostinger VPS.
#
#   scripts/deploy.sh docker [--env-file .env.production] [--staging]
#   scripts/deploy.sh pm2
#
# Both modes: pre-deploy backup → build → `prisma migrate deploy` → restart → health check.
# Pull the release you want first (e.g. `git fetch --tags && git checkout v1.2.0`).
# See docs/deployment-hostinger.md.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-}"; shift || true
ENV_FILE=".env.production"; STAGING=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --staging) STAGING=1; ENV_FILE="${ENV_FILE/.env.production/.env.staging}"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }
REV="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

wait_healthy() {
  local url="$1" i
  for i in $(seq 1 40); do
    if curl -fsS "$url" >/dev/null 2>&1; then log "healthy: $url"; return 0; fi
    sleep 3
  done
  log "health check FAILED: $url"; return 1
}

case "$MODE" in
  docker)
    [[ -f "$ENV_FILE" ]] || { echo "$ENV_FILE not found" >&2; exit 1; }
    COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml)
    PROJECT=mimd
    if [[ $STAGING -eq 1 ]]; then COMPOSE+=(-f docker-compose.staging.yml -p mimd-staging); PROJECT=mimd-staging; fi
    export IMAGE_TAG="$REV"
    set -a; source "$ENV_FILE"; set +a

    log "pre-deploy backup"
    if "${COMPOSE[@]}" ps --status running db 2>/dev/null | grep -q db; then
      SKIP_DOTENV=1 BACKUP_MODE=docker COMPOSE_PROJECT="$PROJECT" scripts/backup.sh \
        || { [[ "${FORCE:-0}" == "1" ]] || { log "backup failed; set FORCE=1 to deploy anyway"; exit 1; }; }
    else
      log "db not running yet (first deploy) — skipping backup"
    fi

    log "building images tag=$IMAGE_TAG"
    "${COMPOSE[@]}" build migrate app

    log "starting database"
    "${COMPOSE[@]}" up -d db

    log "running migrations"
    "${COMPOSE[@]}" run --rm migrate

    # Recreate app + worker with the new images (a few seconds of restart; Caddy holds and retries
    # requests during the swap). For strict zero-downtime use the blue/green recipe in the docs.
    log "rolling app + worker"
    "${COMPOSE[@]}" up -d --no-deps app worker
    "${COMPOSE[@]}" up -d caddy

    wait_healthy "${APP_URL:-https://$DOMAIN}/api/health" \
      || { log "rollback: git checkout <previous tag> && scripts/deploy.sh docker (restore DB only if a migration broke data)"; exit 1; }
    docker image prune -f >/dev/null || true
    ;;

  pm2)
    [[ -f .env ]] || { echo ".env not found" >&2; exit 1; }
    command -v pm2 >/dev/null || { echo "pm2 not installed: npm i -g pm2" >&2; exit 1; }

    log "pre-deploy backup"
    scripts/backup.sh || { [[ "${FORCE:-0}" == "1" ]] || { log "backup failed; set FORCE=1 to deploy anyway"; exit 1; }; }

    log "installing dependencies"
    npm ci --no-audit --no-fund

    log "building (prisma generate + next build)"
    set -a; source .env; set +a
    npm run build

    # Standalone output does not include static assets / public — copy them in.
    cp -r .next/static .next/standalone/.next/static
    if [[ -d public ]]; then cp -r public .next/standalone/public; fi

    log "running migrations"
    npx prisma migrate deploy

    log "reloading processes"
    mkdir -p logs
    if pm2 describe mimd-web >/dev/null 2>&1; then
      pm2 reload deploy/ecosystem.config.cjs --update-env
    else
      pm2 start deploy/ecosystem.config.cjs
    fi
    pm2 save

    wait_healthy "http://127.0.0.1:3000/api/health"
    ;;

  *)
    echo "Usage: scripts/deploy.sh docker|pm2 [--env-file FILE] [--staging]" >&2
    exit 2
    ;;
esac

log "deployed revision $REV"
