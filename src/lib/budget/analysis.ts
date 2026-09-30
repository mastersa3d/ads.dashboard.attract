import "server-only";
import type { Objective } from "@prisma/client";
import { db } from "@/lib/db";
import { toNum } from "@/lib/format";
import type { FxTable } from "@/lib/fx";
import { forecastSpend, variance, varianceTone } from "@/lib/metrics";
import { dailyPlan } from "./allocation";
import { planActuals, type ActualTotals, type PlanWithLines } from "./actuals";
import { isMediaLine, readAssumptions } from "./plan";
import { lineForecast, reallocate, resultMetricFor, type LineAdvice, type ResultMetric } from "./reallocation";

export type LineRow = {
  id: string;
  line: PlanWithLines["lines"][number];
  media: boolean;
  planned: number;
  actual: number;
  expenses: number;
  variance: number;
  variancePct: number | null;
  /** Tone of spend vs the budget expected by today (pro-rated), not the full-period budget. */
  tone: "good" | "warning" | "bad" | "neutral";
  expectedByNow: number;
  plannedResult: number;
  plannedResultByNow: number;
  actualResult: number;
  forecast: number | null;
  advice: LineAdvice | null;
};

function planMetric(objective: Objective | null, lines: PlanWithLines["lines"]): ResultMetric {
  if (objective) return resultMetricFor(objective);
  if (lines.some((l) => toNum(l.plannedRevenue) > 0)) return "revenue";
  if (lines.some((l) => l.plannedLeads > 0)) return "leads";
  return "clicks";
}

const plannedOf = (l: PlanWithLines["lines"][number], m: ResultMetric) => (m === "revenue" ? toNum(l.plannedRevenue) : m === "leads" ? l.plannedLeads : m === "sales" ? l.plannedSales : l.plannedClicks);
const actualOf = (a: ActualTotals, m: ResultMetric) => (m === "revenue" ? a.revenue : m === "leads" ? a.leads : m === "sales" ? a.purchases : a.clicks);

/**
 * Full plan-vs-actual analysis for one plan in its own currency: per-line variance, forecasts,
 * advice, reallocation proposals (minus those already decided), pacing inputs and totals.
 */
export async function analyzePlan(plan: PlanWithLines, fx: FxTable, now = new Date()) {
  const a = readAssumptions(plan.assumptions);
  const act = await planActuals(plan, fx, now);
  // Objective metric first; if it has no actuals yet but leads do, judge lines on leads instead.
  let metric = planMetric(plan.objective, plan.lines);
  const sumActual = (m: ResultMetric) => [...act.byLine.values()].reduce((s, x) => s + actualOf(x, m), 0);
  if (act.elapsedDays > 0 && metric !== "leads" && sumActual(metric) === 0 && sumActual("leads") > 0) metric = "leads";
  const ratio = act.elapsedDays / act.totalDays;
  const total = toNum(plan.totalBudget);

  const rows: LineRow[] = plan.lines.map((l) => {
    const x = act.byLine.get(l.id)!;
    const planned = toNum(l.plannedBudget);
    const media = isMediaLine(l);
    const expectedByNow = planned * ratio;
    const v = variance(expectedByNow, x.spend);
    return {
      id: l.id,
      line: l,
      media,
      planned,
      actual: x.spend,
      expenses: x.expenses,
      variance: x.spend - planned,
      variancePct: planned ? (x.spend - planned) / planned : null,
      tone: act.started && expectedByNow > 0 ? (Math.abs(v.pct ?? 0) <= 0.08 ? "good" : varianceTone(v.pct, "cost") === "good" ? "warning" : varianceTone(v.pct, "cost")) : "neutral",
      expectedByNow,
      plannedResult: plannedOf(l, metric),
      plannedResultByNow: plannedOf(l, metric) * ratio,
      actualResult: actualOf(x, metric),
      forecast: media ? lineForecast(x.spend, act.elapsedDays, act.totalDays) : null,
      advice: null,
    };
  });

  const mediaRows = rows.filter((r) => r.media);
  const { advice, proposals, avgEfficiency } = reallocate(
    mediaRows.map((r) => ({ id: r.id, label: r.line.label, planned: r.planned, actual: r.actual, results: r.actualResult, plannedResults: r.plannedResult })),
    { elapsedRatio: ratio },
  );
  for (const r of mediaRows) r.advice = advice.get(r.id) ?? null;

  const decided = await db.aiRecommendation.findMany({
    where: { clientId: plan.clientId, area: "budget.reallocation", state: { in: ["ACCEPTED", "REJECTED"] }, body: { path: ["planId"], equals: plan.id } },
    orderBy: { decidedAt: "desc" },
    take: 20,
  });
  const decidedKeys = new Set(decided.map((d) => (d.body as { key?: string }).key));

  const mediaPlanned = mediaRows.reduce((s, r) => s + r.planned, 0);
  const planned = dailyPlan(plan.startDate, plan.endDate, mediaPlanned, a.phasing);
  const fc = forecastSpend({ dailySpend: act.daily, budget: mediaPlanned, periodStart: plan.startDate, periodEnd: plan.endDate, asOf: act.asOf });
  // forecastSpend assumes linear expectation; re-base "expected by now" on the plan's phasing curve.
  const expectedByNow = planned.filter((d) => d.date <= act.asOf).reduce((s, d) => s + d.amount, 0);
  const pacing = act.started && expectedByNow > 0 ? fc.spent / expectedByNow : null;

  const spentTotal = act.media.spend + act.expensesTotal;
  return {
    assumptions: a,
    actuals: act,
    metric,
    rows,
    proposals: proposals.filter((p) => !decidedKeys.has(p.key)),
    decided,
    avgEfficiency,
    total,
    mediaPlanned,
    plannedDaily: planned,
    forecast: { ...fc, expectedByNow, pacing },
    spentTotal,
    remaining: total - spentTotal,
    utilization: total > 0 ? spentTotal / total : null,
    projectedTotal: fc.projected + act.expensesTotal,
  };
}
