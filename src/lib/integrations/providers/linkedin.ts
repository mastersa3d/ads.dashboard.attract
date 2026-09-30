import { ConnectorError, type Connector, type NormalizedMetric, type NormalizedOrganic, type TokenSet } from "../types";
import { requestJson, withQuery } from "../http";
import { requireEnv } from "../env";
import { parseScopes } from "../status";
import { backfillFollowers, mapLinkedIn, type LinkedInAnalyticsRow } from "../mapping";

/**
 * LinkedIn Marketing API (versioned REST, Rest.li 2.0) — learn.microsoft.com/linkedin/marketing.
 * Access tokens last 60 days; refresh tokens (365 days) are issued to apps with programmatic refresh enabled.
 * Rest.li query syntax uses literal parentheses, so those URLs are built by hand (URNs encoded inside).
 */

const API = "https://api.linkedin.com/rest";
const VERSION = () => process.env.LINKEDIN_API_VERSION || "202509";
const headers = (t: TokenSet) => ({ Authorization: `Bearer ${t.accessToken}`, "LinkedIn-Version": VERSION(), "X-Restli-Protocol-Version": "2.0.0" });

const RATE = { policy: "Application and member daily request limits per endpoint (see Developer Portal → Analytics).", maxConcurrency: 1, minIntervalMs: 300 };

const ADS_SCOPES = ["r_ads", "r_ads_reporting"];
const PAGE_SCOPES = ["r_organization_social", "rw_organization_admin"];

function authorizeUrl(scopes: string[]) {
  return (state: string, redirectUri: string) =>
    withQuery("https://www.linkedin.com/oauth/v2/authorization", { response_type: "code", client_id: requireEnv("LINKEDIN_CLIENT_ID"), redirect_uri: redirectUri, state, scope: scopes.join(" ") });
}

type LiToken = { access_token: string; expires_in?: number; refresh_token?: string; scope?: string };
const toSet = (r: LiToken, prevRefresh?: string | null): TokenSet => ({
  accessToken: r.access_token,
  refreshToken: r.refresh_token ?? prevRefresh ?? null,
  expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null,
  scopes: parseScopes(r.scope),
});

async function exchangeCode(code: string, redirectUri: string) {
  const r = await requestJson<LiToken>("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: requireEnv("LINKEDIN_CLIENT_ID"), client_secret: requireEnv("LINKEDIN_CLIENT_SECRET") }),
  });
  return toSet(r);
}

async function refresh(token: TokenSet) {
  if (!token.refreshToken) return null;
  const r = await requestJson<LiToken>("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken, client_id: requireEnv("LINKEDIN_CLIENT_ID"), client_secret: requireEnv("LINKEDIN_CLIENT_SECRET") }),
  });
  const next = toSet(r, token.refreshToken);
  return { ...next, scopes: next.scopes?.length ? next.scopes : token.scopes };
}

/** Token introspection returns the granted scopes (comma separated). */
async function introspect(token: TokenSet) {
  const r = await requestJson<{ active: boolean; scope?: string; expires_at?: number }>("https://www.linkedin.com/oauth/v2/introspectToken", {
    method: "POST",
    body: new URLSearchParams({ token: token.accessToken, client_id: requireEnv("LINKEDIN_CLIENT_ID"), client_secret: requireEnv("LINKEDIN_CLIENT_SECRET") }),
    retries: 1,
  });
  if (!r.active) throw new ConnectorError("AUTH", "LinkedIn token is no longer active");
  return parseScopes(r.scope);
}

const dateRange = (since: string, until: string) => {
  const [y1, m1, d1] = since.split("-").map(Number);
  const [y2, m2, d2] = until.split("-").map(Number);
  return `(start:(year:${y1},month:${m1},day:${d1}),end:(year:${y2},month:${m2},day:${d2}))`;
};

export const linkedinAds: Connector = {
  id: "linkedin",
  platform: "LINKEDIN",
  displayName: "LinkedIn Ads",
  authType: "oauth2",
  capabilities: ["ads"],
  requiredScopes: ADS_SCOPES,
  envVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting",
  rateLimit: RATE,
  limitations: ["Requires Advertising API access approved for the LinkedIn app."],
  authorizeUrl: authorizeUrl(ADS_SCOPES),
  exchangeCode,
  refreshToken: refresh,
  async testConnection(token) {
    if (!token) throw new ConnectorError("AUTH", "No credentials stored");
    const scopes = await introspect(token);
    await requestJson(`${API}/adAccountUsers?q=authenticatedUser`, { headers: headers(token), retries: 1 });
    return { ok: true as const, scopes };
  },
  async listAccounts(token) {
    const users = await requestJson<{ elements?: { account: string }[] }>(`${API}/adAccountUsers?q=authenticatedUser`, { headers: headers(token) });
    const out = [];
    for (const u of users.elements ?? []) {
      const id = u.account.split(":").pop()!;
      const acc = await requestJson<{ name?: string; currency?: string }>(`${API}/adAccounts/${id}`, { headers: headers(token) });
      out.push({ externalId: id, name: acc.name ?? id, currency: acc.currency });
    }
    return out;
  },
  async syncInsights({ token, accounts }) {
    const metrics: NormalizedMetric[] = [];
    for (const acc of accounts) {
      const names = new Map<string, string>();
      let pageToken: string | undefined;
      do {
        const res = await requestJson<{ elements?: { id: number; name: string }[]; metadata?: { nextPageToken?: string } }>(
          `${API}/adAccounts/${acc.externalId}/adCampaigns?q=search&pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
          { headers: headers(token) },
        );
        for (const c of res.elements ?? []) names.set(String(c.id), c.name);
        pageToken = res.metadata?.nextPageToken;
      } while (pageToken);

      const fields = "dateRange,pivotValues,costInLocalCurrency,impressions,clicks,oneClickLeads,externalWebsiteConversions,videoViews,videoCompletions,totalEngagements";
      const url =
        `${API}/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=${dateRange(acc.window.since, acc.window.until)}` +
        `&accounts=List(${encodeURIComponent(`urn:li:sponsoredAccount:${acc.externalId}`)})&fields=${fields}`;
      const res = await requestJson<{ elements?: LinkedInAnalyticsRow[] }>(url, { headers: headers(token), timeoutMs: 60_000 });
      metrics.push(...mapLinkedIn(acc.externalId, acc.currency, res.elements ?? [], names));
    }
    return { metrics, organic: [], notes: ["LinkedIn does not report reach per campaign/day (left at 0)."] };
  },
  mapping:
    "GET /rest/adAnalytics q=analytics pivot=CAMPAIGN timeGranularity=DAILY: costInLocalCurrency→spend, impressions, clicks, oneClickLeads→leads, externalWebsiteConversions→purchases, " +
    "videoViews, videoCompletions, totalEngagements→engagements. Campaign names from /adAccounts/{id}/adCampaigns.",
};

export const linkedinPages: Connector = {
  id: "linkedin-pages",
  platform: "LINKEDIN",
  displayName: "LinkedIn Pages",
  authType: "oauth2",
  capabilities: ["organic"],
  requiredScopes: PAGE_SCOPES,
  envVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics",
  rateLimit: RATE,
  limitations: ["Requires Community Management API access approved for the LinkedIn app."],
  authorizeUrl: authorizeUrl(PAGE_SCOPES),
  exchangeCode,
  refreshToken: refresh,
  async testConnection(token) {
    if (!token) throw new ConnectorError("AUTH", "No credentials stored");
    const scopes = await introspect(token);
    return { ok: true as const, scopes };
  },
  async listAccounts(token) {
    const res = await requestJson<{ elements?: { organization: string; role: string; state?: string }[] }>(`${API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, {
      headers: headers(token),
    });
    const out = [];
    for (const e of res.elements ?? []) {
      const id = e.organization.split(":").pop()!;
      const org = await requestJson<{ localizedName?: string }>(`${API}/organizations/${id}`, { headers: headers(token) });
      out.push({ externalId: id, name: org.localizedName ?? id, isOrganic: true });
    }
    return out;
  },
  async syncInsights({ token, accounts }) {
    const organic: NormalizedOrganic[] = [];
    for (const acc of accounts) {
      const urn = encodeURIComponent(`urn:li:organization:${acc.externalId}`);
      const start = Date.parse(acc.window.since + "T00:00:00Z");
      const end = Date.parse(acc.window.until + "T00:00:00Z") + 86_400_000;
      const interval = `(timeRange:(start:${start},end:${end}),timeGranularityType:DAY)`;
      type Stat = { timeRange: { start: number }; totalShareStatistics?: { impressionCount?: number; uniqueImpressionsCount?: number; clickCount?: number; likeCount?: number; commentCount?: number; shareCount?: number } };
      type Fol = { timeRange: { start: number }; followerGains?: { organicFollowerGain?: number; paidFollowerGain?: number } };
      const [shares, followers, size] = await Promise.all([
        requestJson<{ elements?: Stat[] }>(`${API}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${urn}&timeIntervals=${interval}`, { headers: headers(token) }),
        requestJson<{ elements?: Fol[] }>(`${API}/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${urn}&timeIntervals=${interval}`, { headers: headers(token) }),
        requestJson<{ firstDegreeSize?: number }>(`${API}/networkSizes/${urn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, { headers: headers(token) }),
      ]);
      const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const gains = new Map<string, number>();
      for (const f of followers.elements ?? []) gains.set(day(f.timeRange.start), (f.followerGains?.organicFollowerGain ?? 0) + (f.followerGains?.paidFollowerGain ?? 0));
      const byDay = new Map((shares.elements ?? []).map((s) => [day(s.timeRange.start), s.totalShareStatistics ?? {}]));
      const days = [...new Set([...byDay.keys(), ...gains.keys()])];
      const follow = backfillFollowers(days, size.firstDegreeSize ?? 0, gains);
      for (const d of days) {
        const s = byDay.get(d) ?? {};
        organic.push({
          accountExternalId: acc.externalId,
          date: d,
          followers: follow.get(d) ?? null,
          posts: 0,
          reach: s.uniqueImpressionsCount ?? 0,
          impressions: s.impressionCount ?? 0,
          engagements: (s.clickCount ?? 0) + (s.likeCount ?? 0) + (s.commentCount ?? 0) + (s.shareCount ?? 0),
          videoViews: 0,
        });
      }
    }
    return { metrics: [], organic };
  },
  mapping:
    "organizationalEntityShareStatistics (DAY): uniqueImpressionsCount→reach, impressionCount→impressions, clicks+likes+comments+shares→engagements; " +
    "followers backfilled from networkSizes (current) minus organizationalEntityFollowerStatistics daily gains.",
};
