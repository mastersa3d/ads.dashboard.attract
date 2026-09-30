import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Filters } from "@/lib/filters";
import { isoDay } from "@/lib/format";

type ScopeWhere = { clientId: string | { in: string[] } };
type Range = { from: Date; to: Date };

/**
 * Organic filters mirror organicSummary() in lib/queries/performance.ts (scope + dates + platforms)
 * so the charts and the KPI tiles always describe the same rows.
 */
function organicWhere(f: Filters, scope: ScopeWhere, range: Range): Prisma.OrganicMetricDailyWhereInput {
  const w: Prisma.OrganicMetricDailyWhereInput = { ...scope, date: { gte: range.from, lte: range.to } };
  if (f.platforms.length) w.platform = { in: f.platforms };
  return w;
}

/** Daily organic totals across all pages/profiles in scope. Empty when the user filters to paid only. */
export async function organicSeries(f: Filters, scope: ScopeWhere, range: Range = f) {
  if (f.mode === "paid") return [];
  const rows = await db.organicMetricDaily.groupBy({
    by: ["date"],
    where: organicWhere(f, scope, range),
    _sum: { followers: true, reach: true, impressions: true, engagements: true, posts: true, videoViews: true },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => {
    const s = r._sum;
    return {
      date: isoDay(r.date),
      followers: s.followers ?? 0,
      reach: s.reach ?? 0,
      impressions: s.impressions ?? 0,
      engagements: s.engagements ?? 0,
      posts: s.posts ?? 0,
      videoViews: s.videoViews ?? 0,
      engagementRate: s.impressions ? (s.engagements ?? 0) / s.impressions : null,
    };
  });
}

/** Platforms + data source of organic rows in scope, and the latest day with data. */
export async function organicMeta(f: Filters, scope: ScopeWhere, t: (k: string) => string) {
  const [groups, latest] = await Promise.all([
    db.organicMetricDaily.groupBy({ by: ["platform", "source"], where: organicWhere(f, scope, f) }),
    db.organicMetricDaily.aggregate({ where: { ...scope }, _max: { date: true } }),
  ]);
  if (!groups.length) return { source: "—", latest: latest._max.date };
  const plats = [...new Set(groups.map((g) => t(`platform.${g.platform}`)))].join(", ");
  const demo = groups.some((g) => g.source === "DEMO");
  return { source: demo ? `${plats} (${t("source.DEMO")})` : `${plats} — ${t("source.API")}`, latest: latest._max.date };
}
