import { toNum } from "@/lib/format";

/** Raw additive totals. Everything else is derived so ratios are never averaged incorrectly. */
export type Totals = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  purchases: number;
  revenue: number;
  videoViews: number;
  videoCompletions: number;
  engagements: number;
};

export const EMPTY_TOTALS: Totals = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  leads: 0,
  purchases: 0,
  revenue: 0,
  videoViews: 0,
  videoCompletions: 0,
  engagements: 0,
};

export const SUM_FIELDS = {
  spend: true,
  impressions: true,
  reach: true,
  clicks: true,
  leads: true,
  purchases: true,
  revenue: true,
  videoViews: true,
  videoCompletions: true,
  engagements: true,
} as const;

export function totalsFromSum(sum: Partial<Record<keyof Totals, unknown>> | null | undefined): Totals {
  const t = { ...EMPTY_TOTALS };
  if (!sum) return t;
  for (const k of Object.keys(t) as (keyof Totals)[]) t[k] = toNum(sum[k]);
  return t;
}

export function addTotals(a: Totals, b: Totals): Totals {
  const t = { ...a };
  for (const k of Object.keys(t) as (keyof Totals)[]) t[k] += b[k];
  return t;
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export type Kpis = Totals & {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpl: number | null;
  cpa: number | null; // cost per purchase
  roas: number | null;
  roi: number | null;
  cvr: number | null; // conversions / clicks
  frequency: number | null;
  engagementRate: number | null;
  vcr: number | null; // video completion rate
  conversions: number;
};

export function deriveKpis(t: Totals): Kpis {
  const conversions = t.leads + t.purchases;
  return {
    ...t,
    conversions,
    ctr: div(t.clicks, t.impressions),
    cpc: div(t.spend, t.clicks),
    cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null,
    cpl: div(t.spend, t.leads),
    cpa: div(t.spend, t.purchases),
    roas: div(t.revenue, t.spend),
    roi: t.spend > 0 ? (t.revenue - t.spend) / t.spend : null,
    cvr: div(conversions, t.clicks),
    frequency: div(t.impressions, t.reach),
    engagementRate: div(t.engagements, t.impressions),
    vcr: div(t.videoCompletions, t.videoViews),
  };
}

export type KpiKey = keyof Kpis;

/** For cost metrics a decrease is good. */
export const LOWER_IS_BETTER: KpiKey[] = ["cpc", "cpm", "cpl", "cpa", "frequency"];

export function delta(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** good | bad | neutral given the metric direction. Threshold avoids flapping on noise. */
export function trendTone(key: KpiKey, d: number | null, threshold = 0.03): "good" | "bad" | "neutral" {
  if (d == null || Math.abs(d) < threshold) return "neutral";
  const up = d > 0;
  const lowerBetter = LOWER_IS_BETTER.includes(key);
  return up !== lowerBetter ? "good" : "bad";
}

/**
 * Month-end spend forecast using the average daily run-rate of the last `window` days.
 * Returns the projected total and the date the budget is expected to run out (if any).
 */
export function forecastSpend(opts: {
  dailySpend: { date: Date; spend: number }[];
  budget: number;
  periodStart: Date;
  periodEnd: Date;
  asOf: Date;
  window?: number;
}) {
  const { dailySpend, budget, periodStart, periodEnd, asOf } = opts;
  const window = opts.window ?? 7;
  const inPeriod = dailySpend.filter((d) => d.date >= periodStart && d.date <= asOf);
  const spent = inPeriod.reduce((s, d) => s + d.spend, 0);
  const recent = inPeriod.slice(-window);
  const runRate = recent.length ? recent.reduce((s, d) => s + d.spend, 0) / recent.length : 0;
  const remainingDays = Math.max(0, Math.round((periodEnd.getTime() - asOf.getTime()) / 86400000));
  const projected = spent + runRate * remainingDays;
  const totalDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;
  const elapsedDays = Math.min(totalDays, Math.round((asOf.getTime() - periodStart.getTime()) / 86400000) + 1);
  const expectedByNow = budget * (elapsedDays / totalDays);
  const pacing = expectedByNow > 0 ? spent / expectedByNow : null; // 1 = on pace
  let depletionDate: Date | null = null;
  if (runRate > 0 && budget > spent) {
    const daysLeft = Math.floor((budget - spent) / runRate);
    depletionDate = new Date(asOf.getTime() + daysLeft * 86400000);
    if (depletionDate > periodEnd) depletionDate = null;
  } else if (budget > 0 && spent >= budget) {
    depletionDate = asOf;
  }
  return { spent, runRate, projected, remainingDays, expectedByNow, pacing, depletionDate, utilization: budget > 0 ? spent / budget : null };
}

export function variance(planned: number, actual: number) {
  return { amount: actual - planned, pct: planned ? (actual - planned) / planned : null };
}

/** Status colour for plan-vs-actual. For costs "over plan" is bad; for results "under plan" is bad. */
export function varianceTone(pct: number | null, kind: "cost" | "result"): "good" | "warning" | "bad" | "neutral" {
  if (pct == null) return "neutral";
  const bad = kind === "cost" ? pct : -pct;
  if (bad > 0.2) return "bad";
  if (bad > 0.08) return "warning";
  return "good";
}
