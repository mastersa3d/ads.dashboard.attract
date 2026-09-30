# 08 · MVP Scope & Roadmap

> **ملخص بالعربية**
>
> - **المرحلة 1 (الآن):** الأساس والنسخة الأولى — تعدد العملاء، الصلاحيات، اللغتان، لوحة الإدارة التنفيذية، التحليلات، الميزانية، تقويم المحتوى والموافقات، المنافسون، الاتجاهات، المعايير، التقارير، المهام، التنبيهات، سجل التدقيق، إطار التكاملات (Meta وGoogle وTikTok)، النشر على Hostinger، النسخ الاحتياطي.
> - **المرحلة 2:** تقوية التكاملات الحية — مراجعات التطبيقات لدى المنصات، LinkedIn وX، الـ webhooks، مراقبة المزامنة، استيراد CSV، اختبارات شاملة.
> - **المرحلة 3:** الذكاء الاصطناعي المتقدم والأتمتة — مساعد محادثة، توقعات أدق، اقتراحات إعادة توزيع الميزانية، توليد المحتوى بموافقة بشرية.
> - **المرحلة 4:** التوسع والمؤسسات — نطاقات مخصصة، SSO، تقسيم البيانات، تطبيق جوال.
>
> في نهاية الملف قائمة معايير قبول مرتبطة بكل ميزة للتحقق قبل التسليم.

## Phase 1 — Foundation + MVP (delivered now)

| Area | Scope | Status |
|---|---|---|
| Platform | Next.js 15 / React 19 / TS strict / Tailwind v4 / Prisma 6 / Postgres; standalone build; Docker + PM2 deploy; CI | Delivered |
| Auth & security | Login, lockout, password reset, invitations, TOTP 2FA, DB sessions, sign-out-everywhere, security headers, rate limits, audit log | Delivered |
| RBAC & tenancy | 5 roles, 44 permissions, per-user overrides, hard guards, `ClientAccess` scoping, white-label hidden sections | Delivered |
| i18n | Arabic RTL + English LTR, all UI strings in message namespaces | Delivered |
| Executive dashboard | KPIs vs previous/target/market, trend, platform split, pacing + forecast, top campaigns/ads, rule-based executive summary | Delivered (reference page) |
| Analytics & campaigns | Filters (27 URL keys), breakdowns, drill-down, exports | In progress (parallel team) |
| Strategy, budget, plan vs actual | Sections + approval; scenarios, allocation, expected results; variance; expenses | In progress |
| Content | Calendar (month/week/list, recurrence, conflicts, time zones, best time), library + uploads, two-stage approvals, internal comments, versions | In progress |
| Intelligence | Competitors (Meta Ad Library, intensity index, suggestions), trends & ideas, benchmarks | In progress |
| Reporting | Report builder, schedules, share links `/r/[token]`, tasks, notifications/alerts | In progress |
| Integrations | Connector framework, OAuth + PKCE + signed state, encrypted tokens, status machine, incremental sync; Meta (Ads, Pages, Instagram), Google (Ads, GA4, Search Console, YouTube), TikTok | Framework delivered; live verification per platform in Phase 2 |
| Ops | Worker + Postgres queue, `/api/health`, `/api/cron` fallback, backups + restore drill, structured logs | Delivered |
| Demo | Two demo clients, 2 years of seasonal data, all badged DEMO | Delivered |

## Phase 2 — Live integrations hardening (≈ 6–8 weeks)

* Pass platform reviews: Meta App Review (Advanced Access `ads_read`, `pages_read_engagement`, `instagram_manage_insights`) + Business Verification; Google Ads developer token Basic access; Google OAuth verification for sensitive scopes; TikTok app approval; LinkedIn Advertising API access.
* LinkedIn Ads and X connectors (X behind paid-tier flag).
* Webhooks (Meta Page/Instagram) → targeted incremental syncs.
* Breakdown syncs (device, placement, age, gender, country) with per-client toggles to control row volume.
* CSV/Excel import wizard (`source = IMPORT`) for platforms without API access and for Google Trends exports.
* Sync observability: SyncRun dashboard, alert on N consecutive failures, per-platform quota usage.
* Move rate limiter to Postgres so the app can run with 2+ instances.
* End-to-end tests (Playwright) for the 23 pages in both locales; visual regression at 360 px / 1440 px.
* Sentry wiring (`SENTRY_DSN`) and uptime monitoring on `/api/health`.

## Phase 3 — Advanced AI & automation (≈ 8–10 weeks)

* AI assistant chat scoped to the current filters (Claude via `lib/ai/claude.ts`, same guard-rails, every answer cites sources).
* AI strategy drafts per section, budget reallocation proposals, caption/hook variants, competitor-ad adaptations — all as PENDING `AiRecommendation` with accept/reject and audit.
* Better forecasting (seasonality from 2-year history, Ramadan/White Friday calendars, confidence bands).
* Anomaly detection on daily metrics feeding alerts.
* Automated monthly report narratives (human approves before sending).
* Rule builder for alerts (thresholds per client/platform/KPI).

## Phase 4 — Scale & enterprise

* Per-agency custom domains (`Organization.customDomain`) with automatic TLS.
* SSO (Google Workspace / Microsoft Entra ID, SAML/OIDC), SCIM provisioning.
* `MetricDaily` monthly partitioning + rollups; read replica; object storage for uploads.
* Publishing to platforms (post scheduling) — only after explicit scope approval; still read-only for ads.
* Native mobile wrapper / PWA with push notifications.
* Data residency options and DPA templates.

## Acceptance criteria checklist

Tick each item on staging with demo data **and** with one real connected client before production go-live.

### Cross-cutting

- [ ] Every page in [03-sitemap](03-sitemap.md) renders in Arabic (RTL) and English (LTR) with no untranslated keys and no mirrored numbers.
- [ ] Every page works at 360 px (no page-level horizontal scroll; tables scroll inside cards).
- [ ] Every chart/table shows source, last update, and Demo / Estimate badges where applicable.
- [ ] Loading skeleton, empty state and error state exist for every data page.
- [ ] Every create/update/delete/approve/reject/export/connect writes an `AuditLog` row without secrets.
- [ ] Exports (CSV, Excel, PDF, PNG) respect current filters, permissions, tenant scope and hidden sections.
- [ ] Light and dark themes pass WCAG AA contrast.

### Auth, roles, tenancy

- [ ] 5 failed logins lock the account for 15 minutes; reset link expires in 60 min and signs out all sessions.
- [ ] 2FA enrolment + challenge works; protected pages redirect to `/two-factor` until verified.
- [ ] Matrix in [02](02-roles-permissions.md) holds for all 5 demo users (`admin@`, `manager@`, `team@`, `client@`, `viewer@demo.local`).
- [ ] `client@demo.local` sees only "Nile Home Furniture", never internal comments, audit log or hidden sections.
- [ ] Changing `?client=` to another org's/unassigned client id returns empty results / 404, never data.
- [ ] Non-super-admin cannot connect integrations even with a permission override.

### Dashboard & analytics

- [ ] KPI cards show value, delta vs comparison period, target (from budget plan) and market benchmark with correct good/bad tone per KPI direction.
- [ ] Multi-currency clients roll up in the reporting currency with an FX note.
- [ ] Executive summary sentences each carry kind, source and confidence; no invented numbers.
- [ ] Filters (client, brand, account, platform, date, compare, objective, campaign, funnel…) apply to every widget and survive navigation and saved views.

### Budget

- [ ] Plan lines sum to total (warning otherwise); scenarios change expected results via assumptions.
- [ ] Approval requires `budget:approve`; approved plans are read-only except by approvers.
- [ ] Plan vs actual shows variance per line with tones; manual expenses included.
- [ ] Forecast and depletion date labelled as estimates.

### Content

- [ ] Status flow follows `src/lib/content/workflow.ts`; team can submit, only internal approvers approve internally, clients approve at client stage.
- [ ] Internal comments invisible to CLIENT role.
- [ ] Calendar respects client time zone; conflicts flagged; recurrence creates a series.
- [ ] Uploads: ≤ 25 MB, allowed types only (magic-byte check), files only reachable through authenticated `/api/uploads/[id]`.

### Intelligence

- [ ] Competitor ads come only from the Meta Ad Library API or manual entry; spend shown only when officially disclosed; otherwise Estimated Advertising Intensity with formula tooltip.
- [ ] Suggested competitors stay PENDING until accepted.
- [ ] Trends show source and date; Google Trends marked manual/import.
- [ ] Benchmarks display source, as-of date, sample size, estimate flag.

### Reports, tasks, alerts

- [ ] Scheduled report e-mails arrive at the configured time with correct period.
- [ ] Share link works logged-out, expires on `shareExpiresAt`, can be revoked, is `noindex`.
- [ ] Alerts deduplicate (`dedupeKey`) and respect user preferences (in-app / e-mail / threshold).
- [ ] Tasks can be created from report action items and alerts.

### Integrations

- [ ] OAuth connect for Meta, Google Ads, GA4, Search Console, YouTube, TikTok succeeds with the redirect URIs in [integrations-setup](integrations-setup.md).
- [ ] Tokens stored encrypted; UI and logs show only `****last4`.
- [ ] Missing scope → PERMISSION_MISSING with the missing scope listed; revoked token → EXPIRED + notification.
- [ ] Incremental sync re-pulls the last 3 days, is idempotent, and records a `SyncRun`.
- [ ] Rate-limit responses are retried with backoff; no secrets in error messages.

### Operations

- [ ] `docker compose up -d` on a fresh VPS yields HTTPS on `DOMAIN`, healthy `/api/health`.
- [ ] `scripts/deploy.sh` runs migrations and restarts with < 10 s disruption.
- [ ] Daily backup produced, rotated, copied off-site; restore drill completed within the RTO (see [backup-restore](backup-restore.md)).
- [ ] Demo seed never runs in production.
