import { ConnectorError, type Connector, type NormalizedMetric, type NormalizedOrganic, type TokenSet } from "../types";
import { requestJson, withQuery, extractMessage } from "../http";
import { requireEnv, hasEnv } from "../env";
import { chunkWindow, parseScopes } from "../status";
import { GA4_METRICS, GOOGLE_ADS_QUERY, mapGa4, mapGoogleAds, mapSearchConsole, mapYoutube, type Ga4Report, type GoogleAdsRow, type YtReport } from "../mapping";

/**
 * Google APIs — one OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) for Ads, GA4,
 * Search Console, YouTube Analytics, Calendar and Drive. Offline access (refresh token) is
 * requested with prompt=consent so the refresh token is always returned.
 */

const SCOPE = {
  ads: "https://www.googleapis.com/auth/adwords",
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  webmasters: "https://www.googleapis.com/auth/webmasters.readonly",
  youtube: "https://www.googleapis.com/auth/youtube.readonly",
  ytAnalytics: "https://www.googleapis.com/auth/yt-analytics.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
  drive: "https://www.googleapis.com/auth/drive.file",
};

export function classifyGoogle(status: number, body: unknown): ConnectorError | undefined {
  if (status < 400) return undefined;
  const b = body as { error?: string | { status?: string; message?: string } };
  const msg = `Google API: ${extractMessage(body) ?? `HTTP ${status}`}`.slice(0, 300);
  if (b?.error === "invalid_grant" || b?.error === "invalid_token") return new ConnectorError("AUTH", msg, { status });
  const s = typeof b?.error === "object" ? b.error.status : undefined;
  if (status === 401 || s === "UNAUTHENTICATED") return new ConnectorError("AUTH", msg, { status });
  if (status === 403 || s === "PERMISSION_DENIED") return new ConnectorError("PERMISSION", msg, { status });
  if (status === 429 || s === "RESOURCE_EXHAUSTED") return new ConnectorError("RATE_LIMIT", msg, { status });
  return new ConnectorError("API", msg, { status });
}

const RATE = {
  policy: "Per-project quotas (Google Cloud console); Google Ads: 15k operations/day at Basic access; GA4: token-based property quotas.",
  maxConcurrency: 2,
  minIntervalMs: 200,
};

const auth = (t: TokenSet) => ({ Authorization: `Bearer ${t.accessToken}` });

function authorizeUrl(scopes: string[]) {
  return (state: string, redirectUri: string) =>
    withQuery("https://accounts.google.com/o/oauth2/v2/auth", {
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
}

type GoogleToken = { access_token: string; expires_in?: number; refresh_token?: string; scope?: string };
const toTokenSet = (r: GoogleToken, prevRefresh?: string | null): TokenSet => ({
  accessToken: r.access_token,
  refreshToken: r.refresh_token ?? prevRefresh ?? null,
  expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null,
  scopes: parseScopes(r.scope),
});

async function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  const r = await requestJson<GoogleToken>("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ code, client_id: requireEnv("GOOGLE_CLIENT_ID"), client_secret: requireEnv("GOOGLE_CLIENT_SECRET"), redirect_uri: redirectUri, grant_type: "authorization_code" }),
    classify: classifyGoogle,
  });
  return toTokenSet(r);
}

async function refresh(token: TokenSet): Promise<TokenSet | null> {
  if (!token.refreshToken) return null;
  const r = await requestJson<GoogleToken>("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: requireEnv("GOOGLE_CLIENT_ID"), client_secret: requireEnv("GOOGLE_CLIENT_SECRET"), refresh_token: token.refreshToken, grant_type: "refresh_token" }),
    classify: classifyGoogle,
  });
  const next = toTokenSet(r, token.refreshToken);
  return { ...next, scopes: next.scopes?.length ? next.scopes : token.scopes };
}

/** tokeninfo reports the scopes actually granted to the access token. */
async function test(token: TokenSet | null) {
  if (!token) throw new ConnectorError("AUTH", "No credentials stored");
  const info = await requestJson<{ scope?: string; email?: string; expires_in?: string }>("https://oauth2.googleapis.com/tokeninfo", {
    method: "POST",
    body: new URLSearchParams({ access_token: token.accessToken }),
    classify: (s, b) => (s === 400 ? new ConnectorError("AUTH", "Google token is invalid or expired", { status: s }) : classifyGoogle(s, b)),
    retries: 1,
  });
  return { ok: true as const, scopes: parseScopes(info.scope), identity: info.email };
}

// ───────────────────────── Google Ads ─────────────────────────

const ADS_VERSION = () => process.env.GOOGLE_ADS_API_VERSION || "v21";
function adsHeaders(t: TokenSet) {
  const h: Record<string, string> = { ...auth(t), "developer-token": requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN") };
  if (hasEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID")) h["login-customer-id"] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!.replace(/-/g, "");
  return h;
}

export const googleAds: Connector = {
  id: "google-ads",
  platform: "GOOGLE_ADS",
  displayName: "Google Ads",
  authType: "oauth2",
  capabilities: ["ads"],
  requiredScopes: [SCOPE.ads],
  envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
  docsUrl: "https://developers.google.com/google-ads/api/docs/start",
  rateLimit: RATE,
  limitations: ["Needs an approved developer token (Basic access) for production accounts."],
  authorizeUrl: authorizeUrl([SCOPE.ads]),
  exchangeCode,
  refreshToken: refresh,
  async testConnection(token) {
    const base = await test(token);
    await requestJson(`https://googleads.googleapis.com/${ADS_VERSION()}/customers:listAccessibleCustomers`, { headers: adsHeaders(token!), classify: classifyGoogle, retries: 1 });
    return base;
  },
  async listAccounts(token) {
    const res = await requestJson<{ resourceNames?: string[] }>(`https://googleads.googleapis.com/${ADS_VERSION()}/customers:listAccessibleCustomers`, {
      headers: adsHeaders(token),
      classify: classifyGoogle,
    });
    const out = [];
    for (const rn of res.resourceNames ?? []) {
      const id = rn.split("/")[1];
      try {
        const [batch] = await requestJson<{ results?: { customer: { descriptiveName?: string; currencyCode?: string; timeZone?: string; manager?: boolean } }[] }[]>(
          `https://googleads.googleapis.com/${ADS_VERSION()}/customers/${id}/googleAds:searchStream`,
          { method: "POST", headers: adsHeaders(token), body: { query: "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1" }, classify: classifyGoogle },
        );
        const c = batch?.results?.[0]?.customer;
        if (c?.manager) continue; // manager (MCC) accounts have no metrics of their own
        out.push({ externalId: id, name: c?.descriptiveName || id, currency: c?.currencyCode, timezone: c?.timeZone });
      } catch (e) {
        // Accounts reachable only through an MCC fail without login-customer-id; list them bare.
        if (e instanceof ConnectorError && e.code === "PERMISSION") out.push({ externalId: id, name: id });
        else throw e;
      }
    }
    return out;
  },
  async syncInsights({ token, accounts }) {
    const metrics: NormalizedMetric[] = [];
    for (const acc of accounts) {
      const batches = await requestJson<{ results?: GoogleAdsRow[] }[]>(`https://googleads.googleapis.com/${ADS_VERSION()}/customers/${acc.externalId}/googleAds:searchStream`, {
        method: "POST",
        headers: adsHeaders(token),
        body: { query: GOOGLE_ADS_QUERY(acc.window.since, acc.window.until) },
        classify: classifyGoogle,
        timeoutMs: 120_000,
      });
      metrics.push(...mapGoogleAds(acc.externalId, acc.currency, batches));
    }
    return { metrics, organic: [], notes: ["Google Ads does not report reach at campaign × day level (left at 0).", "Conversions with a value are counted as purchases, others as leads."] };
  },
  mapping:
    "POST customers/{id}/googleAds:searchStream (GAQL FROM campaign, segments.date): cost_micros/1e6→spend, impressions, clicks, conversions→purchases when conversions_value>0 else leads, " +
    "conversions_value→revenue, video_views→videoViews, engagements→engagements. Reach not available per day → 0. Campaign status/channel type mapped to our enums.",
};

// ───────────────────────── GA4 ─────────────────────────

export const ga4: Connector = {
  id: "ga4",
  platform: "GA4",
  displayName: "Google Analytics 4",
  authType: "oauth2",
  capabilities: ["analytics"],
  requiredScopes: [SCOPE.analytics],
  envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  docsUrl: "https://developers.google.com/analytics/devguides/reporting/data/v1",
  rateLimit: RATE,
  authorizeUrl: authorizeUrl([SCOPE.analytics]),
  exchangeCode,
  refreshToken: refresh,
  testConnection: test,
  async listAccounts(token) {
    const out = [];
    let pageToken: string | undefined;
    do {
      const res = await requestJson<{ accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[]; nextPageToken?: string }>(
        withQuery("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", { pageSize: 200, pageToken }),
        { headers: auth(token), classify: classifyGoogle },
      );
      for (const a of res.accountSummaries ?? [])
        for (const p of a.propertySummaries ?? []) out.push({ externalId: p.property.replace("properties/", ""), name: `${a.displayName} · ${p.displayName}`, isOrganic: true });
      pageToken = res.nextPageToken;
    } while (pageToken);
    return out;
  },
  async syncInsights({ token, accounts }) {
    const organic: NormalizedOrganic[] = [];
    for (const acc of accounts) {
      const report = await requestJson<Ga4Report>(`https://analyticsdata.googleapis.com/v1beta/properties/${acc.externalId}:runReport`, {
        method: "POST",
        headers: auth(token),
        body: {
          dateRanges: [{ startDate: acc.window.since, endDate: acc.window.until }],
          dimensions: [{ name: "date" }],
          metrics: GA4_METRICS.map((name) => ({ name })),
          limit: 100000,
        },
        classify: classifyGoogle,
      });
      organic.push(...mapGa4(acc.externalId, report));
    }
    return { metrics: [], organic };
  },
  mapping:
    "POST properties/{id}:runReport (dimension date): totalUsers→reach, screenPageViews→impressions, engagedSessions→engagements (OrganicMetricDaily, one row per property/day).",
};

// ───────────────────────── Search Console ─────────────────────────

export const searchConsole: Connector = {
  id: "search-console",
  platform: "SEARCH_CONSOLE",
  displayName: "Google Search Console",
  authType: "oauth2",
  capabilities: ["search"],
  requiredScopes: [SCOPE.webmasters],
  envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  docsUrl: "https://developers.google.com/webmaster-tools/v1/searchanalytics/query",
  rateLimit: RATE,
  limitations: ["Search data is final after ~2–3 days; recent days are re-synced."],
  authorizeUrl: authorizeUrl([SCOPE.webmasters]),
  exchangeCode,
  refreshToken: refresh,
  testConnection: test,
  async listAccounts(token) {
    const res = await requestJson<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>("https://www.googleapis.com/webmasters/v3/sites", { headers: auth(token), classify: classifyGoogle });
    return (res.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => ({ externalId: s.siteUrl, name: s.siteUrl, isOrganic: true }));
  },
  async syncInsights({ token, accounts }) {
    const organic: NormalizedOrganic[] = [];
    for (const acc of accounts) {
      const res = await requestJson<{ rows?: { keys: string[]; clicks: number; impressions: number }[] }>(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(acc.externalId)}/searchAnalytics/query`,
        { method: "POST", headers: auth(token), body: { startDate: acc.window.since, endDate: acc.window.until, dimensions: ["date"], rowLimit: 25000 }, classify: classifyGoogle },
      );
      organic.push(...mapSearchConsole(acc.externalId, res.rows ?? []));
    }
    return { metrics: [], organic };
  },
  mapping: "POST sites/{siteUrl}/searchAnalytics/query (dimension date): impressions→impressions, clicks→engagements (OrganicMetricDaily).",
};

// ───────────────────────── YouTube Analytics ─────────────────────────

export const youtube: Connector = {
  id: "youtube",
  platform: "YOUTUBE",
  displayName: "YouTube Analytics",
  authType: "oauth2",
  capabilities: ["organic"],
  requiredScopes: [SCOPE.youtube, SCOPE.ytAnalytics],
  envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  docsUrl: "https://developers.google.com/youtube/analytics/reference/reports/query",
  rateLimit: { ...RATE, policy: "YouTube Data API: 10,000 quota units/day per project; Analytics API: per-project query quota." },
  authorizeUrl: authorizeUrl([SCOPE.youtube, SCOPE.ytAnalytics]),
  exchangeCode,
  refreshToken: refresh,
  testConnection: test,
  async listAccounts(token) {
    const res = await requestJson<{ items?: { id: string; snippet: { title: string } }[] }>(withQuery("https://www.googleapis.com/youtube/v3/channels", { part: "snippet", mine: "true" }), {
      headers: auth(token),
      classify: classifyGoogle,
    });
    return (res.items ?? []).map((c) => ({ externalId: c.id, name: c.snippet.title, isOrganic: true }));
  },
  async syncInsights({ token, accounts }) {
    const organic: NormalizedOrganic[] = [];
    for (const acc of accounts) {
      const ch = await requestJson<{ items?: { statistics?: { subscriberCount?: string } }[] }>(
        withQuery("https://www.googleapis.com/youtube/v3/channels", { part: "statistics", id: acc.externalId }),
        { headers: auth(token), classify: classifyGoogle },
      );
      const subs = Number(ch.items?.[0]?.statistics?.subscriberCount ?? 0);
      for (const w of chunkWindow(acc.window, 365)) {
        const report = await requestJson<YtReport>(
          withQuery("https://youtubeanalytics.googleapis.com/v2/reports", {
            ids: `channel==${acc.externalId}`,
            startDate: w.since,
            endDate: w.until,
            metrics: "views,likes,comments,shares,subscribersGained,subscribersLost",
            dimensions: "day",
            sort: "day",
          }),
          { headers: auth(token), classify: classifyGoogle },
        );
        organic.push(...mapYoutube(acc.externalId, report, subs));
      }
    }
    return { metrics: [], organic, notes: ["Subscriber history is reconstructed from today's count and daily gained/lost (exact when every day is reported)."] };
  },
  mapping:
    "GET youtubeanalytics v2/reports (dimension day): views→videoViews, likes+comments+shares→engagements; followers per day = current subscriberCount minus later (subscribersGained−subscribersLost).",
};

// ───────────────────────── Calendar / Drive (optional placeholders) ─────────────────────────

export const googleCalendar: Connector = {
  id: "google-calendar",
  platform: "CALENDAR",
  displayName: "Google Calendar",
  authType: "oauth2",
  capabilities: ["calendar"],
  requiredScopes: [SCOPE.calendar],
  envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  docsUrl: "https://developers.google.com/calendar/api/guides/overview",
  rateLimit: RATE,
  placeholder: true,
  limitations: ["Optional: stores the connection for future calendar sync of publishing dates; no data is synced yet."],
  authorizeUrl: authorizeUrl([SCOPE.calendar]),
  exchangeCode,
  refreshToken: refresh,
  testConnection: test,
  mapping: "Placeholder — connection only. Planned: ContentItem.publishAt ↔ calendar events (read-only).",
};

export const googleDrive: Connector = {
  id: "google-drive",
  platform: "CLOUD_STORAGE",
  displayName: "Google Drive",
  authType: "oauth2",
  capabilities: ["storage"],
  requiredScopes: [SCOPE.drive],
  envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  docsUrl: "https://developers.google.com/drive/api/guides/about-sdk",
  rateLimit: RATE,
  placeholder: true,
  limitations: ["Optional: stores the connection for future asset import; only files created/opened by the app are accessible (drive.file)."],
  authorizeUrl: authorizeUrl([SCOPE.drive]),
  exchangeCode,
  refreshToken: refresh,
  testConnection: test,
  mapping: "Placeholder — connection only. Planned: attach Drive files to FileAsset (drive.file scope).",
};
