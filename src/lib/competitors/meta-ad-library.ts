import "server-only";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

/**
 * Official Meta Ad Library API client (Graph API `ads_archive` endpoint).
 * https://www.facebook.com/ads/library/api — requires an identity-verified developer account and a
 * long-lived user access token in META_AD_LIBRARY_TOKEN. No scraping: when the token is missing
 * callers show a setup message instead of failing.
 *
 * Notes on data honesty:
 *  - `spend` / `impressions` ranges are only returned by Meta for ads it discloses them for
 *    (political & issue ads, some EU-delivered ads). We store them as official ranges only then.
 *  - `ad_snapshot_url` embeds the access token, so we never request or store it; instead we link to
 *    the public Ad Library page of the ad.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}/ads_archive`;
const FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_captions",
  "ad_creative_link_descriptions",
  "publisher_platforms",
  "languages",
  "spend",
  "currency",
].join(",");

export function adLibraryConfigured() {
  return Boolean(process.env.META_AD_LIBRARY_TOKEN);
}

export type LibraryAd = {
  id: string;
  page_id?: string;
  page_name?: string;
  ad_creation_time?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_captions?: string[];
  ad_creative_link_descriptions?: string[];
  publisher_platforms?: string[];
  languages?: string[];
  spend?: { lower_bound?: string; upper_bound?: string };
  currency?: string;
};

export type LibraryFailure = { ok: false; reason: "NOT_CONFIGURED" | "AUTH" | "PERMISSION" | "RATE_LIMITED" | "FAILED"; message?: string };
export type LibraryResult = { ok: true; ads: LibraryAd[]; truncated: boolean } | LibraryFailure;

export type LibraryQuery = {
  /** ISO-3166 alpha-2 countries the ads reached (required by the API). */
  countries: string[];
  pageIds?: string[];
  searchTerms?: string;
  activeStatus?: "ALL" | "ACTIVE" | "INACTIVE";
  /** Only ads delivered on/after this date. */
  since?: Date;
  maxPages?: number;
};

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number } };

function classify(e: GraphError["error"]): LibraryFailure {
  const code = e?.code;
  if (code === 190) return { ok: false, reason: "AUTH", message: e?.message };
  if (code === 10 || code === 200 || code === 2332002) return { ok: false, reason: "PERMISSION", message: e?.message };
  if (code === 4 || code === 17 || code === 613 || code === 80004) return { ok: false, reason: "RATE_LIMITED", message: e?.message };
  return { ok: false, reason: "FAILED", message: e?.message };
}

/** Query the official ads_archive endpoint, following cursor pagination up to `maxPages` × 100 ads. */
export async function searchAdLibrary(q: LibraryQuery): Promise<LibraryResult> {
  const token = process.env.META_AD_LIBRARY_TOKEN;
  if (!token) return { ok: false, reason: "NOT_CONFIGURED" };
  if (!q.pageIds?.length && !q.searchTerms) return { ok: false, reason: "FAILED", message: "pageIds or searchTerms required" };

  const params = new URLSearchParams({
    access_token: token,
    ad_type: "ALL",
    ad_active_status: q.activeStatus ?? "ALL",
    ad_reached_countries: JSON.stringify(q.countries.map((c) => c.toUpperCase())),
    fields: FIELDS,
    limit: "100",
  });
  if (q.pageIds?.length) params.set("search_page_ids", JSON.stringify(q.pageIds));
  if (q.searchTerms) params.set("search_terms", q.searchTerms.slice(0, 100));
  if (q.since) params.set("ad_delivery_date_min", q.since.toISOString().slice(0, 10));

  const ads: LibraryAd[] = [];
  let url: string | undefined = `${BASE}?${params.toString()}`;
  const maxPages = q.maxPages ?? 3;
  let pages = 0;
  try {
    while (url && pages < maxPages) {
      const res: Response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const json = (await res.json().catch(() => ({}))) as GraphError & { data?: LibraryAd[]; paging?: { next?: string } };
      if (!res.ok || json.error) {
        const failure = classify(json.error);
        logger.warn("meta_ad_library.error", { status: res.status, code: json.error?.code, reason: failure.reason });
        return failure;
      }
      ads.push(...(json.data ?? []));
      url = json.paging?.next;
      pages++;
    }
  } catch (e) {
    logger.error("meta_ad_library.network", { message: (e as Error).message });
    return { ok: false, reason: "FAILED", message: "Network error while contacting the Meta Ad Library API" };
  }
  return { ok: true, ads, truncated: Boolean(url) };
}

export function publicAdLibraryUrl(id: string) {
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
}

function firstNonEmpty(xs?: string[]) {
  return xs?.map((x) => x.trim()).find(Boolean) ?? null;
}

function clip(s: string | null, n: number) {
  return s && s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function day(s?: string) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function decimalOrNull(v?: string) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map one ads_archive record to CompetitorAd fields (source = API).
 * Creative text is kept as the observed record of the competitor's ad (for analysis only) —
 * idea generation never reuses it verbatim.
 */
export function mapLibraryAd(ad: LibraryAd, competitorId: string, now = new Date()): Prisma.CompetitorAdUncheckedCreateInput | null {
  const first = day(ad.ad_delivery_start_time) ?? day(ad.ad_creation_time);
  if (!first) return null;
  const stop = day(ad.ad_delivery_stop_time);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const isActive = !stop || stop >= today;
  const bodies = new Set((ad.ad_creative_bodies ?? []).map((b) => b.trim()).filter(Boolean));
  const titles = new Set((ad.ad_creative_link_titles ?? []).map((b) => b.trim()).filter(Boolean));
  const caption = firstNonEmpty(ad.ad_creative_link_captions);
  const min = decimalOrNull(ad.spend?.lower_bound);
  const max = decimalOrNull(ad.spend?.upper_bound);
  return {
    competitorId,
    platform: "META",
    libraryId: ad.id,
    libraryUrl: publicAdLibraryUrl(ad.id),
    firstSeen: first,
    lastSeen: isActive ? today : stop!,
    isActive,
    placements: (ad.publisher_platforms ?? []).map((p) => p.toLowerCase()),
    hook: clip(firstNonEmpty(ad.ad_creative_link_titles), 200),
    message: clip(firstNonEmpty(ad.ad_creative_bodies), 500),
    offer: clip(firstNonEmpty(ad.ad_creative_link_descriptions), 200),
    landingPage: caption ? clip(caption.includes("://") ? caption : `https://${caption.toLowerCase()}`, 300) : null,
    variantCount: Math.max(1, bodies.size, titles.size),
    officialSpendMin: min,
    officialSpendMax: max, // null upper bound = open-ended range (e.g. "≥ 1M")
    officialSpendCurrency: min != null || max != null ? (ad.currency ?? null) : null,
    source: "API",
  };
}
