# Integrations Setup Guide

> **ملخص بالعربية**
>
> لكل منصة تحتاج إلى إنشاء "تطبيق مطوّر" لدى المنصة نفسها، ثم وضع مفاتيحه في ملف البيئة (`.env`) على الخادم، ثم الضغط على "ربط" من صفحة **الإعدادات ← التكاملات** (مدير النظام فقط).
>
> - رابط العودة (Redirect URI) لكل منصة يكون دائمًا بالشكل: `APP_URL/api/oauth/<المعرف>/callback` مثل `https://dashboard.example.com/api/oauth/meta/callback`.
> - نطلب صلاحيات **قراءة فقط** لأغراض التقارير.
> - معظم المنصات تتطلب **مراجعة التطبيق** والتحقق من النشاط التجاري قبل استخدام حسابات العملاء الحقيقية؛ ابدأ الطلبات مبكرًا لأنها قد تستغرق أيامًا أو أسابيع.
> - Google Trends لا يملك واجهة رسمية: استخدم الاستيراد اليدوي. واجهة X تتطلب اشتراكًا مدفوعًا.

Consoles change their UI often; the steps below reflect the platforms at the time of writing — follow the linked official docs if a label differs. Architecture: [05-integration-architecture.md](05-integration-architecture.md).

## 0. Before you start

1. Production URL decided and HTTPS working (`APP_URL`, e.g. `https://dashboard.example.com`). Platforms reject `http://` redirect URIs except `localhost`.
2. Public pages ready: privacy policy `APP_URL/legal/privacy`, terms `APP_URL/legal/terms` (see `docs/legal/`), and a support e-mail. Every review asks for them.
3. A business entity with documents (commercial registration, utility bill / bank statement) for business verification.
4. A test ad account on each platform with some spend, and a screen recording of the connect → report flow (required by Meta and TikTok reviews).
5. After setting env vars, restart app **and** worker (`docker compose up -d app worker` or `pm2 reload all --update-env`). `/settings/integrations` shows each required env var as set / not set (values are never displayed).

### Redirect URIs (register exactly — scheme, host, path, no trailing slash)

| Connector | Redirect URI |
|---|---|
| Meta Ads | `${APP_URL}/api/oauth/meta/callback` |
| Facebook Pages | `${APP_URL}/api/oauth/facebook/callback` |
| Instagram | `${APP_URL}/api/oauth/instagram/callback` |
| Google Ads | `${APP_URL}/api/oauth/google-ads/callback` |
| GA4 | `${APP_URL}/api/oauth/ga4/callback` |
| Search Console | `${APP_URL}/api/oauth/search-console/callback` |
| YouTube | `${APP_URL}/api/oauth/youtube/callback` |
| Google Calendar (optional) | `${APP_URL}/api/oauth/google-calendar/callback` |
| Google Drive (optional) | `${APP_URL}/api/oauth/google-drive/callback` |
| TikTok Ads | `${APP_URL}/api/oauth/tiktok/callback` |
| LinkedIn Ads | `${APP_URL}/api/oauth/linkedin/callback` |
| LinkedIn Pages | `${APP_URL}/api/oauth/linkedin-pages/callback` |
| X | `${APP_URL}/api/oauth/x/callback` |
| Outlook Calendar (optional) | `${APP_URL}/api/oauth/outlook-calendar/callback` |
| OneDrive (optional) | `${APP_URL}/api/oauth/onedrive/callback` |

Add the staging equivalents (`https://staging.example.com/...`) to the same apps, or create separate staging apps (recommended for Meta/TikTok so reviews of the production app aren't affected).

---

## 1. Meta (Facebook Ads, Pages, Instagram, Ad Library)

Env: `META_APP_ID`, `META_APP_SECRET`, `META_AD_LIBRARY_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`, optional `META_GRAPH_VERSION` (default `v23.0`).
Docs: <https://developers.facebook.com/docs/marketing-apis/get-started>

1. Go to **developers.facebook.com → My Apps → Create App**. Choose the use case for managing business assets / Marketing API (app type **Business**). Link it to your agency's **Business Portfolio** (Business Manager).
2. **App settings → Basic**: note **App ID** → `META_APP_ID`, **App Secret** → `META_APP_SECRET`. Fill App Domains (`dashboard.example.com`), Privacy Policy URL, Terms URL, data-deletion instructions URL (can be the privacy page section), category, icon.
3. **Add products**: *Facebook Login for Business* and *Marketing API*. In **Facebook Login for Business → Settings**, add the three Meta redirect URIs above to **Valid OAuth Redirect URIs**. Keep "Enforce HTTPS" and "Strict mode" on.
4. Permissions requested by the connectors (read-only):

   | Connector | Permissions |
   |---|---|
   | `meta` (ads) | `ads_read`, `business_management` |
   | `facebook` (pages) | `pages_show_list`, `pages_read_engagement`, `read_insights` |
   | `instagram` | `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement` |

5. **Development mode**: works immediately for people with a role on the app (admins/developers/testers) and assets they manage — enough for staging.
6. **Go live**: complete **Business Verification** (Business Settings → Security Center) and submit **App Review** for **Advanced Access** to each permission above, with a screencast per permission and a description of how data is displayed. Request Marketing API **Standard Access** (higher rate limits). Then switch the app to **Live**.
7. **Alternative (no user OAuth):** create a **System User** in Business Settings, assign the client ad accounts/pages, generate a token with the same permissions and paste it via "Use a token" on the Meta card (`manualToken`). Best for agencies that own the Business Portfolio relationship.
8. **Ad Library API (competitors)**: visit <https://www.facebook.com/ads/library/api>, complete identity confirmation for the developer account, then in **Graph API Explorer** generate a user token for your app and exchange it for a long-lived token (≈ 60 days). Put it in `META_AD_LIBRARY_TOKEN`. Set a reminder to renew it; the competitor page shows a setup message when it is missing or expired. Spend is only returned for ads Meta discloses (political/issue, some EU ads).
9. **Webhooks (optional, Phase 2)**: Products → *Webhooks* → Page / Instagram objects → Callback URL `${APP_URL}/api/webhooks/meta`, Verify token = value of `META_WEBHOOK_VERIFY_TOKEN`. Subscribe only to fields you need (e.g. `feed`).
10. Instagram accounts must be **Professional** (Business/Creator) and linked to a Facebook Page the connecting user can access.

---

## 2. Google (Ads, GA4, Search Console, YouTube)

Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (if accounts are under an MCC), optional `GOOGLE_ADS_API_VERSION`.

### 2.1 Google Cloud project & OAuth client

1. <https://console.cloud.google.com> → create a project (e.g. `mimd-prod`).
2. **APIs & Services → Library** → enable: *Google Ads API*, *Google Analytics Data API*, *Google Analytics Admin API* (lists properties), *Google Search Console API*, *YouTube Data API v3*, *YouTube Analytics API* (+ *Google Calendar API*, *Google Drive API* if used).
3. **Google Auth Platform / OAuth consent screen**: User type **External**; app name, support e-mail, logo, app home page (`APP_URL`), privacy & terms URLs, **authorized domain** (`example.com`), developer contact.
4. **Data access / Scopes**: add
   `https://www.googleapis.com/auth/adwords`, `…/auth/analytics.readonly`, `…/auth/webmasters.readonly`, `…/auth/youtube.readonly`, `…/auth/yt-analytics.readonly` (+ `…/auth/calendar.readonly`, `…/auth/drive.file` if used).
5. **Clients → Create client → Web application**. Authorized redirect URIs: all Google rows from the table above. Copy **Client ID** → `GOOGLE_CLIENT_ID`, **Client secret** → `GOOGLE_CLIENT_SECRET`.
6. **Testing vs production**: while the app is in *Testing*, only listed test users can connect **and refresh tokens expire after 7 days**. Before production, click **Publish app** and complete **verification** (sensitive scopes: brand verification, domain ownership in Search Console, a YouTube demo video showing scope usage). Allow 1–4 weeks.

### 2.2 Google Ads developer token

1. Sign in to a **Google Ads Manager account (MCC)** — create one if the agency doesn't have it, and link client accounts to it.
2. **Admin (Tools) → API Center**: accept terms and request a **developer token**. Put it in `GOOGLE_ADS_DEVELOPER_TOKEN`.
3. A new token has **Test access** (test accounts only). Apply for **Basic access** (form with company info and a design document describing read-only reporting). Basic access allows 15,000 operations/day, ample for reporting.
4. Set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the MCC id **without dashes** when client accounts are accessed through the manager account.

### 2.3 GA4

The connecting user needs at least **Viewer** on the GA4 property. Data API quotas are per property (token buckets); keep syncs daily. Thresholding may hide small user counts — the UI shows what the API returns.

### 2.4 Search Console

The connecting user must be a verified **owner or full user** of the property (domain or URL-prefix). Data is final after ~2–3 days; the connector re-pulls recent days automatically.

### 2.5 YouTube

Connect with the Google account that owns or manages the channel (Brand Account users: choose the channel during consent). Data API default quota is 10,000 units/day per project; request more in the console if needed.

---

## 3. TikTok for Business (Marketing API)

Env: `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`. Docs: <https://business-api.tiktok.com/portal/docs>

1. Register at **business-api.tiktok.com** as a developer (company details).
2. **My Apps → Create app**: name, description of read-only reporting use, **Advertiser redirect URL** = `${APP_URL}/api/oauth/tiktok/callback`.
3. Select scopes (permissions) — read-only: *Ad Account Management* (read), *Ads Management* (read), *Reporting*, *Audience* not needed. Scopes are fixed on the app; the token response lists them as ids.
4. Submit for review (usually a few business days). After approval copy **App ID** → `TIKTOK_APP_ID` and **Secret** → `TIKTOK_APP_SECRET`.
5. Advertiser authorization happens through the OAuth link from `/settings/integrations`; the token is long-lived (no refresh) — reconnect if an advertiser revokes it (status becomes EXPIRED).
6. Reporting API limits: max 30 days per request (the connector chunks), per-app QPS/QPM limits.

---

## 4. LinkedIn (Marketing API)

Env: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, optional `LINKEDIN_API_VERSION` (YYYYMM). Docs: <https://learn.microsoft.com/linkedin/marketing/>

1. <https://www.linkedin.com/developers/apps> → **Create app**, associate it with your agency's **LinkedIn Company Page** (a page admin must verify the association).
2. **Products** → request **Advertising API** (application form; approval can take several weeks). For organic page analytics, the *Community Management API* is required and LinkedIn requires it to be on a **separate app** — create a second app if you need organic data.
3. **Auth** tab → Authorized redirect URLs: `${APP_URL}/api/oauth/linkedin/callback` and `${APP_URL}/api/oauth/linkedin-pages/callback`. Copy Client ID/Secret.
4. Scopes: `r_ads`, `r_ads_reporting` (connector `linkedin`); `r_organization_social`, `rw_organization_admin` (connector `linkedin-pages`, Community Management API).
   Both connectors read `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`; if LinkedIn requires two separate apps, run the Pages app under a separate deployment or ask the team to add dedicated env vars.
5. Access tokens last 60 days; programmatic refresh tokens (1 year) are available to approved Marketing partners. The integration card warns 14 days before expiry.
6. The connecting user needs at least *Viewer* on each Campaign Manager ad account.

---

## 5. X (Twitter)

Env: `X_CLIENT_ID`, `X_CLIENT_SECRET`. Docs: <https://developer.x.com/en/docs>

1. <https://developer.x.com> → sign up and choose an access tier. **The Free tier does not allow meaningful reads**; reporting requires a **paid tier** (Basic or higher). Budget for it before promising X data to clients.
2. Create a **Project** and an **App** inside it.
3. **User authentication settings** → OAuth 2.0 on, type **Web App (confidential client)**, Callback URI `${APP_URL}/api/oauth/x/callback`, Website URL `APP_URL`, privacy & terms URLs.
4. Scopes: `tweet.read`, `users.read`, `offline.access` (refresh token). PKCE is used.
5. Copy OAuth 2.0 **Client ID** / **Client Secret** → `X_CLIENT_ID` / `X_CLIENT_SECRET`.
6. **X Ads API** (paid campaign metrics) requires a separate application at <https://ads.x.com> → developer access; until approved, the X card syncs organic profile metrics only.

---

## 5b. Microsoft (Outlook Calendar, OneDrive) — optional placeholders

Env: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID` (empty = `common`).

1. <https://entra.microsoft.com> → **App registrations → New registration**; supported account types per your needs; Web redirect URIs: the two Microsoft rows in §0.
2. **Certificates & secrets** → new client secret → `MS_CLIENT_SECRET`; **Overview** → Application (client) ID → `MS_CLIENT_ID`, Directory (tenant) ID → `MS_TENANT_ID`.
3. **API permissions** (delegated): `User.Read`, `Calendars.Read`, `Files.Read`, `offline_access`.
4. These connectors only store the connection today; no data is synced.

## 6. Google Trends

There is **no official public Google Trends API**. The platform does not scrape it. Options:

* Export CSV from trends.google.com and import it in **Trends → Import** (`source = IMPORT`, `sourceName = "Google Trends"`).
* Enter signals manually with the source URL.
* Use Search Console queries (official) as the automated demand signal.

---

## 7. E-mail (SMTP)

Hostinger e-mail: `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER=no-reply@yourdomain`, `SMTP_PASSWORD=…`, `MAIL_FROM="Brand <no-reply@yourdomain>"`. Add SPF, DKIM and DMARC records for the sending domain so reports don't land in spam. Without `SMTP_HOST` mails are only logged.

## 8. AI (optional)

`ANTHROPIC_API_KEY` from <https://console.anthropic.com> (organization → API keys). `AI_MODEL` defaults to `claude-opus-5-5`. Without a key the rule-based insights engine is used and AI actions are hidden. Set a monthly spend limit in the Anthropic console.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `redirect_uri_mismatch` / "URL blocked" | URI not registered exactly, or `APP_URL` differs (www, trailing slash, http) | Register the exact URI from §0; restart after changing `APP_URL`. |
| Card shows **NOT_CONFIGURED** / env ✗ | Env var missing in the running process | Set it in `.env(.production)`, restart app **and** worker. |
| **PERMISSION_MISSING** | User unticked a permission, or app lacks Advanced Access | Reconnect and grant all; for Meta check App Review status. |
| **EXPIRED** after 7 days (Google) | OAuth app still in *Testing* | Publish the consent screen and verify. |
| Google Ads `DEVELOPER_TOKEN_NOT_APPROVED` | Token has Test access | Apply for Basic access or use test accounts. |
| Meta error code 4 / 17 / 613 | Rate limit | Automatic backoff; reduce sync frequency or request Standard Access. |
| No competitor ads | `META_AD_LIBRARY_TOKEN` missing/expired or identity not confirmed | Renew token; confirm identity. |
| Sync stuck in SYNCING | Worker not running | `docker compose ps worker` / `pm2 status`; on shared hosting check the `/api/cron` job. |
