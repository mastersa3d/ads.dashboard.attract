# Marketing Intelligence & Management Dashboard

Multi-client, multi-brand marketing platform for agencies — plan, run, approve and report marketing in **Arabic (RTL)** and **English (LTR)**, with honest data (every number shows its source), optional AI with human approval, and simple deployment on a Hostinger VPS.

> **بالعربية:** منصة لإدارة وتحليل التسويق لعدة عملاء وعلامات تجارية، بواجهة عربية وإنجليزية كاملة، تجمع بيانات المنصات الإعلانية الرسمية، وتدير الاستراتيجية والميزانية والمحتوى والموافقات والمنافسين والتقارير، مع ذكاء اصطناعي اختياري لا يطبّق شيئًا دون موافقة بشرية. التوثيق الكامل في مجلد `docs/` مع ملخص عربي في بداية كل ملف، وأدلة المستخدم مكتوبة بالعربية والإنجليزية.

## Features

* **Multi-tenant**: Organization → Client → Brand → Ad account, with strict client isolation and white-label client views.
* **5 roles, 44 permissions**, per-user overrides and hard guards (`src/lib/rbac.ts`).
* **Executive dashboard**: KPIs vs previous period, target and market; pacing and forecast; executive summary that separates facts, estimates and recommendations.
* **Performance analytics & campaigns** with 27 URL-driven global filters and saved views.
* **Strategy builder**, **budget planner** (scenarios, allocation, expected results) and **plan vs actual**.
* **Content calendar, library and two-stage approvals** (internal + client) with versions, internal comments, recurrence and time zones.
* **Competitor intelligence** from official ad libraries with an *Estimated Advertising Intensity* index (no invented spend), **trends & ideas**, **benchmarks**.
* **Reports** (scheduled e-mail, public share links), **tasks**, **alerts & notifications**, **audit logs**.
* **Integrations**: Meta (Ads, Pages, Instagram, Ad Library), Google (Ads, GA4, Search Console, YouTube), TikTok, LinkedIn (Ads, Pages), X (paid API tier); Google Trends via import; optional Google/Microsoft calendar & storage placeholders. OAuth + PKCE, AES-256-GCM token vault, incremental sync with retries.
* **Exports**: CSV, Excel, PDF (print), PNG.
* **Security**: 2FA (TOTP), DB sessions, lockout, rate limits, CSP/HSTS, audit trail.
* **Ops**: Docker Compose (Postgres, app, worker, Caddy HTTPS) or PM2 + nginx; daily backups with off-site copy; CI.


## Live demo in 10 minutes (Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mastersa3d/ads.dashboard.attract)

`render.yaml` creates a PostgreSQL database and one web service, applies migrations, loads the
clearly-labelled **demo workspace only when the database is empty** (`scripts/seed-if-empty.ts`,
guarded by `DEMO_MODE=true`) and runs the background worker inside the web container
(`scripts/start-demo.sh`). The login page then lists the demo accounts (password `Demo@12345`).
Free Render instances sleep when idle and the free database is time-limited — use it for demos,
and the Hostinger guide for real clients.


## Screenshots

_Placeholder — add screenshots to `docs/images/` and reference them here:_

| Executive dashboard (EN) | لوحة الإدارة (AR) | Content calendar | Mobile |
|---|---|---|---|
| `docs/images/dashboard-en.png` | `docs/images/dashboard-ar.png` | `docs/images/calendar.png` | `docs/images/mobile.png` |

## Quick start (local)

Requirements: Node.js 22, PostgreSQL 14+ (16 recommended).

```bash
cp .env.example .env
# set DATABASE_URL and ENCRYPTION_KEY:  openssl rand -base64 32
npm install
npx prisma migrate dev          # create schema
npm run db:seed                 # demo workspace (all data badged "Demo Data")
npm run dev                     # http://localhost:3000
npm run worker                  # background jobs (in a second terminal)
```

## Quick start (Docker)

```bash
cp .env.example .env.production   # set DOMAIN, ACME_EMAIL, POSTGRES_PASSWORD, ENCRYPTION_KEY, APP_URL=https://$DOMAIN …
docker compose --env-file .env.production up -d --build
# staging / demo only:
docker compose --env-file .env.production --profile demo run --rm seed
```

For a laptop without a domain, run Postgres only (`docker compose up -d db` with a published port via an override) and use the local quick start. Production deployment: [docs/deployment-hostinger.md](docs/deployment-hostinger.md).

## Demo logins

Created by `npm run db:seed` (staging/local only). Password for all: **`Demo@12345`** — ⚠️ **change it immediately or delete these users; never use them in production.**

| E-mail | Role | Sees |
|---|---|---|
| `admin@demo.local` | Super Admin | Everything |
| `manager@demo.local` | Company Manager | All clients |
| `team@demo.local` | Marketing Team | All clients |
| `creator@demo.local` | Marketing Team (English UI) | All clients |
| `client@demo.local` | Client | Nile Home Furniture only |
| `viewer@demo.local` | Viewer (read-only) | Nile Home Furniture only |

## Scripts

| Command | Does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev / production build (`prisma generate && next build`, standalone output) / start |
| `npm run worker` | Background job worker (`tsx worker/index.ts`) |
| `npm run typecheck` · `lint` · `test` | `tsc --noEmit` · ESLint · Vitest |
| `npm run db:migrate` · `db:migrate:dev` · `db:seed` · `db:studio` | `prisma migrate deploy` · `prisma migrate dev` · demo seed · Prisma Studio |
| `scripts/deploy.sh docker\|pm2` | Backup → build → migrate → restart → health check |
| `scripts/backup.sh` · `scripts/restore.sh` | Daily DB + uploads backup with rotation/off-site · verified restore |

## Documentation

| # | Document | Audience |
|---|---|---|
| — | [DEVELOPMENT.md](docs/DEVELOPMENT.md) — conventions, page & action recipes | Developers |
| 01 | [Product architecture](docs/01-product-architecture.md) | Everyone technical |
| 02 | [Roles & permissions](docs/02-roles-permissions.md) | Admins, developers |
| 03 | [Sitemap](docs/03-sitemap.md) | Product, developers |
| 04 | [Database schema](docs/04-database-schema.md) | Developers |
| 05 | [Integration architecture](docs/05-integration-architecture.md) | Developers |
| 06 | [Wireframes](docs/06-wireframes.md) | Product, design |
| 07 | [Design system](docs/07-design-system.md) | Design, frontend |
| 08 | [MVP & roadmap + acceptance checklist](docs/08-mvp-roadmap.md) | Product owner |
| — | [API reference](docs/api.md) | Developers |
| — | [Integrations setup (Meta, Google, TikTok, LinkedIn, X)](docs/integrations-setup.md) | Admins, DevOps |
| — | [Deployment on Hostinger](docs/deployment-hostinger.md) | DevOps |
| — | [Backup & restore](docs/backup-restore.md) | DevOps |
| — | [Security](docs/security.md) | Everyone |
| — | User guides: [Admin](docs/user-guide-admin.md) · [Team](docs/user-guide-team.md) · [Client](docs/user-guide-client.md) (AR + EN) | Users |
| — | Legal drafts: [Privacy policy](docs/legal/privacy-policy.md) · [Terms](docs/legal/terms.md) — **require legal review** | Legal |

## Tech stack

Next.js 15 (App Router, server components, server actions, `output: "standalone"`) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Prisma 6 + PostgreSQL 16 · Recharts · Zod · lucide-react · Anthropic SDK (optional, default model `claude-opus-5-5`) · Postgres-backed job queue + worker (`tsx`) · Vitest · ESLint · Docker / Caddy / nginx / PM2 · GitHub Actions.

## Project layout

```
src/app/(app)/*        authenticated pages (23)        src/lib/rbac.ts      permissions
src/app/(auth)/*       login, 2FA, reset, invite       src/lib/tenant.ts    client isolation
src/app/api/*          export, uploads, oauth, …       src/lib/integrations connectors
src/app/actions/*      server actions                  src/lib/ai/*         Claude + rule-based insights
src/components/*       UI kit, charts, layout          worker/              background jobs
prisma/                schema, migrations, seed        deploy/ scripts/     ops
```

## Security

Report vulnerabilities privately to **[[security@example.com]]**. See [docs/security.md](docs/security.md).

## License

Proprietary — © [[Agency legal name]]. All rights reserved.
