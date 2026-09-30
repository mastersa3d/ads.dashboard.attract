import "server-only";
import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { metricWhere, type Filters } from "@/lib/filters";
import { deriveKpis, EMPTY_TOTALS, SUM_FIELDS, totalsFromSum, type Kpis, type Totals } from "@/lib/metrics";
import { convert } from "@/lib/fx";
import type { Q } from "@/lib/queries/performance";

export type AccountRow = Kpis & { id: string; name: string; platform: Platform; currency: string };

/**
 * Ad-account level roll-up (lib/queries/performance has campaign/ad set/ad levels only).
 * Converts every currency to the reporting currency like the shared queries do, and lists
 * accounts with no delivery in the range so the drill-down never hides an account.
 */
export async function byAccount(f: Filters, q: Q): Promise<AccountRow[]> {
  const accounts = await db.adAccount.findMany({
    where: {
      ...q.scope,
      isOrganic: false,
      ...(f.brandId ? { brandId: f.brandId } : {}),
      ...(f.platforms.length ? { platform: { in: f.platforms } } : {}),
    },
    select: { id: true, name: true, platform: true, currency: true },
    orderBy: { name: "asc" },
  });
  const rows = f.mode === "organic" ? [] : await db.metricDaily.groupBy({ by: ["accountId", "currency"], where: metricWhere(f, q.scope), _sum: SUM_FIELDS });
  const sums = new Map<string, Totals>();
  for (const r of rows) {
    const t = totalsFromSum(r._sum);
    t.spend = convert(t.spend, r.currency, q.currency, q.fx);
    t.revenue = convert(t.revenue, r.currency, q.currency, q.fx);
    const cur = sums.get(r.accountId);
    if (cur) for (const k of Object.keys(t) as (keyof Totals)[]) cur[k] += t[k];
    else sums.set(r.accountId, t);
  }
  return accounts.map((a) => ({ ...a, ...deriveKpis(sums.get(a.id) ?? { ...EMPTY_TOTALS }) }));
}

/** Scoped lookups for the breadcrumb — an id from the URL is only trusted after this. */
export async function drillPath(scope: Q["scope"], ids: { account?: string; campaign?: string; adset?: string; ad?: string }) {
  const [account, campaign, adSet, ad] = await Promise.all([
    ids.account ? db.adAccount.findFirst({ where: { id: ids.account, ...scope }, select: { id: true, name: true, platform: true } }) : null,
    ids.campaign ? db.campaign.findFirst({ where: { id: ids.campaign, ...scope }, select: { id: true, name: true, accountId: true, platform: true, objective: true, status: true } }) : null,
    ids.adset ? db.adSet.findFirst({ where: { id: ids.adset, campaign: scope }, select: { id: true, name: true, campaignId: true, audience: true, status: true } }) : null,
    ids.ad
      ? db.ad.findFirst({ where: { id: ids.ad, adSet: { campaign: scope } }, select: { id: true, name: true, adSetId: true, format: true, headline: true, previewUrl: true, status: true } })
      : null,
  ]);
  return { account, campaign, adSet, ad };
}

/** Children that exist in the catalogue (so paused / not-yet-delivering items still show). */
export async function childEntities(level: "campaign" | "adSet" | "ad", scope: Q["scope"], f: Filters, parentId?: string) {
  if (level === "campaign") {
    return db.campaign.findMany({
      where: {
        ...scope,
        ...(parentId ? { accountId: parentId } : {}),
        ...(f.brandId ? { brandId: f.brandId } : {}),
        ...(f.platforms.length ? { platform: { in: f.platforms } } : {}),
        ...(f.objective ? { objective: f.objective } : {}),
        ...(f.status ? { status: f.status } : {}),
        ...(f.funnel ? { funnelStage: f.funnel } : {}),
      },
      select: { id: true, name: true, platform: true, status: true, objective: true },
      take: 2000,
    });
  }
  if (level === "adSet") {
    return (
      await db.adSet.findMany({ where: { campaign: scope, ...(parentId ? { campaignId: parentId } : {}) }, select: { id: true, name: true, status: true, campaign: { select: { platform: true } } }, take: 2000 })
    ).map((a) => ({ id: a.id, name: a.name, status: a.status, platform: a.campaign.platform, objective: undefined }));
  }
  return (
    await db.ad.findMany({
      where: { adSet: { campaign: scope }, ...(parentId ? { adSetId: parentId } : {}) },
      select: { id: true, name: true, status: true, format: true, adSet: { select: { campaign: { select: { platform: true } } } } },
      take: 2000,
    })
  ).map((a) => ({ id: a.id, name: a.name, status: a.status, format: a.format, platform: a.adSet.campaign.platform, objective: undefined }));
}
