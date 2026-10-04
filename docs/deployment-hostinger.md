# Deployment on Hostinger

> **ملخص بالعربية**
>
> ثلاث طرق للنشر على Hostinger:
> 1. **خادم VPS مع Docker Compose (موصى بها):** قاعدة البيانات والتطبيق والعامل الخلفي وCaddy (شهادة HTTPS تلقائية) في أمر واحد.
> 2. **خادم VPS بدون Docker:** Node.js 22 مع PM2 وnginx وPostgreSQL مثبتة على الخادم أو مُدارة.
> 3. **استضافة Node.js المشتركة/السحابية:** ممكنة بقيود — لا يمكن تشغيل عامل خلفي دائم ولا قاعدة PostgreSQL محلية، لذلك نستخدم قاعدة خارجية (Neon أو Supabase) ومهام cron من لوحة Hostinger تستدعي `/api/cron`.
>
> نفصل بين بيئة **الاختبار (Staging)** التي يمكن تعبئتها ببيانات تجريبية، وبيئة **الإنتاج** التي لا تُشغَّل فيها البيانات التجريبية أبدًا. الترحيلات تُطبّق بالأمر `prisma migrate deploy`، والنشر يتم عبر `scripts/deploy.sh` مع نسخة احتياطية قبل كل نشر وفحص صحة بعده. السجلات بصيغة JSON مع تدوير تلقائي، وSentry اختياري.

## Quick start — one command

**Docker (recommended on a Hostinger VPS):**

```bash
curl -fsSL https://raw.githubusercontent.com/mastersa3d/ads.dashboard.attract/claude/exciting-bohr-a14mwz/scripts/install-docker-vps.sh -o install-docker.sh
sudo bash install-docker.sh
```

Installs Docker if needed, generates `/opt/mimd-docker/.env.production` with random secrets, builds and
starts PostgreSQL + app + worker + Caddy (automatic HTTPS), creates your organization and first
Super Admin (no demo data), and schedules a daily backup. Re-run the same command to update.

**Without Docker (Node + PM2):** `scripts/install-vps.sh` (same questions, installs into `/opt/mimd`).

## 0. Choosing a target

| | (a) VPS + Docker Compose | (b) VPS + PM2 (no Docker) | (c) Shared / Cloud "Node.js app" |
|---|---|---|---|
| Recommended for | **Production** | Teams that prefer bare-metal tooling | Small pilots only |
| Hostinger plan | KVM 2+ (2 vCPU, 8 GB) | KVM 2+ | Business / Cloud with Node.js |
| Postgres | Container `postgres:16` | Installed locally or managed | **External** (Neon, Supabase, Hostinger VPS) |
| Background worker | Container `worker` | PM2 process `mimd-worker` | ❌ → `/api/cron/*` via hPanel cron |
| HTTPS | Caddy automatic (Let's Encrypt) | nginx + certbot | Hostinger-managed SSL |
| Uploads | Docker volume `uploads` | `/opt/mimd/uploads` | App directory (limited quota; back up!) |
| Zero-downtime deploys | Near (few-second restart) / blue-green | `pm2 reload` | Panel restart |

Minimum sizing: 2 vCPU, 4 GB RAM (8 GB recommended with Postgres on the same host), 40 GB SSD + backup space.

## 1. Environment variables

Copy `.env.example`; every variable is commented there. Required in all environments:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?schema=public` (+ `&sslmode=require` for managed DBs) |
| `ENCRYPTION_KEY` | `openssl rand -base64 32`. **Different per environment. Back it up outside the server** — without it stored tokens and 2FA secrets are unrecoverable. |
| `APP_URL` | Public HTTPS URL; used for OAuth redirect URIs and e-mail links |
| `NODE_ENV` | `production` (enables `Secure` cookies) |

Recommended: `SMTP_*`, `MAIL_FROM`, `CRON_SECRET`, `LOG_LEVEL=info`, `UPLOAD_DIR`, `BACKUP_DIR`, `RCLONE_REMOTE`, `SENTRY_DSN`. Optional: AI and platform credentials ([integrations-setup.md](integrations-setup.md)). Docker only: `DOMAIN`, `ACME_EMAIL`, `POSTGRES_USER/PASSWORD/DB`.

Keep env files `chmod 600`, owned by the deploy user, never in git (`.gitignore` excludes `.env*` except `.env.example`).

## 2. Staging vs production

| | Staging | Production |
|---|---|---|
| Domain | `staging.dashboard.example.com` | `dashboard.example.com` |
| Env file | `.env.staging` | `.env.production` |
| `ENCRYPTION_KEY`, DB, `CRON_SECRET` | Separate values | Separate values |
| Demo data | ✅ `--profile demo run --rm seed` | ❌ **Never** (seed deletes/recreates only `demo-agency`, but still: don't) |
| Platform apps | Development-mode / test apps | Reviewed live apps |
| SMTP | Sandbox (Mailtrap) or empty | Real |
| `LOG_LEVEL` | `debug` | `info` |
| Access | Basic auth or IP allow-list at the proxy recommended | Public login |
| Data | Never copy production client data into staging unless anonymised | — |

Promotion flow: merge to `main` → CI green → tag `vX.Y.Z` → deploy tag to staging → acceptance checklist ([08](08-mvp-roadmap.md#acceptance-criteria-checklist)) → deploy same tag to production.

---

## 3. (a) Hostinger VPS with Docker Compose — recommended

### 3.1 Prepare the VPS

1. hPanel → **VPS** → choose **Ubuntu 24.04** (or the "Docker" template). Add your SSH key.
2. DNS (hPanel → Domains → DNS): `A dashboard → <VPS IP>` (and `staging` if used). Wait for propagation.
3. Harden:

```bash
ssh root@<ip>
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && systemctl restart ssh
apt update && apt -y upgrade && apt -y install unattended-upgrades fail2ban ufw git
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 443/udp && ufw --force enable
```

Also enable the Hostinger VPS firewall in hPanel with the same ports.

4. Install Docker (skip if you picked the Docker template):

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

### 3.2 First deployment

```bash
su - deploy
sudo mkdir -p /opt/mimd && sudo chown deploy: /opt/mimd
git clone <repo-url> /opt/mimd && cd /opt/mimd
git checkout vX.Y.Z
cp .env.example .env.production && chmod 600 .env.production
# edit: NODE_ENV=production, DOMAIN, ACME_EMAIL, APP_URL=https://$DOMAIN,
#       POSTGRES_PASSWORD (openssl rand -hex 24), ENCRYPTION_KEY (openssl rand -base64 32),
#       CRON_SECRET, SMTP_*, platform keys …
nano .env.production

docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f app
curl -fsS https://dashboard.example.com/api/health
```

What happens (`docker-compose.yml`):

1. `db` (postgres:16-alpine, volume `pgdata`, healthcheck `pg_isready`).
2. `migrate` — one-shot `npx prisma migrate deploy` (worker image) after `db` is healthy.
3. `app` — Next.js standalone (`node server.js`, non-root uid 1001, healthcheck `/api/health`, volume `uploads`) after migrate succeeds.
4. `worker` — `npx tsx worker/index.ts` (same env, same uploads volume).
5. `caddy` — ports 80/443, automatic Let's Encrypt certificate for `DOMAIN`, reverse proxy to `app:3000` (`deploy/Caddyfile`).

Postgres is **not** published to the host. For admin access: `docker compose exec db psql -U mimd mimd`, or an SSH tunnel.

### 3.3 Create the first admin (production)

Production must not use the demo seed. Create the organization and the first super admin with `scripts/create-admin.ts` (shipped in the worker image). The password is read from `ADMIN_PASSWORD` or prompted — never passed as an argument:

```bash
read -rsp "Admin password: " ADMIN_PASSWORD; echo; export ADMIN_PASSWORD
docker compose --env-file .env.production run --rm -e ADMIN_PASSWORD migrate \
  npx tsx scripts/create-admin.ts --org "Your Agency" --email you@agency.com --name "Your Name" --currency EGP --timezone Africa/Cairo
unset ADMIN_PASSWORD
```

Without Docker: `ADMIN_PASSWORD=… npx tsx scripts/create-admin.ts --org "Your Agency" --email you@agency.com`.

(PM2 hosts: run the same `node -e …` from `/opt/mimd` with `node --env-file=.env -e …`.) Then log in, enable 2FA, set organization currency/time zone/FX in **Settings**, and invite the team from **Users & Permissions**.

### 3.4 Updating (deploy script)

```bash
cd /opt/mimd && git fetch --tags && git checkout vX.Y.Z
scripts/deploy.sh docker                      # production (.env.production)
scripts/deploy.sh docker --staging            # staging (.env.staging, project mimd-staging)
```

`scripts/deploy.sh docker`: sources the env file → pre-deploy DB + uploads backup (aborts on failure unless `FORCE=1`) → builds images tagged with the git SHA → `migrate` → recreates `app` and `worker` → waits for `/api/health` → prunes old images.

### 3.5 Zero-downtime options

* **Default**: recreating the `app` container causes a few seconds of 502/wait; Caddy retries upstream health. Acceptable for most agencies — deploy outside office hours.
* **Blue/green**: run two app services (`app_blue`, `app_green`) and point Caddy's `reverse_proxy` at both with `lb_policy first` + `health_uri /api/health`; deploy green, wait healthy, stop blue. Requires the rate limiter to move to a shared store if both serve simultaneously.
* **Migrations** must be backward-compatible with the previous release (expand → migrate → contract across two releases) so old and new code can run against the same schema during the swap.

### 3.6 Staging on the same VPS

Preferred: a separate small VPS for staging. If you must share a host, don't run a second Caddy on 80/443: remove the `caddy` service from the staging project and add a site to `deploy/Caddyfile` that proxies to the staging app over a shared Docker network:

```caddy
staging.dashboard.example.com {
	basicauth { team <bcrypt-hash from `caddy hash-password`> }
	reverse_proxy mimd-staging-app-1:3000
}
```

```bash
docker network create edge
# add `networks: [default, edge]` to caddy (prod) and app (staging) via an override file
```

### 3.7 Rollback

1. `git checkout <previous tag> && scripts/deploy.sh docker`.
2. If the failed release ran a destructive migration, restore the pre-deploy backup (see [backup-restore.md](backup-restore.md)) **before** starting the old version.

---

## 4. (b) Hostinger VPS without Docker (Node 22 + PM2 + nginx)

### 4.1 Install

```bash
# as root / sudo
apt -y install nginx certbot python3-certbot-nginx git build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt -y install nodejs
npm i -g pm2
# PostgreSQL 16 (skip if using a managed DB)
apt -y install postgresql-16 postgresql-client-16
sudo -u postgres psql -c "CREATE USER mimd WITH PASSWORD '<strong>';" -c "CREATE DATABASE mimd OWNER mimd;"
adduser --system --group --home /opt/mimd mimd
```

Postgres listens on localhost only (default). Tune `shared_buffers` (~25 % RAM) and `work_mem` for analytics queries.

### 4.2 App

```bash
sudo -u mimd -H bash
cd /opt/mimd && git clone <repo-url> . && git checkout vX.Y.Z
cp .env.example .env && chmod 600 .env    # DATABASE_URL=postgresql://mimd:<pw>@localhost:5432/mimd?schema=public …
mkdir -p uploads backups logs
scripts/deploy.sh pm2                      # backup → npm ci → build → copy static → migrate → pm2 start/reload
pm2 startup systemd -u mimd --hp /opt/mimd # run the printed command as root, then: pm2 save
```

`deploy/ecosystem.config.cjs` defines:

* `mimd-web` — `.next/standalone/server.js`, fork mode, **1 instance** (in-memory rate limiter), `127.0.0.1:3000`, `--env-file=/opt/mimd/.env`, memory cap 768 MB.
* `mimd-worker` — `tsx worker/index.ts`, `kill_timeout` 65 s — on SIGTERM the worker stops claiming and finishes its batch (forced exit after 60 s).

`pm2 reload` restarts gracefully; with a single fork instance there is a sub-second gap. Prefer systemd? Use `deploy/systemd/mimd-web.service` and `mimd-worker.service` instead of PM2 (don't run both).

### 4.3 nginx + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/mimd.conf
sudo sed -i 's/dashboard.example.com/<your-domain>/g' /etc/nginx/sites-available/mimd.conf
sudo ln -s /etc/nginx/sites-available/mimd.conf /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default
# first issue the certificate (temporarily comment out the 443 server block, or use --nginx which edits it):
sudo certbot --nginx -d <your-domain> --redirect -m ops@example.com --agree-tos
sudo nginx -t && sudo systemctl reload nginx
```

Certbot installs a renewal timer (`systemctl list-timers | grep certbot`). The app itself sends HSTS/CSP headers.

### 4.4 Scheduled tasks

```bash
sudo cp deploy/systemd/mimd-backup.* /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now mimd-backup.timer          # daily 02:30 backup
sudo cp deploy/logrotate.conf /etc/logrotate.d/mimd     # or: pm2 install pm2-logrotate
```

The worker handles syncs, alerts and scheduled reports; no cron is needed for those.

---

## 5. (c) Hostinger shared / Cloud "Node.js app" hosting

hPanel's **Node.js** application feature (Business / Cloud plans) can run the web app, with limits:

| Limitation | Consequence | Fallback |
|---|---|---|
| No long-running background processes | No `worker` | Hostinger **Cron Jobs** call `POST /api/cron/<task>` with `Authorization: Bearer $CRON_SECRET` |
| No PostgreSQL (MySQL only) | Prisma schema is PostgreSQL-specific (arrays, JSON, enums) | External Postgres: **Neon** or **Supabase** (free tiers exist), or a small Hostinger VPS |
| Limited RAM/CPU per process, request timeouts | Heavy exports/syncs may time out | Keep export row cap; cron `run-jobs` processes a bounded batch (~50 s) per call |
| No root, no Docker, no custom nginx | Can't use Caddy/`deploy/*` | Use hPanel SSL (free Let's Encrypt) and the panel's Node.js entry point |
| Build in the panel may be slow/limited | `next build` needs ~2 GB RAM | Build locally/CI and upload `.next/standalone` + `.next/static` + `public` + `prisma` |
| Disk quota / inode limits | Uploads fill the plan | Keep `UPLOAD_DIR` small, back it up, move to object storage in Phase 4 |

Steps:

1. Create the database on Neon/Supabase; copy the **pooled** connection string with `?sslmode=require` (Neon: `-pooler` host; Supabase: port 6543 with `pgbouncer=true`) into `DATABASE_URL`. Run migrations from your machine or CI against the **direct** (non-pooled) URL: `DATABASE_URL=<direct> npx prisma migrate deploy`.
2. Build locally: `npm ci && npm run build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`.
3. hPanel → **Websites → Node.js** → create app: Node 22, application root = uploaded folder, startup file `server.js` (inside `standalone`). Add env vars in the panel (same list as §1; `NODE_ENV=production`).
4. Upload the `standalone` folder (File Manager/SFTP/Git deploy), start the app, enable SSL for the domain.
5. hPanel → **Advanced → Cron Jobs** — one job is enough, because `tick` runs the idempotent scheduler (sync every 15 min, alerts hourly, token checks daily, due reports) and then processes due jobs for up to ~45 s:

| Schedule | Command |
|---|---|
| `*/5 * * * *` | `curl -fsS -m 70 -X POST -H "Authorization: Bearer <CRON_SECRET>" https://dashboard.example.com/api/cron/tick` |

   `CRON_SECRET` must be at least 16 characters (`openssl rand -hex 32`). If the backlog grows (many clients), add a second entry offset by 2 minutes, or call the typed tasks (`/api/cron/sync`, `/alerts`, `/reports`, `/tokens`) separately.

6. Backups: rely on the provider's Postgres backups/PITR (Neon branches, Supabase daily backups) **plus** a weekly `pg_dump` from another machine with `scripts/backup.sh`; download uploads regularly.

---

## 6. Migrations

* Author in development: `npm run db:migrate:dev -- --name <change>` → commit `prisma/migrations/*`.
* CI verifies migrations apply to a clean DB and match `schema.prisma` (`prisma migrate diff --exit-code`).
* Apply in staging/production **only** with `prisma migrate deploy` (Docker: the `migrate` service; PM2: `scripts/deploy.sh pm2`). Never run `migrate dev` or `db push` against production.
* Always take a backup first (the deploy script does).
* Write backward-compatible migrations (add columns nullable/with default; backfill in a job; drop in a later release).

## 7. Seeding

* `npm run db:seed` / `--profile demo run --rm seed` creates the **Demo Agency** with two demo clients and users `admin@ manager@ team@ creator@ client@ viewer@demo.local` (password `Demo@12345`).
* Staging only. After seeding, change or delete demo users you won't use.
* Every seeded row is flagged `isDemo` / `source = DEMO` and badged in the UI.

## 8. Observability

### Structured logs

`src/lib/logger.ts` writes one JSON object per line to stdout/stderr: `{"ts","level","msg",…meta}` with secrets redacted by `sanitize()`. `LOG_LEVEL=debug` enables debug lines.

| Where | How to read | Rotation |
|---|---|---|
| Docker | `docker compose logs -f app worker` | json-file driver `max-size 10m`, `max-file 5` per container (compose `x-logging`) |
| PM2 | `pm2 logs mimd-web`; files in `/opt/mimd/logs` | `deploy/logrotate.conf` (daily, 14 days, compressed) or `pm2-logrotate` |
| systemd | `journalctl -u mimd-web -f` | journald (`SystemMaxUse=` in `/etc/systemd/journald.conf`) |
| nginx | `/var/log/nginx/mimd.*.log` | distro logrotate |
| Caddy | `docker compose logs caddy` (JSON access log) | json-file driver |

Useful filters: `docker compose logs app | grep '"level":"error"'`, or ship to Loki/Better Stack/Datadog with their Docker log driver.

### Error monitoring (optional)

Set `SENTRY_DSN` to enable Sentry (server + worker errors, with PII scrubbing and the same key redaction). Leave empty to disable; errors are still logged as JSON. Use separate DSNs/environments for staging and production.

### Uptime & alerts

* Monitor `https://<domain>/api/health` every minute (Better Stack, UptimeRobot, Hostinger monitoring).
* Alert on: health failing, disk > 80 % (`df -h`, backups and Postgres grow), backup job failure (systemd `OnFailure=` or cron mail), integration `SYNC_FAILED` spikes (in-app notifications).

## 9. Go-live checklist

- [ ] DNS + HTTPS valid; `https://<domain>` redirects from http; HSTS present.
- [ ] `.env.production` complete; unique `ENCRYPTION_KEY` backed up in a password manager/vault.
- [ ] Migrations applied; `/api/health` = ok.
- [ ] No demo data in production; first super admin created with 2FA on.
- [ ] SMTP tested (password reset e-mail arrives, SPF/DKIM/DMARC pass).
- [ ] Backups: first run succeeded, off-site copy verified, restore drill done ([backup-restore.md](backup-restore.md)).
- [ ] Worker running (or cron configured on shared hosting).
- [ ] Platform apps configured with production redirect URIs; reviews submitted.
- [ ] Uptime monitor + (optional) Sentry configured.
- [ ] Firewall: only 22/80/443 open; SSH keys only.
