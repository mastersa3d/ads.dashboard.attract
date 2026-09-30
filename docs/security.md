# Security

> **ملخص بالعربية**
>
> - **الاتصال:** HTTPS إلزامي مع HSTS، وسياسة أمان محتوى (CSP) صارمة، ومنع عرض الصفحات داخل إطارات.
> - **الدخول:** كلمات مرور مشفرة بـ bcrypt، قفل الحساب بعد 5 محاولات فاشلة لمدة 15 دقيقة، مصادقة ثنائية (TOTP)، جلسات تُخزَّن كبصمة فقط وتنتهي بعد 7 أيام من عدم النشاط، وإمكانية تسجيل الخروج من كل الأجهزة.
> - **الصلاحيات وعزل العملاء:** كل صفحة وكل عملية تتحقق من الصلاحية ومن أن العميل ضمن نطاق المستخدم.
> - **الأسرار:** رموز المنصات مشفرة بـ AES-256-GCM، ولا يظهر منها إلا آخر 4 أحرف؛ مفتاح التشفير خارج قاعدة البيانات مع إجراء لتدويره.
> - **التدقيق:** كل إنشاء وتعديل وحذف واعتماد وتصدير وربط يُسجَّل في سجل التدقيق دون أي أسرار.
> - **الخصوصية:** أقل قدر من البيانات، لا تتبع خارجي، الصفحات غير قابلة للفهرسة، ونسخ احتياطية مشفرة ومحددة المدة.

Scope: application, infrastructure and operational controls. Report vulnerabilities privately to the security contact in the README; do not open public issues.

## 1. Transport, HTTPS & headers

* TLS terminates at Caddy (automatic Let's Encrypt, TLS 1.2/1.3, HTTP/3) or nginx + certbot (`deploy/nginx.conf`: TLS 1.2/1.3 only, HTTP→HTTPS redirect).
* Headers set by the app for every route (`next.config.ts`):

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (2 years) |
| `Content-Security-Policy` | `default-src 'self'`; `script-src 'self' 'unsafe-inline'` (+ `'unsafe-eval'` in dev only); `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`; `font-src 'self' https://fonts.gstatic.com data:`; `img-src 'self' data: blob: https:`; `connect-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-Robots-Tag` | `noindex, nofollow, noarchive` on everything except `/login`, `/legal` (middleware) |
| `X-Powered-By` | removed (`poweredByHeader: false`) |

Hardening backlog: replace `'unsafe-inline'` scripts with nonces (Next.js middleware nonce) once all inline scripts are removed; add `Cross-Origin-Opener-Policy: same-origin`. Submit the domain to the HSTS preload list only after confirming every subdomain serves HTTPS.

## 2. Cookies & sessions

| Property | Value (`src/lib/auth/session.ts`) |
|---|---|
| Cookie | `mimd_session`, `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/` |
| Token | 32 random bytes (base64url); DB stores only `sha256(token)` (`Session.tokenHash`) |
| Lifetime | 7 days, sliding (`lastSeenAt`/`expiresAt` refreshed at most every 5 min) |
| Binding info | `userAgent`, `ip` recorded for the session list and audit |
| Revocation | Logout deletes the row; "Sign out everywhere" deletes all sessions; password reset deletes all sessions; deactivated users (`active = false`) are rejected on the next request |
| 2FA state | `Session.twoFactorOk`; until true, `requireUser` redirects to `/two-factor` and `assertUser` throws |
| OAuth state | Separate `oauth_state` HttpOnly cookie, HMAC-signed, 10 min TTL |

The edge middleware only checks cookie presence; **validation happens server-side on every request** (`getCurrentUser`).

## 3. Authentication

* Passwords: bcrypt cost 12 (`bcryptjs`); policy ≥ 10 chars with at least one letter and one digit (`passwordSchema`); timing-equalised comparison for unknown e-mails.
* Lockout: 5 consecutive failures → `lockedUntil` +15 min; failures and successes audited (`login_failed`, `login`).
* Rate limits: login 20/15 min per IP and 8/15 min per e-mail; forgot-password 5/15 min per IP; 2FA 6/5 min per user.
* Password reset: single-use token (sha256 stored), 60 min expiry, same response whether or not the account exists (no user enumeration).
* Invitations: single-use hashed token with expiry; role and client access fixed by the inviter.
* Open-redirect protection: `next` parameter accepted only for same-site relative paths (`safeNext`).

### 2FA (TOTP)

* RFC 6238 via `otplib` (30 s step, ±1 window), QR code enrolment; secret encrypted (`User.totpSecretEnc`).
* Recommended policy: **mandatory for SUPER_ADMIN and COMPANY_MANAGER** (enforce in Settings → Security). Admin can reset a user's 2FA (audited).
* Recovery codes: planned (Phase 2); until then, admin reset after identity verification.

## 4. Authorization & tenant isolation

* Permissions: `src/lib/rbac.ts` — 44 `resource:action` permissions, role defaults, per-user overrides, **hard guards** (only SUPER_ADMIN gets `integrations:manage`/`settings:manage`; CLIENT can never get internal comments/approval, `users:manage`, `audit:view`). Full matrix: [02-roles-permissions.md](02-roles-permissions.md).
* Enforcement points: every page (`pageContext` → `requireUser(permission)`), every server action and route handler (`assertUser(permission)`), UI hides what the user can't do (defence in depth, not the control).
* Tenant isolation (`src/lib/tenant.ts`): every query on client-owned data spreads `ctx.scope`; ids from URLs/forms are verified with `assertClientAccess` (404 on mismatch, no existence leak); child tables filtered through the parent relation; archived clients drop out of scope.
* Sensitive-by-design separations: internal comments (`Comment.internal`), white-label hidden sections (also enforced on exports), public report links limited to one report's client and period.
* Code review checklist item: "Does every new query include `scope`?" — plus unit tests for tenant helpers.

## 5. CSRF

* Server actions: Next.js compares `Origin` with `Host` and rejects cross-site posts.
* Mutating route handlers: `assertSameOrigin(req)` (`src/lib/http.ts`), e.g. `POST /api/uploads`.
* `SameSite=Lax` session cookie blocks cross-site subresource/POST cookies.
* OAuth: signed `state` + nonce + same-user check; PKCE where supported.
* Webhooks: HMAC signature verification; cron: bearer secret. Neither uses cookies.

## 6. XSS

* React escapes all output; `dangerouslySetInnerHTML` is prohibited except for vetted static content.
* User-generated rich text (captions, comments, notes) is stored and rendered as plain text; links rendered with `rel="noopener noreferrer"`.
* Uploads: type detected by magic bytes, **SVG and HTML refused**, served from the authenticated `/api/uploads/[id]` with the detected `Content-Type` and `X-Content-Type-Options: nosniff`, never from `public/`.
* E-mail templates interpolate only trusted values (links built by `appUrl`).
* CSP restricts script sources to self.
* Exports: CSV cells starting with `= + - @` are prefixed to prevent formula injection in Excel.

## 7. SQL injection & input validation

* All DB access through Prisma's query builder (parameterised). Raw SQL (`$queryRaw`) only with tagged templates — never `$queryRawUnsafe` with user input.
* Every server action / route input is parsed with **Zod** (types, lengths, enums, id formats) before use.
* Filter params are whitelisted (`FILTER_KEYS`) and enum-cast; dates validated with a strict `YYYY-MM-DD` regex.
* File paths for uploads are generated server-side (random id) and checked to stay inside `UPLOAD_DIR` (path traversal guard).

## 8. Rate limiting & abuse

See [api.md §Rate limits](api.md#rate-limits). The limiter is in-memory per process (exact with one instance). Before running more than one app instance, move it to Postgres/Redis. nginx `limit_req` (commented template in `deploy/nginx.conf`) or Caddy rate-limit plugin can add an outer layer. `fail2ban` on SSH.

## 9. Secret management

| Secret | Where it lives | Rules |
|---|---|---|
| `ENCRYPTION_KEY`, `DATABASE_URL`, `CRON_SECRET`, SMTP, platform app secrets, `ANTHROPIC_API_KEY`, `SENTRY_DSN` | Env file on the server (`chmod 600`), or Docker/hPanel env | Never in git, images, logs, audit diffs or client bundles. Separate values per environment. |
| OAuth access/refresh tokens | DB, encrypted | Decrypted only in connectors/worker at use time. |
| TOTP secrets | DB, encrypted | Decrypted only for verification. |
| Session / reset / invite / share tokens | Only sha256 in DB | Raw token only in the cookie or the link. |

* `NEXT_PUBLIC_*` variables are shipped to the browser — only `NEXT_PUBLIC_APP_NAME` exists; never add secrets with that prefix.
* Logs and audit diffs pass through `sanitize()` (redacts keys matching `token|secret|password|authorization|cookie|api_key|…Enc`). Connector errors include only `METHOD host/path`.
* `/settings/integrations` shows env readiness as booleans only.
* Rotate platform secrets and `CRON_SECRET` when staff with server access leave.

## 10. Token encryption & key rotation

* AES-256-GCM with a random 96-bit IV per value and authentication tag (`src/lib/crypto.ts`); format `v1:<iv>:<tag>:<ciphertext>`.
* Key: 32 random bytes (`openssl rand -base64 32`), validated at startup of any crypto call.
* Display: `tokenLast4` → `****1234` only.

Rotation procedure (planned tooling; the `v1:` prefix exists for this):

1. Generate a new key; add it as `ENCRYPTION_KEY_NEXT` (key ring: v1 = old, v2 = new).
2. Deploy a release where `encrypt()` writes `v2:` with the new key and `decrypt()` accepts both prefixes.
3. Run a one-off re-encryption job over `Integration.accessTokenEnc`, `refreshTokenEnc`, `User.totpSecretEnc` (decrypt v1 → encrypt v2), in batches, audited.
4. Verify no `v1:` values remain; remove the old key from the environment; update the vault copy.
5. The OAuth `state` HMAC key is derived from `ENCRYPTION_KEY` — in-flight connects during the switch simply need a retry.

Emergency (key suspected leaked): rotate as above **and** revoke/reconnect all platform tokens (revoke in each platform's app settings), force 2FA re-enrolment, rotate platform app secrets.

## 11. Audit logging

* `AuditLog` row for: login / login_failed / 2fa_failed / password reset / invite accepted, create, update, delete, approve, reject, export (dataset + filters), connect / disconnect / test / sync, permission and role changes, share-link create/revoke, settings changes, AI recommendation accept/reject, bootstrap.
* Fields: organization, user id + e-mail, client, action, entity, entity id, summary, sanitized diff, IP, timestamp. Indexed `(organizationId, createdAt)`, `(entity, entityId)`.
* Viewable at `/audit` (`audit:view`: SUPER_ADMIN, COMPANY_MANAGER; never CLIENT); exportable (`audit` dataset).
* Append-only by application design (no update/delete actions). Retention: keep ≥ 12 months (configurable purge job).

## 12. Least privilege

* Default role for new users is `VIEWER` (schema default); inviters choose the role and clients explicitly.
* Platform scopes are read-only reporting scopes ([05](05-integration-architecture.md)).
* Containers run as non-root (uid 1001); Postgres not exposed to the internet; only 22/80/443 open; SSH keys only, root login disabled.
* systemd units use `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, explicit `ReadWritePaths`.
* Database: the app user owns only its database. For read-only analytics tooling create a separate `SELECT`-only role.
* Staging uses different secrets, DBs and platform apps; no production data without anonymisation.

## 13. Backups

Daily encrypted-at-rest off-site copies, checksum-verified, monthly restore drill, encryption key stored separately — see [backup-restore.md](backup-restore.md).

## 14. Privacy

* Data minimisation: we store aggregated campaign metrics (no end-user personal data from ad platforms), business contacts of clients, and team user accounts.
* No third-party analytics or trackers in the app; fonts are self-hosted by `next/font` at build time.
* All authenticated pages `noindex`; `robots.ts` allows only public pages.
* AI: only tenant-scoped aggregates are sent to the Claude API when a user invokes an AI feature; no training on customer data per the provider's API terms; feature can be disabled by omitting `ANTHROPIC_API_KEY`.
* Data subject requests: users can be deactivated/deleted; client workspaces can be archived and deleted (cascade). Backups roll off within the retention window.
* Sub-processors to list in the privacy policy: hosting (Hostinger), e-mail provider, optional Anthropic, optional Sentry, off-site backup storage, and the ad platforms the customer connects. See `docs/legal/privacy-policy.md`.

## 15. Dependency & release hygiene

* CI runs typecheck, lint, tests and build on every PR; enable Dependabot/Renovate and `npm audit --omit=dev` in CI.
* Pin base images (`node:22-alpine`, `postgres:16-alpine`, `caddy:2-alpine`) and rebuild monthly for security patches.
* `unattended-upgrades` on the VPS.

## 16. Incident response (short)

1. Contain (revoke sessions: `DELETE FROM "Session"`; disable affected integrations; rotate exposed secrets).
2. Preserve evidence (logs, `AuditLog` export, DB snapshot).
3. Eradicate & recover (patch, restore if needed).
4. Notify affected clients/authorities within legal deadlines (e.g. 72 h under GDPR-style laws, Egypt PDPL / UAE PDPL as applicable).
5. Post-mortem with action items tracked in `/tasks`.
