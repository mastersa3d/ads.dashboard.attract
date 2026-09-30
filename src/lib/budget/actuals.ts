import "server-only";
import type { BudgetLine, BudgetPlan, Expense, Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import { isoDay, toNum } from "@/lib/format";
import { convert, type FxTable } from "@/lib/fx";
import { byEntity, byPlatform, dailySeries } from "@/lib/queries/performance";
import { roleOfFunnel } from "./allocation";
import { isMediaLine, planDays } from "./plan";

export type ActualTotals = { spend: number; impressions: number; reach: number; clicks: number; leads: number; purchases: number; revenue: number };
const zero = (): ActualTotals => ({ spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, purchases: 0, revenue: 0 });
function add(a: ActualTotals, b: Partial<ActualTotals>) {
  for (const k of Object.keys(a) as (keyof ActualTotals)[]) a[k] += b[k] ?? 0;
}

export type PlanWithLines = BudgetPlan & { lines: BudgetLine[] };

export type PlanActuals = {
  asOf: Date;
  started: boolean;
  elapsedDays: number;
  totalDays: number;
  byLine: Map<string, ActualTotals & { expenses: number }>;
  /** Ad spend on the plan's platforms that no line covers (campaigns outside the plan). */
  unplanned: ({ platform: Platform } & ActualTotals)[];
  unassignedExpenses: number;
  /** Media spend per day in the plan currency (for pacing). */
  daily: { date: Date; spend: number }[];
  expenses: (Expense & { amountPlan: number })[];
  media: ActualTotals;
  expensesTotal: number;
};

/**
 * Actual results for a budget plan, in the plan currency (FX-converted):
 *  - lines linked to a campaign get that campaign's metrics;
 *  - other campaigns on a planned platform go to the line for their audience role
 *    (funnel stage → prospecting / retargeting / retention), else any platform-level line,
 *    else they are reported as "unplanned spend";
 *  - non-media lines (production, contingency…) are matched with manual expenses.
 * The caller must have verified the plan belongs to an accessible client.
 */
export async function planActuals(plan: PlanWithLines, fx: FxTable, now = new Date()): Promise<PlanActuals> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const asOf = plan.endDate < today ? plan.endDate : today;
  const started = plan.startDate <= today;
  const totalDays = planDays(plan.startDate, plan.endDate);
  const elapsedDays = started ? Math.min(totalDays, planDays(plan.startDate, asOf)) : 0;

  const byLine = new Map(plan.lines.map((l) => [l.id, { ...zero(), expenses: 0 }]));
  const media = zero();
  const out: PlanActuals = { asOf, started, elapsedDays, totalDays, byLine, unplanned: [], unassignedExpenses: 0, daily: [], expenses: [], media, expensesTotal: 0 };

  const expenses = await db.expense.findMany({ where: { clientId: plan.clientId, date: { gte: plan.startDate, lte: plan.endDate } }, orderBy: { date: "desc" } });
  const lineIds = new Set(plan.lines.map((l) => l.id));
  for (const e of expenses) {
    // An expense tied to another plan's line is not ours; unassigned ones are shown separately.
    if (e.planLineId && !lineIds.has(e.planLineId)) continue;
    const amountPlan = convert(toNum(e.amount), e.currency, plan.currency, fx);
    out.expenses.push({ ...e, amountPlan });
    out.expensesTotal += amountPlan;
    if (e.planLineId) {
      const a = byLine.get(e.planLineId)!;
      a.expenses += amountPlan;
      a.spend += amountPlan;
    } else out.unassignedExpenses += amountPlan;
  }
  if (!started) return out;

  const mediaLines = plan.lines.filter(isMediaLine);
  const platforms = [...new Set(mediaLines.map((l) => l.platform).filter((p): p is Platform => Boolean(p)))];
  const f = { ...parseFilters({ from: isoDay(plan.startDate), to: isoDay(asOf) }, now), platforms };
  const q = { scope: { clientId: plan.clientId }, currency: plan.currency, fx };
  const [campaignRows, platformRows, daily] = await Promise.all([byEntity(f, q, "campaign"), byPlatform(f, q), dailySeries(f, q)]);
  out.daily = daily.map((d) => ({ date: d.date, spend: d.spend }));

  const meta = new Map(
    (await db.campaign.findMany({ where: { clientId: plan.clientId, id: { in: campaignRows.map((c) => c.id) } }, select: { id: true, funnelStage: true } })).map((c) => [c.id, c.funnelStage]),
  );
  const byCampaignLine = new Map(mediaLines.filter((l) => l.campaignId).map((l) => [l.campaignId!, l]));
  const unplanned = new Map<Platform, ActualTotals>();
  const attributed = new Map<Platform, ActualTotals>();

  for (const c of campaignRows) {
    if (!c.platform) continue;
    const vals: ActualTotals = { spend: c.spend, impressions: c.impressions, reach: c.reach, clicks: c.clicks, leads: c.leads, purchases: c.purchases, revenue: c.revenue };
    add(media, vals);
    add((attributed.get(c.platform) ?? attributed.set(c.platform, zero()).get(c.platform))!, vals);
    const role = roleOfFunnel(meta.get(c.id));
    const target =
      byCampaignLine.get(c.id) ??
      mediaLines.find((l) => !l.campaignId && l.platform === c.platform && l.category === role) ??
      mediaLines.filter((l) => !l.campaignId && l.platform === c.platform).sort((a, b) => toNum(b.plannedBudget) - toNum(a.plannedBudget))[0];
    if (target) add(byLine.get(target.id)!, vals);
    else add((unplanned.get(c.platform) ?? unplanned.set(c.platform, zero()).get(c.platform))!, vals);
  }
  // Metrics without a campaign id (rare, account-level rows) → platform line or unplanned.
  for (const p of platformRows) {
    const a = attributed.get(p.platform) ?? zero();
    const rest: ActualTotals = { spend: p.spend - a.spend, impressions: p.impressions - a.impressions, reach: p.reach - a.reach, clicks: p.clicks - a.clicks, leads: p.leads - a.leads, purchases: p.purchases - a.purchases, revenue: p.revenue - a.revenue };
    if (rest.spend <= 0.5) continue;
    add(media, rest);
    const target = mediaLines.filter((l) => !l.campaignId && l.platform === p.platform).sort((x, y) => toNum(y.plannedBudget) - toNum(x.plannedBudget))[0];
    if (target) add(byLine.get(target.id)!, rest);
    else add((unplanned.get(p.platform) ?? unplanned.set(p.platform, zero()).get(p.platform))!, rest);
  }
  out.unplanned = [...unplanned.entries()].map(([platform, v]) => ({ platform, ...v })).filter((u) => u.spend > 0);
  return out;
}

export async function lastPlanSync(clientId: string) {
  const r = await db.metricDaily.aggregate({ where: { clientId }, _max: { syncedAt: true } });
  return r._max.syncedAt;
}
