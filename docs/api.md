# API Reference

> **ملخص بالعربية:** تعتمد المنصة أساسًا على *Server Actions* داخل Next.js للعمليات من الواجهة، إضافةً إلى عدد محدود من نقاط HTTP: تصدير البيانات، رفع الملفات وتنزيلها، ربط المنصات (OAuth)، استقبال الـ webhooks، فحص الصحة، مهام الـ cron، والتقارير المشاركة. كل نقطة تتحقق من الجلسة والصلاحية ونطاق العميل، وتُرجع أخطاء JSON موحدة، وتخضع لحدود معدل الطلبات.

There is **no public REST API for third parties** in Phase 1. HTTP endpoints exist for things server actions can't do (file streams, OAuth redirects, platform callbacks, health, cron). Everything else is a server action.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `APP_URL` (e.g. `https://dashboard.example.com`). |
| Auth | Session cookie `mimd_session` (HttpOnly, Secure, SameSite=Lax) set by `/login`. Route handlers call `assertUser(permission)`; unauthenticated → `401`, missing permission → `403`. Users with 2FA enabled but not verified in this session are treated as unauthenticated. |
| Tenant scope | Any `clientId` / entity id is checked with `assertClientAccess` or scoped queries; out-of-scope ids return `404` (existence is never revealed). |
| CSRF | Server actions: built-in Origin check. Mutating route handlers: `assertSameOrigin(req)` (`Origin` host must equal `Host`/`X-Forwarded-Host`). OAuth callback: signed `state` cookie. Webhooks: platform signature. Cron: bearer secret. |
| Content type | JSON responses `application/json; charset=utf-8` unless streaming a file. |
| Caching | Authenticated responses are `Cache-Control: no-store`. |
| Robots | Every non-public response carries `X-Robots-Tag: noindex, nofollow, noarchive` (middleware). |

### Error format

`src/lib/http.ts` `handleRouteError()`:

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "VALIDATION", "issues": [ …zod issues… ] }` | Zod validation failed |
| 400 | `{ "error": "NO_FILE" }` etc. | Route-specific input errors |
| 401 | `{ "error": "UNAUTHENTICATED" }` | No/expired session, or 2FA pending |
| 403 | `{ "error": "FORBIDDEN" }` | Missing permission, cross-origin mutation, hidden section |
| 404 | `{ "error": "NOT_FOUND" }` / `{ "error": "UNKNOWN_DATASET" }` | Out of tenant scope or unknown resource |
| 413 | `{ "error": "TOO_LARGE" }` | Upload > 25 MB |
| 415 | `{ "error": "UNSUPPORTED_TYPE" }` | File type not allowed |
| 429 | `{ "error": "RATE_LIMITED" }` + `Retry-After` header (seconds) | Rate limit exceeded |
| 500 | `{ "error": "INTERNAL" }` | Unexpected; details only in server logs |

### Rate limits

In-memory sliding window per process (`src/lib/rate-limit.ts`). With one app instance these are exact; if you scale out, move the store to Postgres/Redis first.

| Key | Limit |
|---|---|
| Login per IP | 20 / 15 min |
| Login per e-mail | 8 / 15 min |
| 2FA per user | 6 / 5 min |
| Forgot password per IP | 5 / 15 min |
| Export per user | 20 / min |
| Upload per user | 30 / min |
| AI generation per user (planned) | 10 / min |

Account lockout: 5 consecutive failed logins → locked 15 minutes (`User.lockedUntil`).

## 2. Route handlers

### `GET /api/export/[dataset]`

Streams the current filtered view as CSV or Excel. Implemented in `src/app/api/export/[dataset]/route.ts`.

| | |
|---|---|
| Query | All global filter keys (`client, brand, account, platform, from, to, compare, objective, campaign, adset, ad, status, funnel, mode, country, branch, product, audience, device, placement, gender, age, currency, manager, creator, ctype, cstatus`) + `format=csv|xlsx` (default csv) |
| Auth | Session; permission per dataset |
| Limits | 20 req/min/user; max `EXPORT_ROW_LIMIT = 50 000` rows |
| Audit | `action: "export"`, `entity: "Export"`, `entityId: <dataset>`, diff `{ dataset, format, query, limit }` |
| White label | CLIENT users get `403` for datasets whose section is in `Client.hiddenSections` |
| Response | `200` stream, `Content-Disposition: attachment; filename="<dataset>-<yyyy-mm-dd>.<ext>"`, `Cache-Control: no-store` |

| Dataset | Permission |
|---|---|
| `campaigns`, `adsets`, `ads` | `campaigns:view` |
| `platforms`, `daily` | `analytics:view` |
| `content` | `content:view` |
| `budget` | `budget:view` |
| `benchmarks` | `benchmarks:view` |
| `competitors`, `competitor-ads` | `competitors:view` |
| `ideas` | `trends:view` |
| `tasks` | `tasks:view` |
| `audit` | `audit:view` |

```bash
curl -b "mimd_session=…" "https://dashboard.example.com/api/export/campaigns?client=ck…&from=2026-09-01&to=2026-09-30&format=xlsx" -o campaigns.xlsx
```

### `POST /api/uploads`

Multipart upload of a content asset (`src/app/api/uploads/route.ts`).

| | |
|---|---|
| Body | `multipart/form-data`: `file` (required), `clientId` (required), `tags` (optional, comma-separated, ≤ 10) |
| Auth | Session + `content:edit` + `assertClientAccess(clientId)` + same origin |
| Limits | 25 MB; 30 uploads/min/user |
| Types | Detected by magic bytes (browser MIME ignored): JPEG, PNG, GIF, WebP, HEIC, PDF, MP4, MOV, WebM. SVG and everything else → `415`. |
| Storage | `<UPLOAD_DIR>/<clientId>/<assetId>.<ext>` (random 24-hex id), outside `public/`. `FileAsset` row + audit. |
| Response | `200 { id, url, name, mimeType, sizeBytes }` |

### `GET /api/uploads/[id]`

Streams a stored file after `content:view` + tenant check. Supports single byte ranges (video seeking, `206`). `?download=1` forces `Content-Disposition: attachment`. `404` for unknown or out-of-scope ids.

### `GET /api/oauth/[platform]/start`

Begins an OAuth connection (`src/app/api/oauth/[platform]/start/route.ts`). `[platform]` is the **connector id**: `meta`, `facebook`, `instagram`, `google-ads`, `ga4`, `search-console`, `youtube`, `google-calendar`, `google-drive`, `tiktok`, `linkedin`, `linkedin-pages`, `x`, `outlook-calendar`, `onedrive`.

| | |
|---|---|
| Query | `integration=<Integration id>` — the integration row is created first from `/settings/integrations` (per client or org-wide) |
| Auth | Session (else redirect `/login`) + `integrations:manage` (SUPER_ADMIN only); integration must belong to the user's organization and an accessible client |
| Effect | Sets HttpOnly cookie `oauth_state` (HMAC-signed payload: nonce, org, client, integration, user, connector, PKCE verifier; 10-minute TTL) and `302` to the platform's consent screen with `state=<nonce>` and `redirect_uri=${APP_URL}/api/oauth/<id>/callback` |
| Errors | Redirect back to `/settings/integrations?oauthError=FORBIDDEN|NOT_FOUND|UNSUPPORTED|NOT_CONFIGURED` |

### `GET /api/oauth/[platform]/callback`

| | |
|---|---|
| Query | `code`, `state` (or `error`, `error_description` from the platform) |
| Checks | `verifyState(cookie, state)`: signature, expiry, nonce, same user and organization that started the flow; user still has `integrations:manage` |
| Effect | Exchange code → test connection → encrypt tokens → status via `deriveStatus()` → audit `connect` → enqueue initial `sync.integration` → `302 /settings/integrations?connected=<id>` |
| Failure | `302 /settings/integrations?oauthError=<CODE>`; never echoes tokens or platform messages containing URLs |

### `GET|POST /api/webhooks/meta`

Public (no session). `src/app/api/webhooks/meta/route.ts`. Other platforms will get `/api/webhooks/<platform>` routes as they are added.

| | |
|---|---|
| `GET` (Meta verification) | `hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` → echoes `hub.challenge` iff `hub.verify_token === META_WEBHOOK_VERIFY_TOKEN` |
| `POST` | Verifies `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with `META_APP_SECRET`, constant-time compare); unknown/invalid → `401` |
| Effect | Enqueue `sync.integration` for the affected page/account only; respond `200` quickly. Payload data is never trusted as metrics. |

### `GET /api/health`

Public (`src/app/api/health/route.ts`). Used by Docker `HEALTHCHECK`, Caddy `health_uri`, uptime monitors and `scripts/deploy.sh`.

```json
200 { "status": "ok", "version": "0.1.0", "db": "ok", "latencyMs": 3, "time": "2026-09-30T10:00:00.000Z" }
503 { "status": "degraded", "version": "0.1.0", "db": "unreachable", "latencyMs": 5002, "time": "…" }
```

Runs `SELECT 1`; never exposes configuration or secrets; `Cache-Control: no-store`.

### `POST|GET /api/cron/[task]`

Runs the scheduler and due jobs when no worker process is available (Hostinger shared/Cloud Node.js hosting). Safe alongside a worker (jobs are claimed with `SKIP LOCKED`). `src/app/api/cron/[task]/route.ts`.

| | |
|---|---|
| Auth | `Authorization: Bearer <CRON_SECRET>` (or `X-Cron-Secret`), constant-time compare. The secret is never accepted in the URL (it would end up in access logs). |
| Config | `CRON_SECRET` unset or shorter than 16 chars → `503 { "error": "CRON_SECRET not configured" }` |
| Tasks | `tick` (schedule + run any due job), `sync` (`sync.integration`), `alerts` (`alerts.evaluate`), `reports` (`report.send`), `tokens` (`token.check`). Unknown → `404 UNKNOWN_TASK`; bad secret → `401 UNAUTHORIZED`. |
| Budget | Claims one job at a time for up to 45 s (`maxDuration` 60 s) |
| Response | `200 { "ok": true, "task": "tick", "scheduled": …, "processed": 7, "ms": 41234 }` |

```bash
# Hostinger hPanel → Advanced → Cron Jobs (every 5 minutes)
curl -fsS -m 70 -X POST -H "Authorization: Bearer <CRON_SECRET>" https://dashboard.example.com/api/cron/tick
```

### `GET /r/[token]` (page, public)

Read-only shared report. The token is looked up by `sha256(token)` in `Report.shareTokenHash`; expired (`shareExpiresAt`) or revoked links return 404. Rendered without app chrome, with the client's report theme; `noindex`; data limited to the report's client and period. Creating/revoking links requires `reports:share` and is audited.

## 3. Server actions (overview)

Server actions live in `src/app/actions/*.ts` (and co-located `actions.ts` files next to pages). Every action follows the recipe in [DEVELOPMENT.md](DEVELOPMENT.md#server-actions): `assertUser(permission)` → Zod `parse` → `assertClientAccess` → scoped write → `audit()` → `revalidatePath`.

| Module | Examples | Permission(s) |
|---|---|---|
| Auth (`actions/auth.ts`) | `loginAction`, `twoFactorAction`, `forgotPasswordAction`, `resetPasswordAction`, `acceptInviteAction`, `signOutEverywhere` | public / session |
| Preferences (`actions/preferences.ts`) | locale, theme, saved views | session |
| Clients (`actions/clients.ts`) | create/edit/archive client, brands, accounts, white-label, access | `clients:create`, `clients:edit`, `clients:delete` |
| Strategy | save section, submit, approve, accept/reject AI recommendation | `strategy:edit`, `strategy:approve`, `ai:use` |
| Budget | create plan, edit lines, approve, record expense | `budget:edit`, `budget:approve`, `expenses:edit` |
| Content | create/edit/delete item, move status, reschedule, comment, approve | `content:create/edit/delete/submit`, `content:approve_internal`, `content:approve_client`, `content:comment(_internal)` |
| Competitors / trends / benchmarks | add competitor, accept suggestion, scan ad library, add trend, create idea, edit benchmark | `competitors:edit`, `trends:edit`, `benchmarks:edit` |
| Reports / tasks | build, schedule, send now, share/revoke link; create/update task | `reports:create`, `reports:share`, `tasks:edit` |
| Users | invite, change role/overrides/access, deactivate, reset 2FA | `users:manage` |
| Settings / integrations | org settings, FX rates, connect/disconnect/test/sync now, manual token | `settings:manage`, `integrations:manage` |
| Notifications | mark read, preferences | session |

Action errors: `AuthError` codes are surfaced to the form as translated messages; Zod issues map to field errors; nothing internal is returned to the browser.

## 4. Versioning & stability

HTTP routes are internal and versioned with the app. Breaking changes are listed in release notes. A public, token-authenticated API (`/api/public/v1/*`, already excluded from the session gate in `middleware.ts`) is on the Phase 4 roadmap.
