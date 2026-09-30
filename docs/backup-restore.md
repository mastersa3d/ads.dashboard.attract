# Backup & Restore

> **ملخص بالعربية**
>
> - **النسخ اليومي:** السكربت `scripts/backup.sh` يأخذ نسخة من قاعدة البيانات (`pg_dump`) ومن الملفات المرفوعة يوميًا، مع بصمة تحقق `sha256`، ويحتفظ بالنسخ اليومية 14 يومًا والأسبوعية 8 أسابيع، ويمكنه نسخها خارج الخادم عبر `rclone` (مثل Backblaze أو Google Drive).
> - **الاسترجاع:** السكربت `scripts/restore.sh` يتحقق من البصمة ثم يسترجع قاعدة البيانات والملفات، ويطلب تأكيدًا صريحًا بكتابة RESTORE.
> - **مفتاح التشفير `ENCRYPTION_KEY` غير موجود في النسخة الاحتياطية** — احفظه منفصلًا في خزنة كلمات مرور، وإلا فلن يمكن فك رموز المنصات بعد الاسترجاع.
> - **الأهداف:** أقصى فقدان بيانات مقبول (RPO) 24 ساعة، وأقصى وقت استعادة (RTO) ساعتان. يجب إجراء تجربة استرجاع شهرية وتسجيل نتيجتها.

## 1. What is backed up

| Asset | Where | Method | Frequency |
|---|---|---|---|
| PostgreSQL database | `db` container / local Postgres / managed | `pg_dump --format=custom --no-owner --no-privileges` | Daily 02:30 + before every deploy |
| Uploaded files | `UPLOAD_DIR` (Docker volume `uploads`) | `tar.gz` | Daily |
| Env files (`.env.production`, `.env.staging`) incl. **`ENCRYPTION_KEY`** | Server | **Manually** into a password manager / vault — never in the backup bucket | On every change |
| Caddy certificates | Volume `caddy_data` | Not needed (re-issued automatically) | — |
| Code | Git | Tags per release | Per release |

Platform data (metrics) can be re-synced from APIs for the last ~13–37 months depending on the platform, but **manual data** (plans, content, approvals, competitors, notes, audit logs) exists only in the database — backups are mandatory.

## 2. `scripts/backup.sh`

```bash
scripts/backup.sh                               # PM2/bare metal: reads .env (DATABASE_URL, BACKUP_DIR, UPLOAD_DIR…)
BACKUP_MODE=docker scripts/backup.sh            # Docker: dumps via `docker compose exec db pg_dump`, tars /app/uploads from the app container
SKIP_DOTENV=1 BACKUP_MODE=docker COMPOSE_PROJECT=mimd-staging scripts/backup.sh   # staging stack
```

Behaviour:

1. `set -euo pipefail`, `umask 077` (dumps readable by the owner only).
2. Dumps to `$BACKUP_DIR/daily/mimd-<UTC ts>.dump.partial`, verifies non-empty, renames atomically, writes `.sha256`.
3. Archives uploads to `uploads-<ts>.tar.gz` + `.sha256`.
4. On Sundays hard-links the files into `$BACKUP_DIR/weekly/`.
5. Rotation: deletes daily files older than `BACKUP_RETENTION_DAYS` (default 14) and weekly files older than `BACKUP_KEEP_WEEKLY` × 7 days (default 8 weeks).
6. Off-site (optional): `rclone copy` to `RCLONE_REMOTE` — **copy, not sync**, so a compromised server can't delete off-site history. Configure retention/lifecycle and object lock on the bucket itself.
7. Emits JSON log lines (`backup.db_ok`, `backup.uploads_ok`, `backup.offsite_ok`, `backup.done`) and exits non-zero on failure.

`DATABASE_URL` query parameters Prisma uses (e.g. `?schema=public`) are stripped for `pg_dump`; `sslmode=require` is kept.

### Scheduling

| Setup | Schedule |
|---|---|
| systemd (bare metal) | `deploy/systemd/mimd-backup.service` + `mimd-backup.timer` (daily 02:30, jitter 15 min, `Persistent=true`) |
| Docker host | root/deploy crontab: `30 2 * * * cd /opt/mimd && set -a && . ./.env.production && set +a && SKIP_DOTENV=1 BACKUP_MODE=docker scripts/backup.sh >> /var/log/mimd-backup.log 2>&1` |
| Shared hosting | Provider backups (Neon/Supabase) + weekly `scripts/backup.sh` from another machine with the direct `DATABASE_URL` |

Requirements: `pg_dump`/`pg_restore` **16** client (`apt install postgresql-client-16`) for bare-metal mode; `rclone` if off-site is enabled (`rclone config` as the backup user, e.g. Backblaze B2, Cloudflare R2, Google Drive).

### Off-site setup (example: Backblaze B2)

```bash
sudo apt install rclone
rclone config            # n → name "b2" → storage "b2" → keyID / applicationKey (bucket-scoped key)
# .env: RCLONE_REMOTE=b2:mimd-backups
# B2 bucket: lifecycle "keep prior versions 90 days", enable Object Lock if available
```

Encrypt off-site copies if the bucket is not private to you: wrap the remote with `rclone config` → type `crypt`.

## 3. `scripts/restore.sh`

```bash
scripts/restore.sh --db backups/daily/mimd-20260930T023000Z.dump \
                   --uploads backups/daily/uploads-20260930T023000Z.tar.gz
scripts/restore.sh --docker --db …dump --uploads …tar.gz          # into the compose `db` service
scripts/restore.sh --db …dump --target-url postgresql://…/mimd_restore_test --yes   # drill
```

* Verifies `.sha256` checksums first.
* Shows the destination (password masked) and requires typing `RESTORE` (unless `--yes`).
* `pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction` — all-or-nothing.
* Uploads: existing directory is moved aside to `uploads.before-restore-<ts>` (bare metal) before extracting.

### Production restore procedure

1. **Declare an incident**; note the time and chosen backup (latest good daily, or pre-deploy dump).
2. Stop writers: `docker compose --env-file .env.production stop app worker` (or `pm2 stop mimd-web mimd-worker`). Leave `db` running.
3. Take a safety dump of the current state: `BACKUP_MODE=docker scripts/backup.sh` (even if damaged — useful for forensics).
4. Fetch the backup if off-site: `rclone copy b2:mimd-backups/daily/mimd-<ts>.dump* backups/daily/`.
5. Restore: `scripts/restore.sh --docker --db … --uploads …`.
6. Ensure the **same `ENCRYPTION_KEY`** as when the backup was taken is in the env file (otherwise integrations show EXPIRED and 2FA secrets fail — users must reconnect / re-enrol).
7. Apply migrations if restoring into a newer release: `docker compose run --rm migrate`.
8. Start: `docker compose up -d app worker`; check `/api/health`, log in, spot-check a client dashboard, content calendar and integrations page.
9. Trigger "Sync now" on integrations to re-pull days since the backup.
10. Record the incident: cause, data window lost, actions; notify affected clients if required by contract/law.

## 4. RPO / RTO

| Objective | Target | How it is met |
|---|---|---|
| **RPO** (max data loss) | **24 h** for manual data; ~0 for platform metrics (re-sync) | Daily dump + pre-deploy dumps. For RPO ≤ 15 min, use a managed Postgres with PITR or enable WAL archiving (`wal-g`/`pgBackRest`) — Phase 4. |
| **RTO** (max downtime) | **2 h** | Scripted restore; drill measures the actual time (target < 30 min for DBs < 5 GB). |
| Retention | 14 daily + 8 weekly on server; off-site per bucket policy (≥ 90 days recommended) | `BACKUP_RETENTION_DAYS`, `BACKUP_KEEP_WEEKLY`, bucket lifecycle |

## 5. Restore drill (monthly)

Run on staging or a scratch database — never over production.

```bash
# 1. scratch database
docker compose exec db createdb -U mimd mimd_restore_test        # or: createdb on the host
# 2. restore latest off-site copy (proves off-site works too)
rclone copy "$RCLONE_REMOTE/daily/" /tmp/drill/ --max-age 26h
time scripts/restore.sh --db /tmp/drill/mimd-*.dump \
     --target-url postgresql://mimd:<pw>@localhost:5432/mimd_restore_test --yes
# 3. sanity queries
psql postgresql://…/mimd_restore_test -c 'select count(*) from "Client";' \
     -c 'select max(date) from "MetricDaily";' -c 'select max("createdAt") from "AuditLog";'
# 4. optional: point a staging app at it and log in
# 5. clean up
docker compose exec db dropdb -U mimd mimd_restore_test
```

Pass criteria: checksum OK; restore completes; row counts within expectations; latest `AuditLog` ≤ 26 h old; elapsed time recorded < RTO.

### Drill log

| Date | Operator | Backup file | Duration | Result | Notes |
|---|---|---|---|---|---|
| _yyyy-mm-dd_ | | | | | |

## 6. Security of backups

* Dumps contain personal data (users, client contacts, audit IPs) and **encrypted** tokens. Keep `BACKUP_DIR` `0700`, owned by the service user; off-site buckets private, bucket-scoped keys, encryption at rest (+ rclone `crypt` if in doubt).
* Never store `ENCRYPTION_KEY` next to the dumps. A stolen dump without the key does not expose platform tokens or TOTP secrets.
* Apply the same retention to backups as to live data when honouring deletion requests (document in the privacy policy that backups roll off within the retention window).
