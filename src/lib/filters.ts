import type { Prisma, Platform, Objective, CampaignStatus, FunnelStage, ContentStatus, ContentType } from "@prisma/client";
import { isoDay } from "@/lib/format";

/**
 * Global filters live in the URL so every page, chart, table, export and saved view
 * sees the same state. Keys are short and stable because Saved Views persist them.
 */
export const FILTER_KEYS = [
  "client",
  "brand",
  "account",
  "platform",
  "from",
  "to",
  "compare",
  "objective",
  "campaign",
  "adset",
  "ad",
  "status",
  "funnel",
  "mode",
  "country",
  "branch",
  "product",
  "audience",
  "device",
  "placement",
  "gender",
  "age",
  "currency",
  "manager",
  "creator",
  "ctype",
  "cstatus",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];
export type RawParams = Record<string, string | string[] | undefined>;

export type Filters = {
  clientId?: string;
  brandId?: string;
  accountId?: string;
  platforms: Platform[];
  from: Date;
  to: Date;
  compare: "prev" | "yoy" | "none";
  objective?: Objective;
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  status?: CampaignStatus;
  funnel?: FunnelStage;
  mode: "all" | "paid" | "organic";
  country?: string;
  branch?: string;
  product?: string;
  audience?: string;
  device?: string;
  placement?: string;
  gender?: string;
  age?: string;
  currency?: string;
  managerId?: string;
  creatorId?: string;
  contentType?: ContentType;
  contentStatus?: ContentStatus;
};

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

function parseDay(s: string | undefined): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(s + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseFilters(sp: RawParams, now = new Date()): Filters {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  let from = parseDay(one(sp.from)) ?? defaultFrom;
  let to = parseDay(one(sp.to)) ?? today;
  if (from > to) [from, to] = [to, from];

  const platforms = (one(sp.platform)?.split(",") ?? []).filter(Boolean) as Platform[];
  const compare = one(sp.compare);
  const mode = one(sp.mode);

  return {
    clientId: one(sp.client),
    brandId: one(sp.brand),
    accountId: one(sp.account),
    platforms,
    from,
    to,
    compare: compare === "yoy" || compare === "none" ? compare : "prev",
    objective: one(sp.objective) as Objective | undefined,
    campaignId: one(sp.campaign),
    adSetId: one(sp.adset),
    adId: one(sp.ad),
    status: one(sp.status) as CampaignStatus | undefined,
    funnel: one(sp.funnel) as FunnelStage | undefined,
    mode: mode === "paid" || mode === "organic" ? mode : "all",
    country: one(sp.country),
    branch: one(sp.branch),
    product: one(sp.product),
    audience: one(sp.audience),
    device: one(sp.device),
    placement: one(sp.placement),
    gender: one(sp.gender),
    age: one(sp.age),
    currency: one(sp.currency),
    managerId: one(sp.manager),
    creatorId: one(sp.creator),
    contentType: one(sp.ctype) as ContentType | undefined,
    contentStatus: one(sp.cstatus) as ContentStatus | undefined,
  };
}

/** Same-length window immediately before, or same window last year. */
export function comparisonRange(f: Filters): { from: Date; to: Date } | null {
  if (f.compare === "none") return null;
  if (f.compare === "yoy") {
    const from = new Date(f.from);
    const to = new Date(f.to);
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    to.setUTCFullYear(to.getUTCFullYear() - 1);
    return { from, to };
  }
  const days = Math.round((f.to.getTime() - f.from.getTime()) / 86400000) + 1;
  const to = new Date(f.from);
  to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from, to };
}

export function daysInRange(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

/** Campaign-level filters shared by metric and campaign queries. */
export function campaignWhere(f: Filters): Prisma.CampaignWhereInput {
  const w: Prisma.CampaignWhereInput = {};
  if (f.brandId) w.brandId = f.brandId;
  if (f.accountId) w.accountId = f.accountId;
  if (f.platforms.length) w.platform = { in: f.platforms };
  if (f.objective) w.objective = f.objective;
  if (f.campaignId) w.id = f.campaignId;
  if (f.status) w.status = f.status;
  if (f.funnel) w.funnelStage = f.funnel;
  if (f.product) w.product = f.product;
  if (f.country) w.country = f.country;
  if (f.branch) w.branch = f.branch;
  if (f.managerId) w.client = { accountManagerId: f.managerId };
  if (f.audience) w.adSets = { some: { audience: f.audience } };
  return w;
}

/**
 * Where-clause for MetricDaily. `scope` MUST come from tenant.clientWhere() so
 * isolation is enforced even if a filter is tampered with.
 */
export function metricWhere(
  f: Filters,
  scope: Prisma.MetricDailyWhereInput,
  range: { from: Date; to: Date } = f,
): Prisma.MetricDailyWhereInput {
  const w: Prisma.MetricDailyWhereInput = { ...scope, date: { gte: range.from, lte: range.to } };
  if (f.accountId) w.accountId = f.accountId;
  if (f.platforms.length) w.platform = { in: f.platforms };
  if (f.campaignId) w.campaignId = f.campaignId;
  if (f.adSetId) w.adSetId = f.adSetId;
  if (f.adId) w.adId = f.adId;
  if (f.device) w.device = f.device;
  if (f.placement) w.placement = f.placement;
  if (f.gender) w.gender = f.gender;
  if (f.age) w.ageRange = f.age;
  if (f.country) w.country = f.country;
  const cw = campaignWhere({ ...f, campaignId: undefined, accountId: undefined, platforms: [], country: undefined });
  if (Object.keys(cw).length) w.campaign = cw;
  return w;
}

/** Serialize filters back into a query string (used by links, exports and saved views). */
export function filtersToQuery(sp: RawParams, overrides: Partial<Record<FilterKey, string | null>> = {}) {
  const q = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = k in overrides ? overrides[k] : one(sp[k]);
    if (v) q.set(k, v);
  }
  return q.toString();
}

export function defaultRangeQuery(now = new Date()) {
  const f = parseFilters({}, now);
  return `from=${isoDay(f.from)}&to=${isoDay(f.to)}`;
}
