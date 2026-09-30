#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Restore a backup produced by scripts/backup.sh.
#
#   scripts/restore.sh --db backups/daily/mimd-20260930T023000Z.dump [--uploads backups/daily/uploads-….tar.gz]
#                      [--target-url postgresql://…/mimd_restore_test] [--docker] [--yes]
#
#   --db          custom-format dump to restore (required)
#   --uploads     uploads archive to extract into UPLOAD_DIR (optional)
#   --target-url  restore into this database instead of DATABASE_URL (use for restore drills)
#   --docker      restore through the `db` container of docker-compose.yml
#   --yes         do not ask for confirmation (for automated drills only)
#
# The target database is CLEANED (existing objects dropped) before restore. Stop the app and the
# worker first when restoring production:  docker compose stop app worker   |   pm2 stop all
# See docs/backup-restore.md.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/.env" && -z "${SKIP_DOTENV:-}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

DB_DUMP=""; UP_ARCHIVE=""; TARGET_URL=""; DOCKER=0; YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) DB_DUMP="$2"; shift 2 ;;
    --uploads) UP_ARCHIVE="$2"; shift 2 ;;
    --target-url) TARGET_URL="$2"; shift 2 ;;
    --docker) DOCKER=1; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$DB_DUMP" && -f "$DB_DUMP" ]] || { echo "--db <file> is required and must exist" >&2; exit 2; }

verify() {
  local f="$1"
  if [[ -f "$f.sha256" ]]; then
    ( cd "$(dirname "$f")" && sha256sum -c "$(basename "$f").sha256" ) || { echo "Checksum mismatch for $f" >&2; exit 1; }
  else
    echo "warning: no checksum file for $f" >&2
  fi
}
verify "$DB_DUMP"
[[ -z "$UP_ARCHIVE" ]] || verify "$UP_ARCHIVE"

URL="${TARGET_URL:-${DATABASE_URL:-}}"
PG_URL="${URL%%\?*}"
if [[ "$URL" == *"sslmode=require"* ]]; then PG_URL="$PG_URL?sslmode=require"; fi

if [[ $DOCKER -eq 1 ]]; then
  DEST="docker service 'db' database '${POSTGRES_DB:-mimd}'"
else
  [[ -n "$PG_URL" ]] || { echo "DATABASE_URL or --target-url required" >&2; exit 2; }
  DEST="$(sed -E 's#://([^:]+):[^@]*@#://\1:***@#' <<<"$PG_URL")"
fi

echo "About to restore:"
echo "  dump    : $DB_DUMP"
[[ -z "$UP_ARCHIVE" ]] || echo "  uploads : $UP_ARCHIVE -> ${UPLOAD_DIR:-$ROOT/uploads}"
echo "  into    : $DEST   (existing objects will be DROPPED)"
if [[ $YES -ne 1 ]]; then
  read -r -p "Type RESTORE to continue: " answer
  [[ "$answer" == "RESTORE" ]] || { echo "Aborted."; exit 1; }
fi

START=$(date +%s)
if [[ $DOCKER -eq 1 ]]; then
  docker compose -p "${COMPOSE_PROJECT:-mimd}" -f "${COMPOSE_FILE:-$ROOT/docker-compose.yml}" exec -T db \
    pg_restore -U "${POSTGRES_USER:-mimd}" -d "${POSTGRES_DB:-mimd}" --clean --if-exists --no-owner --no-privileges --single-transaction \
    < "$DB_DUMP"
else
  command -v pg_restore >/dev/null || { echo "pg_restore not found (apt install postgresql-client-16)" >&2; exit 1; }
  pg_restore --dbname="$PG_URL" --clean --if-exists --no-owner --no-privileges --single-transaction "$DB_DUMP"
fi
echo "Database restored."

if [[ -n "$UP_ARCHIVE" ]]; then
  if [[ $DOCKER -eq 1 ]]; then
    docker compose -p "${COMPOSE_PROJECT:-mimd}" -f "${COMPOSE_FILE:-$ROOT/docker-compose.yml}" run --rm -T --no-deps \
      -v "$(cd "$(dirname "$UP_ARCHIVE")" && pwd)/$(basename "$UP_ARCHIVE"):/tmp/uploads.tgz:ro" --entrypoint sh app \
      -c 'tar -xzf /tmp/uploads.tgz -C /app'
  else
    DEST_UP="${UPLOAD_DIR:-$ROOT/uploads}"
    [[ "$DEST_UP" = /* ]] || DEST_UP="$ROOT/${DEST_UP#./}"
    mkdir -p "$(dirname "$DEST_UP")"
    [[ ! -d "$DEST_UP" ]] || mv "$DEST_UP" "$DEST_UP.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
    tar -xzf "$UP_ARCHIVE" -C "$(dirname "$DEST_UP")"
  fi
  echo "Uploads restored."
fi

echo "Done in $(( $(date +%s) - START ))s."
echo "Next: run 'npx prisma migrate deploy' if the dump predates the current release, then start app + worker"
echo "and check /api/health. Record the drill result in docs/backup-restore.md §Drill log."
