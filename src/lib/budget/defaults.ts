import "server-only";
import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import { isoDay } from "@/lib/format";
import { convert, type FxTable } from "@/lib/fx";
import { byEntity, byPlatform } from "@/lib/queries/performance";
import { benchmarksFor } from "@/lib/queries/benchmarks";
import type { CampaignInput, CostAssumption, CostSource, HistoryKpis } from "./allocation";
import { PAID_PLATFORMS, type PlanAssumptions } from "./plan";

export { PAID_PLATFORMS };


const HISTORY_DAYS = 90;

export type PlanningDefaults = {
  currency: string;
  historyFrom: Date;
  historyTo: Date;
  platforms: Platform[];
  history: Partial<Record<Platform, HistoryKpis>>;
  previous: PlanAssumptions["previous"];
  market: PlanAssumptions["market"];
  costs: Partial<Record<Platform, CostAssumption>>;
  costSources: PlanAssumptions["costSources"];
  campaigns: (CampaignInput & { status: string })[];
  benchmarkSource: string | null;
};

/**
 * Default cost assumptions for a client's plan, per platform:
 *   1. the client's own last-90-day results (converted to `currency`), else
 *   2. the most specific benchmark median (market average), else
 *   3. unknown — the planner must type a value.
 * Money benchmarks carry no currency in the schema; they are treated as being in the
 * organization's base currency and converted (flagged as an estimate in the UI).
 */
export async function planningDefaults(opts: {
  clientId: string;
  organizationId: string;
  orgCurrency: string;
  currency: string;
  fx: FxTable;
  country?: string | null;
  industry?: string | null;
  now?: Date;
}): Promise<PlanningDefaults> {
  const now = opts.now ?? new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - (HISTORY_DAYS - 1) * 86400000);
  const f = parseFilters({ from: isoDay(from), to: isoDay(to) }, now);
  const q = { scope: { clientId: opts.clientId }, currency: opts.currency, fx: opts.fx };

  const [plats, camps, campaignRows, accounts] = await Promise.all([
    byPlatform(f, q),
    byEntity(f, q, "campaign"),
    db.campaign.findMany({
      where: { clientId: opts.clientId, status: { in: ["ACTIVE", "PAUSED", "DRAFT"] } },
      select: { id: true, name: true, platform: true, objective: true, funnelStage: true, status: true },
      orderBy: { name: "asc" },
    }),
    db.adAccount.findMany({ where: { clientId: opts.clientId }, select: { platform: true } }),
  ]);

  const available = new Set<Platform>([...accounts.map((a) => a.platform), ...campaignRows.map((c) => c.platform), ...plats.map((p) => p.platform)]);
  const platforms = PAID_PLATFORMS.filter((p) => available.has(p));
  const bms = await Promise.all(
    (platforms.length ? platforms : (["META"] as Platform[])).map(async (p) => [p, await benchmarksFor({ organizationId: opts.organizationId, platforms: [p], country: opts.country, industry: opts.industry })] as const),
  );

  const history: PlanningDefaults["history"] = {};
  const previous: PlanningDefaults["previous"] = {};
  for (const p of plats) {
    history[p.platform] = { spend: p.spend, impressions: p.impressions, clicks: p.clicks, leads: p.leads, purchases: p.purchases, revenue: p.revenue, reach: p.reach };
    previous[p.platform] = { spend: p.spend, cpm: p.cpm, cpc: p.cpc, cpl: p.cpl, cvr: p.cvr, roas: p.roas };
  }

  const market: PlanningDefaults["market"] = {};
  const costs: PlanningDefaults["costs"] = {};
  const costSources: PlanningDefaults["costSources"] = {};
  let benchmarkSource: string | null = null;
  for (const [p, rows] of bms) {
    // Benchmarks are chosen per metric; only keep rows that are actually for this platform.
    const pick = (metric: string) => rows.find((b) => b.metric === metric && b.platform === p);
    const money = (metric: string) => {
      const b = pick(metric);
      return b ? convert(b.median, b.currency ?? opts.orgCurrency, opts.currency, opts.fx) : null;
    };
    const m = { cpm: money("CPM"), cpc: money("CPC"), cpl: money("CPL"), cvr: pick("CVR")?.median ?? null, aov: null, sourceName: pick("CPM")?.sourceName ?? pick("CPC")?.sourceName };
    market[p] = m;
    benchmarkSource ??= m.sourceName ?? null;

    const h = previous[p];
    const aov = history[p] && history[p]!.purchases > 0 ? history[p]!.revenue / history[p]!.purchases : null;
    const hist: CostAssumption = { cpm: h?.cpm ?? null, cpc: h?.cpc ?? null, cpl: h?.cpl ?? null, cvr: h?.cvr ?? null, aov };
    const c: CostAssumption = { cpm: null, cpc: null, cpl: null, cvr: null, aov: null };
    const src: Partial<Record<keyof CostAssumption, CostSource>> = {};
    for (const k of ["cpm", "cpc", "cpl", "cvr", "aov"] as const) {
      const hv = hist[k];
      const mv = k === "aov" ? null : m[k];
      if (hv != null && hv > 0) {
        c[k] = round(hv, k);
        src[k] = "history";
      } else if (mv != null && mv > 0) {
        c[k] = round(mv, k);
        src[k] = "benchmark";
      }
    }
    costs[p] = c;
    costSources[p] = src;
  }

  const spendById = new Map(camps.map((c) => [c.id, c.spend]));
  return {
    currency: opts.currency,
    historyFrom: from,
    historyTo: to,
    platforms,
    history,
    previous,
    market,
    costs,
    costSources,
    campaigns: campaignRows
      .filter((c) => PAID_PLATFORMS.includes(c.platform))
      .map((c) => ({ id: c.id, name: c.name, platform: c.platform, objective: c.objective, funnelStage: c.funnelStage, status: c.status, historySpend: spendById.get(c.id) ?? 0 })),
    benchmarkSource,
  };
}

function round(v: number, k: keyof CostAssumption) {
  return k === "cvr" ? Math.round(v * 10000) / 10000 : Math.round(v * 100) / 100;
}
