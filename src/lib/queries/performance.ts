import "server-only";
import { Prisma, type Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { comparisonRange, metricWhere, type Filters } from "@/lib/filters";
import { deriveKpis, EMPTY_TOTALS, SUM_FIELDS, totalsFromSum, type Kpis, type Totals } from "@/lib/metrics";
import { isoDay, toNum } from "@/lib/format";
import { convert, type FxTable } from "@/lib/fx";

type ScopeWhere = { clientId: string | { in: string[] } };
/** Query context: tenant scope + reporting currency + FX table (from pageContext().q). */
export type Q = { scope: ScopeWhere; currency: string; fx: FxTable };
type Range = { from: Date; to: Date };

/** Paid metrics are excluded when the user filters to organic only. */
function paidWhere(f: Filters, scope: ScopeWhere, range?: Range): Prisma.MetricDailyWhereInput {
  const w = metricWhere(f, scope, range ?? f);
  return f.mode === "organic" ? { ...w, id: "__none__" } : w;
}

/** Sum groupBy rows (that include `currency`) into Totals converted to the reporting currency. */
function mergeRows<R extends { currency: string; _sum: Record<string, unknown> }>(rows: R[], q: Q, keyOf: (r: R) => string) {
  const out = new Map<string, { sample: R; totals: Totals }>();
  for (const r of rows) {
    const t = totalsFromSum(r._sum as never);
    t.spend = convert(t.spend, r.currency, q.currency, q.fx);
    t.revenue = convert(t.revenue, r.currency, q.currency, q.fx);
    const k = keyOf(r);
    const cur = out.get(k);
    if (cur) for (const f of Object.keys(t) as (keyof Totals)[]) cur.totals[f] += t[f];
    else out.set(k, { sample: r, totals: t });
  }
  return [...out.values()];
}

export async function totals(f: Filters, q: Q, range?: Range): Promise<Kpis> {
  const rows = await db.metricDaily.groupBy({ by: ["currency"], where: paidWhere(f, q.scope, range), _sum: SUM_FIELDS });
  const merged = mergeRows(rows, q, () => "all");
  return deriveKpis(merged[0]?.totals ?? { ...EMPTY_TOTALS });
}

/** Current + comparison period in one call. */
export async function totalsWithComparison(f: Filters, q: Q) {
  const cmp = comparisonRange(f);
  const [current, previous] = await Promise.all([totals(f, q), cmp ? totals(f, q, cmp) : Promise.resolve(null)]);
  return { current, previous, cmpRange: cmp };
}

export async function dailySeries(f: Filters, q: Q, range?: Range) {
  const rows = await db.metricDaily.groupBy({ by: ["date", "currency"], where: paidWhere(f, q.scope, range), _sum: SUM_FIELDS, orderBy: { date: "asc" } });
  return mergeRows(rows, q, (r) => r.date.toISOString()).map((m) => ({ date: m.sample.date, ...deriveKpis(m.totals) }));
}

export async function byPlatform(f: Filters, q: Q) {
  const rows = await db.metricDaily.groupBy({ by: ["platform", "currency"], where: paidWhere(f, q.scope), _sum: SUM_FIELDS });
  return mergeRows(rows, q, (r) => r.platform).map((m) => ({ platform: m.sample.platform as Platform, ...deriveKpis(m.totals) }));
}

/** Generic breakdown by any dimension column on MetricDaily. */
export async function byDimension(f: Filters, q: Q, dim: "device" | "placement" | "gender" | "ageRange" | "country" | "platform") {
  const rows = await db.metricDaily.groupBy({ by: [dim, "currency"], where: paidWhere(f, q.scope), _sum: SUM_FIELDS });
  return mergeRows(rows as unknown as { currency: string; _sum: Record<string, unknown> }[], q, (r) => String((r as Record<string, unknown>)[dim] ?? "")).map((m) => ({
    key: ((m.sample as Record<string, unknown>)[dim] as string | null) ?? null,
    ...deriveKpis(m.totals),
  }));
}

export type EntityRow = Kpis & { id: string; name: string; platform?: Platform; status?: string; objective?: string; parentId?: string | null; format?: string | null };

/** Campaign / ad set / ad level table with names — powers drill-down. */
export async function byEntity(f: Filters, q: Q, level: "campaign" | "adSet" | "ad", range?: Range): Promise<EntityRow[]> {
  const key = level === "campaign" ? "campaignId" : level === "adSet" ? "adSetId" : "adId";
  const raw = await db.metricDaily.groupBy({ by: [key, "currency"], where: paidWhere(f, q.scope, range), _sum: SUM_FIELDS });
  const rows = mergeRows(raw as unknown as { currency: string; _sum: Record<string, unknown> }[], q, (r) => String((r as Record<string, unknown>)[key]));
  const ids = rows.map((r) => (r.sample as Record<string, unknown>)[key] as string).filter(Boolean);
  const names = new Map<string, { name: string; platform?: Platform; status?: string; objective?: string; parentId?: string | null; format?: string | null }>();
  if (level === "campaign") {
    for (const c of await db.campaign.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, platform: true, status: true, objective: true } })) names.set(c.id, c);
  } else if (level === "adSet") {
    for (const a of await db.adSet.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, status: true, campaignId: true } })) names.set(a.id, { ...a, parentId: a.campaignId });
  } else {
    for (const a of await db.ad.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, status: true, adSetId: true, format: true } })) names.set(a.id, { ...a, parentId: a.adSetId });
  }
  return rows
    .map((r) => {
      const id = (r.sample as Record<string, unknown>)[key] as string;
      const meta = names.get(id);
      return { id, name: meta?.name ?? id, platform: meta?.platform, status: meta?.status, objective: meta?.objective, parentId: meta?.parentId, format: meta?.format, ...deriveKpis(r.totals) };
    })
    .filter((r) => r.id);
}

/** Organic followers growth & engagement for the range (latest vs earliest followers per account). */
export async function organicSummary(f: Filters, q: Q, range?: Range) {
  const scope = q.scope;
  if (f.mode === "paid") return null;
  const rg = range ?? f;
  const where: Prisma.OrganicMetricDailyWhereInput = { ...scope, date: { gte: rg.from, lte: rg.to } };
  if (f.platforms.length) where.platform = { in: f.platforms };
  const [agg, firstLast] = await Promise.all([
    db.organicMetricDaily.aggregate({ where, _sum: { reach: true, impressions: true, engagements: true, posts: true, videoViews: true } }),
    db.organicMetricDaily.groupBy({ by: ["accountId"], where, _min: { date: true }, _max: { date: true } }),
  ]);
  let start = 0;
  let end = 0;
  for (const g of firstLast) {
    const [a, b] = await Promise.all([
      db.organicMetricDaily.findFirst({ where: { accountId: g.accountId, date: g._min.date! }, select: { followers: true } }),
      db.organicMetricDaily.findFirst({ where: { accountId: g.accountId, date: g._max.date! }, select: { followers: true } }),
    ]);
    start += a?.followers ?? 0;
    end += b?.followers ?? 0;
  }
  const s = agg._sum;
  return {
    followersStart: start,
    followersEnd: end,
    followersGrowth: start > 0 ? (end - start) / start : null,
    reach: s.reach ?? 0,
    impressions: s.impressions ?? 0,
    engagements: s.engagements ?? 0,
    posts: s.posts ?? 0,
    videoViews: s.videoViews ?? 0,
    engagementRate: s.impressions ? (s.engagements ?? 0) / s.impressions : null,
  };
}

/** Planned budget prorated to the selected date range from all overlapping budget plans. */
export async function plannedBudget(f: Filters, q: Q, range?: Range) {
  const scope = q.scope;
  const rg = range ?? f;
  const plans = await db.budgetPlan.findMany({
    where: { ...scope, startDate: { lte: rg.to }, endDate: { gte: rg.from } },
    include: { lines: true },
  });
  let planned = 0;
  let fullPeriod = 0;
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  for (const p of plans) {
    const lines = f.platforms.length ? p.lines.filter((l) => !l.platform || f.platforms.includes(l.platform)) : p.lines;
    const rawTotal = f.platforms.length ? lines.reduce((s, l) => s + toNum(l.plannedBudget), 0) : toNum(p.totalBudget);
    const total = convert(rawTotal, p.currency, q.currency, q.fx);
    const planDays = (p.endDate.getTime() - p.startDate.getTime()) / 86400000 + 1;
    const oStart = Math.max(p.startDate.getTime(), rg.from.getTime());
    const oEnd = Math.min(p.endDate.getTime(), rg.to.getTime());
    const overlap = Math.max(0, (oEnd - oStart) / 86400000 + 1);
    planned += total * (overlap / planDays);
    fullPeriod += total;
    if (!periodStart || p.startDate < periodStart) periodStart = p.startDate;
    if (!periodEnd || p.endDate > periodEnd) periodEnd = p.endDate;
  }
  return { planned, fullPeriod, plans, periodStart, periodEnd };
}

export function toChartRows(series: { date: Date }[], keys: string[]) {
  return series.map((s) => {
    const row: Record<string, string | number | null> = { date: isoDay(s.date) };
    for (const k of keys) row[k] = ((s as Record<string, unknown>)[k] as number | null) ?? null;
    return row;
  });
}

export { EMPTY_TOTALS };
export type { Totals };
