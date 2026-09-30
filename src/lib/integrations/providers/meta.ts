import { createHmac } from "node:crypto";
import { ConnectorError, type Connector, type NormalizedOrganic, type RemoteAccount, type TokenSet } from "../types";
import { requestJson, withQuery } from "../http";
import { requireEnv } from "../env";
import { chunkWindow, parseScopes } from "../status";
import { graphMetricsByDay, mapMetaInsights, type GraphInsightMetric, type MetaInsightRow } from "../mapping";

/**
 * Meta Graph API / Marketing API (developers.facebook.com/docs/marketing-apis).
 * One Meta app (META_APP_ID / META_APP_SECRET) powers three connectors: Ads, Facebook Pages and
 * Instagram Business. Every call is authenticated with `Authorization: Bearer` plus
 * `appsecret_proof` (HMAC of the token with the app secret), so tokens never appear in URLs/logs.
 */

const VERSION = () => process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH = () => `https://graph.facebook.com/${VERSION()}`;

const RATE = {
  policy: "Business Use Case rate limits per ad account (X-Business-Use-Case-Usage); throttling returns error codes 4/17/32/613/80000+.",
  maxConcurrency: 2,
  minIntervalMs: 250,
};

/** Maps Graph error codes to our error kinds (Graph often answers 400 for auth/throttle errors). */
export function classifyGraph(status: number, body: unknown): ConnectorError | undefined {
  const err = (body as { error?: { code?: number; error_subcode?: number; message?: string; type?: string } })?.error;
  if (!err) return undefined;
  const code = Number(err.code);
  const msg = `Meta API: ${err.message ?? "error"} (#${code})`.slice(0, 300);
  if (code === 190 || code === 102 || code === 463 || code === 467) return new ConnectorError("AUTH", msg, { status });
  if (code === 10 || (code >= 200 && code <= 299)) return new ConnectorError("PERMISSION", msg, { status });
  if ([4, 17, 32, 613].includes(code) || (code >= 80000 && code <= 80014)) return new ConnectorError("RATE_LIMIT", msg, { status });
  return new ConnectorError("API", msg, { status });
}

function proof(token: string) {
  return createHmac("sha256", requireEnv("META_APP_SECRET")).update(token).digest("hex");
}

async function graph<T>(path: string, token: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = withQuery(path.startsWith("http") ? path : `${GRAPH()}/${path.replace(/^\//, "")}`, { ...params, appsecret_proof: proof(token) });
  return requestJson<T>(url, { headers: { Authorization: `Bearer ${token}` }, classify: classifyGraph });
}

/** Follows `paging.next` cursors. `paging.next` embeds the token, so we rebuild it from the `after` cursor instead. */
async function graphAll<T>(path: string, token: string, params: Record<string, string | number | undefined>, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await graph<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, token, { ...params, after });
    out.push(...(res.data ?? []));
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
    if (!after) break;
    await new Promise((r) => setTimeout(r, RATE.minIntervalMs));
  }
  return out;
}

// ───────────────────────── shared OAuth ─────────────────────────

function authorizeUrl(scopes: string[]) {
  return (state: string, redirectUri: string) =>
    withQuery(`https://www.facebook.com/${VERSION()}/dialog/oauth`, {
      client_id: requireEnv("META_APP_ID"),
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      scope: scopes.join(","),
    });
}

async function exchangeForLongLived(shortToken: string): Promise<TokenSet> {
  const res = await requestJson<{ access_token: string; expires_in?: number }>(`${GRAPH()}/oauth/access_token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: requireEnv("META_APP_ID"),
      client_secret: requireEnv("META_APP_SECRET"),
      fb_exchange_token: shortToken,
    }),
    classify: classifyGraph,
  });
  return { accessToken: res.access_token, expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000) : null };
}

async function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  const short = await requestJson<{ access_token: string }>(`${GRAPH()}/oauth/access_token`, {
    method: "POST",
    body: new URLSearchParams({ client_id: requireEnv("META_APP_ID"), client_secret: requireEnv("META_APP_SECRET"), redirect_uri: redirectUri, code }),
    classify: classifyGraph,
  });
  // Short-lived user tokens last ~1h; swap for a ~60-day long-lived token.
  const long = await exchangeForLongLived(short.access_token);
  return { ...long, scopes: await grantedScopes(long.accessToken) };
}

/** Meta has no refresh tokens: a still-valid long-lived token is re-exchanged for a new 60-day one. */
async function refresh(token: TokenSet): Promise<TokenSet | null> {
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return null;
  const next = await exchangeForLongLived(token.accessToken);
  return { ...next, scopes: token.scopes };
}

async function grantedScopes(token: string) {
  const res = await graph<{ data: { permission: string; status: string }[] }>("me/permissions", token);
  return parseScopes(res.data.filter((p) => p.status === "granted").map((p) => p.permission));
}

async function test(token: TokenSet | null) {
  if (!token) throw new ConnectorError("AUTH", "No credentials stored");
  const me = await graph<{ id: string; name?: string }>("me", token.accessToken, { fields: "id,name" });
  return { ok: true as const, scopes: await grantedScopes(token.accessToken), identity: me.name ?? me.id };
}

async function pages(token: string) {
  return graphAll<{ id: string; name: string; access_token?: string; instagram_business_account?: { id: string; username?: string } }>("me/accounts", token, {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: 100,
  });
}

const unix = (d: string, endOfDay = false) => Math.floor(Date.parse(d + "T00:00:00Z") / 1000) + (endOfDay ? 86400 : 0);

/**
 * Requests insight metrics together, falling back to one-by-one when Meta rejects a metric
 * (error #100 — Meta periodically deprecates Page/IG metrics). Unknown metrics are skipped.
 */
async function insightsTolerant(path: string, token: string, metrics: string[], params: Record<string, string | number>) {
  try {
    const res = await graph<{ data: GraphInsightMetric[] }>(path, token, { ...params, metric: metrics.join(",") });
    return { data: res.data ?? [], skipped: [] as string[] };
  } catch (e) {
    if (!(e instanceof ConnectorError) || e.code !== "API") throw e;
    const data: GraphInsightMetric[] = [];
    const skipped: string[] = [];
    for (const m of metrics) {
      try {
        const res = await graph<{ data: GraphInsightMetric[] }>(path, token, { ...params, metric: m });
        data.push(...(res.data ?? []));
      } catch (err) {
        if (err instanceof ConnectorError && err.code === "API") skipped.push(m);
        else throw err;
      }
    }
    return { data, skipped };
  }
}

// ───────────────────────── connectors ─────────────────────────

const ADS_SCOPES = ["ads_read", "business_management"];
const PAGE_SCOPES = ["pages_show_list", "pages_read_engagement", "read_insights"];
const IG_SCOPES = ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement"];

export const INSIGHT_FIELDS = "campaign_id,campaign_name,objective,account_currency,spend,impressions,reach,clicks,actions,action_values,video_p100_watched_actions";

export const metaAds: Connector = {
  id: "meta",
  platform: "META",
  displayName: "Meta Ads (Facebook & Instagram Ads)",
  authType: "oauth2",
  capabilities: ["ads"],
  requiredScopes: ADS_SCOPES,
  envVars: ["META_APP_ID", "META_APP_SECRET"],
  docsUrl: "https://developers.facebook.com/docs/marketing-api/insights",
  rateLimit: RATE,
  manualToken: true,
  authorizeUrl: authorizeUrl(ADS_SCOPES),
  exchangeCode,
  refreshToken: refresh,
  testConnection: test,
  async listAccounts(token) {
    const rows = await graphAll<{ id: string; name: string; currency: string; timezone_name: string }>("me/adaccounts", token.accessToken, {
      fields: "id,name,currency,timezone_name,account_status",
      limit: 200,
    });
    return rows.map<RemoteAccount>((a) => ({ externalId: a.id, name: a.name, currency: a.currency, timezone: a.timezone_name }));
  },
  async syncInsights({ token, accounts }) {
    const metrics = [];
    for (const acc of accounts) {
      const rows = await graphAll<MetaInsightRow>(`${acc.externalId}/insights`, token.accessToken, {
        level: "campaign",
        time_increment: 1,
        time_range: JSON.stringify(acc.window),
        fields: INSIGHT_FIELDS,
        action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]),
        limit: 500,
      });
      metrics.push(...mapMetaInsights(acc.externalId, acc.currency, rows));
    }
    return { metrics, organic: [], notes: ["Reach is daily unique reach per campaign (not additive across days)."] };
  },
  mapping:
    "GET /act_{id}/insights level=campaign, time_increment=1 → one MetricDaily row per campaign/day. spend→spend, impressions, reach, clicks; " +
    "actions[lead|onsite_conversion.lead_grouped|offsite_conversion.fb_pixel_lead] (first present)→leads; actions[omni_purchase|purchase|…]→purchases; " +
    "action_values[same]→revenue; actions[video_view]→videoViews (3s); video_p100_watched_actions→videoCompletions; actions[post_engagement]→engagements. Attribution 7-day click / 1-day view.",
};

export const facebookPages: Connector = {
  id: "facebook",
  platform: "FACEBOOK",
  displayName: "Facebook Pages",
  authType: "oauth2",
  capabilities: ["organic"],
  requiredScopes: PAGE_SCOPES,
  envVars: ["META_APP_ID", "META_APP_SECRET"],
  docsUrl: "https://developers.facebook.com/docs/graph-api/reference/insights",
  rateLimit: RATE,
  manualToken: true,
  authorizeUrl: authorizeUrl(PAGE_SCOPES),
  exchangeCode,
  refreshToken: refresh,
  testConnection: test,
  async listAccounts(token) {
    return (await pages(token.accessToken)).map((p) => ({ externalId: p.id, name: p.name, isOrganic: true }));
  },
  async syncInsights({ token, accounts }) {
    const all = await pages(token.accessToken);
    const organic: NormalizedOrganic[] = [];
    const notes: string[] = [];
    for (const acc of accounts) {
      const page = all.find((p) => p.id === acc.externalId);
      if (!page?.access_token) throw new ConnectorError("PERMISSION", `Page ${acc.externalId} is no longer accessible with this login`);
      const metrics = ["page_impressions_unique", "page_impressions", "page_post_engagements", "page_video_views"];
      const { data, skipped } = await insightsTolerant(`${page.id}/insights`, page.access_token, metrics, {
        period: "day",
        since: unix(acc.window.since),
        until: unix(acc.window.until, true),
      });
      if (skipped.length) notes.push(`Page ${page.name}: metrics not available in this Graph version: ${skipped.join(", ")}`);
      const info = await graph<{ followers_count?: number }>(page.id, page.access_token, { fields: "followers_count" });
      const byDay = graphMetricsByDay(data);
      const today = acc.window.until;
      for (const [date, m] of byDay) {
        organic.push({
          accountExternalId: acc.externalId,
          date,
          // Graph only exposes the current follower count: stored as today's snapshot, history is kept as-is.
          followers: date === today ? info.followers_count ?? null : null,
          posts: 0,
          reach: m.page_impressions_unique ?? 0,
          impressions: m.page_impressions ?? 0,
          engagements: m.page_post_engagements ?? 0,
          videoViews: m.page_video_views ?? 0,
        });
      }
      if (!byDay.has(today) && info.followers_count != null) {
        organic.push({ accountExternalId: acc.externalId, date: today, followers: info.followers_count, posts: 0, reach: 0, impressions: 0, engagements: 0, videoViews: 0 });
      }
    }
    return { metrics: [], organic, notes };
  },
  mapping:
    "GET /{page-id}/insights period=day (Page token from /me/accounts): page_impressions_unique→reach, page_impressions→impressions, page_post_engagements→engagements, " +
    "page_video_views→videoViews. followers_count is a current snapshot stored on today's row (history is built up by daily syncs).",
};

export const instagram: Connector = {
  id: "instagram",
  platform: "INSTAGRAM",
  displayName: "Instagram Business",
  authType: "oauth2",
  capabilities: ["organic"],
  requiredScopes: IG_SCOPES,
  envVars: ["META_APP_ID", "META_APP_SECRET"],
  docsUrl: "https://developers.facebook.com/docs/instagram-platform/insights",
  rateLimit: RATE,
  manualToken: true,
  limitations: ["Requires an Instagram Professional (Business/Creator) account linked to a Facebook Page."],
  authorizeUrl: authorizeUrl(IG_SCOPES),
  exchangeCode,
  refreshToken: refresh,
  testConnection: test,
  async listAccounts(token) {
    return (await pages(token.accessToken))
      .filter((p) => p.instagram_business_account)
      .map((p) => ({ externalId: p.instagram_business_account!.id, name: `@${p.instagram_business_account!.username ?? p.name}`, isOrganic: true }));
  },
  async syncInsights({ token, accounts }) {
    const organic: NormalizedOrganic[] = [];
    const notes: string[] = [];
    for (const acc of accounts) {
      // IG user insights allow at most 30 days per request.
      const byDay = new Map<string, Record<string, number>>();
      for (const w of chunkWindow(acc.window, 30)) {
        const { data, skipped } = await insightsTolerant(`${acc.externalId}/insights`, token.accessToken, ["reach", "views", "follower_count"], {
          period: "day",
          since: unix(w.since),
          until: unix(w.until, true),
        });
        if (skipped.length) notes.push(`Instagram ${acc.externalId}: unavailable metrics ${skipped.join(", ")}`);
        for (const [d, m] of graphMetricsByDay(data)) byDay.set(d, { ...(byDay.get(d) ?? {}), ...m });
      }
      const info = await graph<{ followers_count?: number; media_count?: number }>(acc.externalId, token.accessToken, { fields: "followers_count,media_count" });
      const today = acc.window.until;
      if (!byDay.has(today)) byDay.set(today, {});
      for (const [date, m] of byDay) {
        organic.push({
          accountExternalId: acc.externalId,
          date,
          followers: date === today ? info.followers_count ?? null : null,
          posts: 0,
          reach: m.reach ?? 0,
          impressions: m.views ?? 0,
          engagements: 0,
          videoViews: 0,
        });
      }
    }
    notes.push("Instagram daily engagement is only available as period totals; engagements are not synced per day.");
    return { metrics: [], organic, notes };
  },
  mapping:
    "GET /{ig-user-id}/insights period=day (30-day chunks): reach→reach, views→impressions. followers_count snapshot on today's row. " +
    "Daily engagements are not exposed as a time series by the API and are left at 0 (not estimated).",
};
