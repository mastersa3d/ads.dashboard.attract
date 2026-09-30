import type { CampaignStatus, Objective } from "@prisma/client";
import type { NormalizedMetric, NormalizedOrganic } from "./types";

/**
 * Pure mappers from official API payloads to our normalized rows (unit-tested).
 * Each mapper documents the exact source fields so numbers can be traced back.
 */

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown) => Math.round(num(v));
const money = (v: unknown) => Math.round(num(v) * 100) / 100;

// ───────────────────────────── Meta Marketing API ─────────────────────────────

type MetaAction = { action_type: string; value: string | number };
export type MetaInsightRow = {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  objective?: string;
  account_currency?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
  video_p100_watched_actions?: MetaAction[];
};

/**
 * Meta reports the same conversion under several action types (pixel, on-Facebook, omni).
 * We take the FIRST available type in priority order so a conversion is never double counted.
 */
export const META_LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
export const META_PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

export function metaActionValue(list: MetaAction[] | undefined, types: string[]): number {
  if (!list?.length) return 0;
  for (const t of types) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}

const META_OBJECTIVES: Record<string, Objective> = {
  OUTCOME_AWARENESS: "AWARENESS",
  OUTCOME_TRAFFIC: "TRAFFIC",
  OUTCOME_ENGAGEMENT: "ENGAGEMENT",
  OUTCOME_LEADS: "LEADS",
  OUTCOME_SALES: "SALES",
  OUTCOME_APP_PROMOTION: "APP_INSTALLS",
  BRAND_AWARENESS: "AWARENESS",
  REACH: "REACH",
  LINK_CLICKS: "TRAFFIC",
  POST_ENGAGEMENT: "ENGAGEMENT",
  PAGE_LIKES: "ENGAGEMENT",
  VIDEO_VIEWS: "VIDEO_VIEWS",
  LEAD_GENERATION: "LEADS",
  CONVERSIONS: "SALES",
  PRODUCT_CATALOG_SALES: "SALES",
  MESSAGES: "MESSAGES",
  APP_INSTALLS: "APP_INSTALLS",
};

export function metaObjective(o: string | undefined): Objective | undefined {
  return o ? META_OBJECTIVES[o.toUpperCase()] : undefined;
}

/** GET /{act_id}/insights?level=campaign&time_increment=1 → MetricDaily rows. */
export function mapMetaInsights(accountExternalId: string, fallbackCurrency: string, rows: MetaInsightRow[]): NormalizedMetric[] {
  return rows.map((r) => ({
    accountExternalId,
    date: r.date_start,
    campaign: r.campaign_id ? { externalId: r.campaign_id, name: r.campaign_name ?? r.campaign_id, objective: metaObjective(r.objective) } : null,
    currency: r.account_currency ?? fallbackCurrency,
    spend: money(r.spend),
    impressions: int(r.impressions),
    reach: int(r.reach), // daily unique reach per campaign — not additive across days
    clicks: int(r.clicks),
    leads: int(metaActionValue(r.actions, META_LEAD_TYPES)),
    purchases: int(metaActionValue(r.actions, META_PURCHASE_TYPES)),
    revenue: money(metaActionValue(r.action_values, META_PURCHASE_TYPES)),
    videoViews: int(metaActionValue(r.actions, ["video_view"])), // 3-second plays
    videoCompletions: int(metaActionValue(r.video_p100_watched_actions, ["video_view"])),
    engagements: int(metaActionValue(r.actions, ["post_engagement"])),
  }));
}

/** Page / IG insights: [{name, values:[{value, end_time}]}] → value per day per metric. */
export type GraphInsightMetric = { name: string; period?: string; values: { value: number | Record<string, number>; end_time: string }[] };

export function graphMetricsByDay(data: GraphInsightMetric[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const m of data) {
    for (const v of m.values ?? []) {
      // end_time is the END of the day in the page timezone (e.g. 2026-09-02T07:00:00+0000 for Sep 1).
      const end = new Date(v.end_time);
      const day = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);
      const val = typeof v.value === "number" ? v.value : Object.values(v.value ?? {}).reduce((s, x) => s + num(x), 0);
      const rec = out.get(day) ?? {};
      rec[m.name] = (rec[m.name] ?? 0) + num(val);
      out.set(day, rec);
    }
  }
  return out;
}

/**
 * Followers per day reconstructed backwards from today's count and the daily net change
 * (followers(d-1) = followers(d) − netChange(d)). Exact when the API reports every day's change.
 */
export function backfillFollowers(days: string[], currentFollowers: number, netChangeByDay: Map<string, number>): Map<string, number> {
  const sorted = [...days].sort();
  const out = new Map<string, number>();
  let running = currentFollowers;
  for (let i = sorted.length - 1; i >= 0; i--) {
    out.set(sorted[i], Math.max(0, Math.round(running)));
    running -= netChangeByDay.get(sorted[i]) ?? 0;
  }
  return out;
}

// ───────────────────────────── Google Ads API ─────────────────────────────

export type GoogleAdsRow = {
  campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string };
  customer?: { currencyCode?: string };
  segments?: { date?: string };
  metrics?: {
    costMicros?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    conversions?: number | string;
    conversionsValue?: number | string;
    videoViews?: string | number;
    engagements?: string | number;
    interactions?: string | number;
  };
};

const GADS_STATUS: Record<string, CampaignStatus> = { ENABLED: "ACTIVE", PAUSED: "PAUSED", REMOVED: "ARCHIVED" };
const GADS_CHANNEL: Record<string, Objective> = {
  SEARCH: "SALES",
  SHOPPING: "SALES",
  PERFORMANCE_MAX: "SALES",
  DISPLAY: "AWARENESS",
  VIDEO: "VIDEO_VIEWS",
  DEMAND_GEN: "TRAFFIC",
  DISCOVERY: "TRAFFIC",
  MULTI_CHANNEL: "APP_INSTALLS",
  LOCAL: "TRAFFIC",
  SMART: "TRAFFIC",
};

export const GOOGLE_ADS_QUERY = (since: string, until: string) =>
  `SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, customer.currency_code, ` +
  `metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.video_views, metrics.engagements ` +
  `FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;

/**
 * googleAds:searchStream batches → MetricDaily rows.
 *  - cost_micros / 1e6 → spend (account currency)
 *  - conversions → purchases when the conversion carries value, otherwise leads
 *    (Google Ads does not distinguish; configure conversion actions accordingly)
 *  - reach is not available at campaign × day level → 0 (documented, never invented)
 */
export function mapGoogleAds(accountExternalId: string, fallbackCurrency: string, batches: { results?: GoogleAdsRow[] }[]): NormalizedMetric[] {
  const out: NormalizedMetric[] = [];
  for (const b of batches) {
    for (const r of b.results ?? []) {
      const m = r.metrics ?? {};
      const conversions = int(m.conversions);
      const value = money(m.conversionsValue);
      out.push({
        accountExternalId,
        date: r.segments?.date ?? "",
        campaign: r.campaign?.id
          ? {
              externalId: String(r.campaign.id),
              name: r.campaign.name ?? String(r.campaign.id),
              status: r.campaign.status ? GADS_STATUS[r.campaign.status] : undefined,
              objective: r.campaign.advertisingChannelType ? GADS_CHANNEL[r.campaign.advertisingChannelType] : undefined,
            }
          : null,
        currency: r.customer?.currencyCode ?? fallbackCurrency,
        spend: money(num(m.costMicros) / 1_000_000),
        impressions: int(m.impressions),
        reach: 0,
        clicks: int(m.clicks),
        leads: value > 0 ? 0 : conversions,
        purchases: value > 0 ? conversions : 0,
        revenue: value,
        videoViews: int(m.videoViews),
        videoCompletions: 0,
        engagements: int(m.engagements),
      });
    }
  }
  return out.filter((r) => r.date);
}

// ───────────────────────────── GA4 Data API ─────────────────────────────

export type Ga4Report = {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
};

export const GA4_METRICS = ["totalUsers", "screenPageViews", "engagedSessions", "sessions"] as const;

/**
 * properties/{id}:runReport (dimension `date`) → OrganicMetricDaily:
 *  totalUsers → reach, screenPageViews → impressions, engagedSessions → engagements.
 *  followers/posts/videoViews do not apply to a website property → 0.
 */
export function mapGa4(accountExternalId: string, report: Ga4Report): NormalizedOrganic[] {
  const metricIdx = (name: string) => report.metricHeaders?.findIndex((h) => h.name === name) ?? -1;
  const dateIdx = report.dimensionHeaders?.findIndex((h) => h.name === "date") ?? 0;
  const get = (row: NonNullable<Ga4Report["rows"]>[number], name: string) => {
    const i = metricIdx(name);
    return i >= 0 ? int(row.metricValues[i]?.value) : 0;
  };
  return (report.rows ?? []).map((row) => {
    const d = row.dimensionValues[Math.max(0, dateIdx)]?.value ?? "";
    return {
      accountExternalId,
      date: d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d,
      followers: 0,
      posts: 0,
      reach: get(row, "totalUsers"),
      impressions: get(row, "screenPageViews"),
      engagements: get(row, "engagedSessions"),
      videoViews: 0,
    };
  });
}

// ───────────────────────────── Search Console ─────────────────────────────

/** searchAnalytics.query (dimension date) → impressions → impressions, clicks → engagements. */
export function mapSearchConsole(accountExternalId: string, rows: { keys: string[]; clicks: number; impressions: number }[]): NormalizedOrganic[] {
  return rows.map((r) => ({
    accountExternalId,
    date: r.keys[0],
    followers: 0,
    posts: 0,
    reach: 0,
    impressions: int(r.impressions),
    engagements: int(r.clicks),
    videoViews: 0,
  }));
}

// ───────────────────────────── YouTube Analytics ─────────────────────────────

export type YtReport = { columnHeaders?: { name: string }[]; rows?: (string | number)[][] };

/** reports?dimensions=day → views → videoViews, likes+comments+shares → engagements, followers backfilled. */
export function mapYoutube(accountExternalId: string, report: YtReport, currentSubscribers: number): NormalizedOrganic[] {
  const idx = (n: string) => report.columnHeaders?.findIndex((h) => h.name === n) ?? -1;
  const rows = report.rows ?? [];
  const at = (r: (string | number)[], n: string) => (idx(n) >= 0 ? num(r[idx(n)]) : 0);
  const net = new Map<string, number>();
  for (const r of rows) net.set(String(r[idx("day")]), at(r, "subscribersGained") - at(r, "subscribersLost"));
  const followers = backfillFollowers([...net.keys()], currentSubscribers, net);
  return rows.map((r) => {
    const day = String(r[idx("day")]);
    return {
      accountExternalId,
      date: day,
      followers: followers.get(day) ?? 0,
      posts: 0,
      reach: 0,
      impressions: 0,
      engagements: int(at(r, "likes") + at(r, "comments") + at(r, "shares")),
      videoViews: int(at(r, "views")),
    };
  });
}

// ───────────────────────────── TikTok Marketing API ─────────────────────────────

export type TikTokReportRow = { dimensions: { campaign_id?: string; stat_time_day?: string }; metrics: Record<string, string | number | undefined> };

/**
 * report/integrated/get (AUCTION_CAMPAIGN, stat_time_day) → MetricDaily.
 * complete_payment → purchases (+ total_complete_payment_rate → revenue); otherwise `conversion` → leads.
 */
export function mapTikTok(accountExternalId: string, currency: string, rows: TikTokReportRow[]): NormalizedMetric[] {
  return rows.map((r) => {
    const m = r.metrics;
    const purchases = int(m.complete_payment);
    return {
      accountExternalId,
      date: String(r.dimensions.stat_time_day ?? "").slice(0, 10),
      campaign: r.dimensions.campaign_id ? { externalId: String(r.dimensions.campaign_id), name: String(m.campaign_name ?? r.dimensions.campaign_id) } : null,
      currency: String(m.currency ?? currency),
      spend: money(m.spend),
      impressions: int(m.impressions),
      reach: int(m.reach),
      clicks: int(m.clicks),
      leads: purchases > 0 ? 0 : int(m.conversion),
      purchases,
      revenue: money(m.total_complete_payment_rate), // "Total complete payment value" in TikTok's metric catalogue
      videoViews: int(m.video_play_actions),
      videoCompletions: int(m.video_views_p100),
      engagements: int(m.engagements),
    };
  });
}

// ───────────────────────────── LinkedIn Marketing API ─────────────────────────────

export type LinkedInAnalyticsRow = {
  dateRange?: { start?: { year: number; month: number; day: number } };
  pivotValues?: string[];
  costInLocalCurrency?: string | number;
  impressions?: number;
  clicks?: number;
  oneClickLeads?: number;
  externalWebsiteConversions?: number;
  videoViews?: number;
  videoCompletions?: number;
  totalEngagements?: number;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** adAnalytics (pivot CAMPAIGN, DAILY) → MetricDaily. oneClickLeads → leads, externalWebsiteConversions → purchases. */
export function mapLinkedIn(accountExternalId: string, currency: string, rows: LinkedInAnalyticsRow[], campaignNames: Map<string, string>): NormalizedMetric[] {
  return rows
    .filter((r) => r.dateRange?.start)
    .map((r) => {
      const s = r.dateRange!.start!;
      const urn = r.pivotValues?.[0] ?? "";
      const id = urn.split(":").pop() ?? "";
      return {
        accountExternalId,
        date: `${s.year}-${pad(s.month)}-${pad(s.day)}`,
        campaign: id ? { externalId: id, name: campaignNames.get(id) ?? id } : null,
        currency,
        spend: money(r.costInLocalCurrency),
        impressions: int(r.impressions),
        reach: 0,
        clicks: int(r.clicks),
        leads: int(r.oneClickLeads),
        purchases: int(r.externalWebsiteConversions),
        revenue: 0,
        videoViews: int(r.videoViews),
        videoCompletions: int(r.videoCompletions),
        engagements: int(r.totalEngagements),
      };
    });
}
