import { ConnectorError, type Connector, type NormalizedMetric, type TokenSet } from "../types";
import { requestJson, withQuery } from "../http";
import { requireEnv } from "../env";
import { chunkWindow, parseScopes } from "../status";
import { mapTikTok, type TikTokReportRow } from "../mapping";

/**
 * TikTok API for Business (Marketing API v1.3) — business-api.tiktok.com/portal/docs.
 * Advertiser access tokens do not expire (until revoked by the advertiser), so there is no refresh.
 * TikTok answers HTTP 200 with a non-zero `code` on errors — classified below.
 */

const BASE = "https://business-api.tiktok.com/open_api/v1.3";

export function classifyTikTok(status: number, body: unknown): ConnectorError | undefined {
  const b = body as { code?: number; message?: string };
  if (status >= 400 && typeof b?.code !== "number") return undefined;
  if (!b || typeof b.code !== "number" || b.code === 0) return undefined;
  const msg = `TikTok API: ${b.message ?? "error"} (code ${b.code})`.slice(0, 300);
  if ([40102, 40104, 40105].includes(b.code)) return new ConnectorError("AUTH", msg, { status }); // token expired / empty / invalid
  if ([40001, 40002].includes(b.code)) return new ConnectorError("PERMISSION", msg, { status }); // no permission for advertiser/scope
  if (b.code === 40100) return new ConnectorError("RATE_LIMIT", msg, { status }); // too many requests
  return new ConnectorError("API", msg, { status });
}

const headers = (t: TokenSet) => ({ "Access-Token": t.accessToken });

const METRICS = ["campaign_name", "currency", "spend", "impressions", "reach", "clicks", "conversion", "complete_payment", "total_complete_payment_rate", "video_play_actions", "video_views_p100", "engagements"];

export const tiktok: Connector = {
  id: "tiktok",
  platform: "TIKTOK",
  displayName: "TikTok Ads (API for Business)",
  authType: "oauth2",
  capabilities: ["ads"],
  // Permission scopes are chosen when the TikTok app is created; the token response lists them as ids.
  requiredScopes: [],
  envVars: ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"],
  docsUrl: "https://business-api.tiktok.com/portal/docs?id=1738373164380162",
  rateLimit: { policy: "Per-app QPS/QPM limits per endpoint (code 40100-series when exceeded); reporting max 30 days per request at day granularity.", maxConcurrency: 1, minIntervalMs: 300 },
  manualToken: true,
  authorizeUrl(state, redirectUri) {
    return withQuery("https://business-api.tiktok.com/portal/auth", { app_id: requireEnv("TIKTOK_APP_ID"), state, redirect_uri: redirectUri });
  },
  async exchangeCode(code) {
    const res = await requestJson<{ code: number; data: { access_token: string; scope?: number[]; advertiser_ids?: string[] } }>(`${BASE}/oauth2/access_token/`, {
      method: "POST",
      body: { app_id: requireEnv("TIKTOK_APP_ID"), secret: requireEnv("TIKTOK_APP_SECRET"), auth_code: code },
      classify: classifyTikTok,
    });
    return { accessToken: res.data.access_token, expiresAt: null, scopes: parseScopes((res.data.scope ?? []).map(String)) };
  },
  async refreshToken() {
    return null;
  },
  async testConnection(token) {
    if (!token) throw new ConnectorError("AUTH", "No credentials stored");
    const res = await requestJson<{ data: { display_name?: string; email?: string } }>(`${BASE}/user/info/`, { headers: headers(token), classify: classifyTikTok, retries: 1 });
    return { ok: true as const, identity: res.data?.display_name ?? res.data?.email };
  },
  async listAccounts(token) {
    const res = await requestJson<{ data: { list: { advertiser_id: string; advertiser_name: string }[] } }>(
      withQuery(`${BASE}/oauth2/advertiser/get/`, { app_id: requireEnv("TIKTOK_APP_ID"), secret: requireEnv("TIKTOK_APP_SECRET") }),
      { headers: headers(token), classify: classifyTikTok },
    );
    return (res.data?.list ?? []).map((a) => ({ externalId: a.advertiser_id, name: a.advertiser_name }));
  },
  async syncInsights({ token, accounts }) {
    const metrics: NormalizedMetric[] = [];
    for (const acc of accounts) {
      for (const w of chunkWindow(acc.window, 30)) {
        let page = 1;
        for (;;) {
          const res = await requestJson<{ data: { list: TikTokReportRow[]; page_info?: { total_page?: number } } }>(
            withQuery(`${BASE}/report/integrated/get/`, {
              advertiser_id: acc.externalId,
              report_type: "BASIC",
              data_level: "AUCTION_CAMPAIGN",
              dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
              metrics: JSON.stringify(METRICS),
              start_date: w.since,
              end_date: w.until,
              page,
              page_size: 1000,
            }),
            { headers: headers(token), classify: classifyTikTok },
          );
          metrics.push(...mapTikTok(acc.externalId, acc.currency, res.data?.list ?? []));
          if (page >= (res.data?.page_info?.total_page ?? 1)) break;
          page++;
        }
      }
    }
    return { metrics, organic: [] };
  },
  mapping:
    "GET report/integrated/get BASIC, AUCTION_CAMPAIGN, dims campaign_id+stat_time_day (30-day chunks): spend, impressions, reach, clicks, complete_payment→purchases " +
    "(total_complete_payment_rate→revenue) else conversion→leads, video_play_actions→videoViews, video_views_p100→videoCompletions, engagements.",
};
