#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Daily backup: PostgreSQL (pg_dump custom format) + uploaded files, with rotation and an
# optional off-site copy via rclone. Safe to run from cron / systemd timer / by hand.
#
#   scripts/backup.sh                 # uses .env in the repo root (or the current environment)
#   BACKUP_MODE=docker scripts/backup.sh   # dump through the `db` container of docker-compose.yml
#
# Env: DATABASE_URL (required unless BACKUP_MODE=docker), BACKUP_DIR (default ./backups),
#      UPLOAD_DIR (default ./uploads), BACKUP_RETENTION_DAYS (14), BACKUP_KEEP_WEEKLY (8),
#      RCLONE_REMOTE (optional, e.g. "b2:mimd-backups"), COMPOSE_FILE / COMPOSE_PROJECT (docker mode),
#      POSTGRES_USER / POSTGRES_DB (docker mode).
# Output:  $BACKUP_DIR/daily/mimd-<UTC timestamp>.dump(+.sha256)
#          $BACKUP_DIR/daily/uploads-<UTC timestamp>.tar.gz(+.sha256)
#          Sunday copies are hard-linked into $BACKUP_DIR/weekly/.
# See docs/backup-restore.md.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/.env" && -z "${SKIP_DOTENV:-}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

BACKUP_MODE="${BACKUP_MODE:-direct}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
UPLOAD_DIR="${UPLOAD_DIR:-$ROOT/uploads}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-mimd}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"

# Relative paths are relative to the repo root.
[[ "$BACKUP_DIR" = /* ]] || BACKUP_DIR="$ROOT/${BACKUP_DIR#./}"
[[ "$UPLOAD_DIR" = /* ]] || UPLOAD_DIR="$ROOT/${UPLOAD_DIR#./}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DAILY="$BACKUP_DIR/daily"
WEEKLY="$BACKUP_DIR/weekly"
mkdir -p "$DAILY" "$WEEKLY"

log() { printf '{"ts":"%s","level":"%s","msg":"backup.%s"}\n' "$(date -u +%FT%TZ)" "$1" "$2"; }
fail() { log error "$1"; exit 1; }
trap 'log error "failed_at_line_$LINENO"' ERR

DB_FILE="$DAILY/mimd-$TS.dump"

# ── 1. Database ──────────────────────────────────────────────────────────────
if [[ "$BACKUP_MODE" == "docker" ]]; then
  command -v docker >/dev/null || fail "docker_not_found"
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" exec -T db \
    pg_dump -U "${POSTGRES_USER:-mimd}" -d "${POSTGRES_DB:-mimd}" --format=custom --no-owner --no-privileges \
    > "$DB_FILE.partial"
else
  [[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL_not_set"
  command -v pg_dump >/dev/null || fail "pg_dump_not_found (apt install postgresql-client-16)"
  # pg_dump rejects Prisma-only params such as ?schema=public — strip the query string.
  PG_URL="${DATABASE_URL%%\?*}"
  if [[ "$DATABASE_URL" == *"sslmode=require"* ]]; then PG_URL="$PG_URL?sslmode=require"; fi
  pg_dump "$PG_URL" --format=custom --no-owner --no-privileges --file="$DB_FILE.partial"
fi
[[ -s "$DB_FILE.partial" ]] || fail "empty_dump"
mv "$DB_FILE.partial" "$DB_FILE"
( cd "$DAILY" && sha256sum "$(basename "$DB_FILE")" > "$(basename "$DB_FILE").sha256" )
log info "db_ok file=$(basename "$DB_FILE") size=$(stat -c %s "$DB_FILE")"

# ── 2. Uploads ───────────────────────────────────────────────────────────────
UP_FILE=""
if [[ "$BACKUP_MODE" == "docker" ]]; then
  UP_FILE="$DAILY/uploads-$TS.tar.gz"
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" exec -T app tar -czf - -C /app uploads > "$UP_FILE" || {
    rm -f "$UP_FILE"; UP_FILE=""; log warn "uploads_skipped"; }
elif [[ -d "$UPLOAD_DIR" ]]; then
  UP_FILE="$DAILY/uploads-$TS.tar.gz"
  tar -czf "$UP_FILE" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
else
  log warn "uploads_dir_missing path=$UPLOAD_DIR"
fi
if [[ -n "$UP_FILE" ]]; then
  ( cd "$DAILY" && sha256sum "$(basename "$UP_FILE")" > "$(basename "$UP_FILE").sha256" )
  log info "uploads_ok file=$(basename "$UP_FILE")"
fi

# ── 3. Weekly copy (Sunday) ──────────────────────────────────────────────────
if [[ "$(date -u +%u)" == "7" ]]; then
  for f in "$DB_FILE" "$DB_FILE.sha256" ${UP_FILE:+"$UP_FILE" "$UP_FILE.sha256"}; do
    ln -f "$f" "$WEEKLY/" 2>/dev/null || cp -p "$f" "$WEEKLY/"
  done
  log info "weekly_copy_ok"
fi

# ── 4. Rotation ──────────────────────────────────────────────────────────────
find "$DAILY" -maxdepth 1 -type f -mtime +"$RETENTION_DAYS" -print -delete | sed 's/^/rotated: /' || true
find "$WEEKLY" -maxdepth 1 -type f -mtime +"$(( KEEP_WEEKLY * 7 ))" -print -delete | sed 's/^/rotated: /' || true

# ── 5. Off-site (optional) ───────────────────────────────────────────────────
if [[ -n "$RCLONE_REMOTE" ]]; then
  command -v rclone >/dev/null || fail "rclone_not_found"
  # `copy` (not `sync`) so a compromised server cannot delete off-site history;
  # configure lifecycle/retention on the bucket itself.
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" --include "daily/*" --include "weekly/*" --transfers 2 --checksum
  log info "offsite_ok remote=$RCLONE_REMOTE"
fi

log info "done ts=$TS"
