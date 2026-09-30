/**
 * Plan-vs-actual driver analysis. Results decompose as
 *   impressions = spend / CPM × 1000,  clicks = impressions × CTR,  conversions = clicks × CVR
 * so comparing actual CPM / CTR / CVR (and AOV for revenue) with the plan's implied assumptions
 * explains *why* results deviate, and each driver maps to a corrective action. Pure function;
 * returned keys resolve under the "budget" i18n namespace.
 */
export type PlanTotals = { spend: number; impressions: number; reach: number; clicks: number; leads: number; sales: number; revenue: number };

export type DriverKey = "cpm" | "ctr" | "cvr" | "aov";
export type Driver = { key: DriverKey; planned: number | null; actual: number | null; delta: number | null; tone: "good" | "bad" | "neutral"; higherIsBetter: boolean };
export type Insight = { key: string; vars?: Record<string, string | number>; tone: "good" | "bad" | "warning" | "info" };

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function impliedRates(t: PlanTotals) {
  const conv = t.leads + t.sales;
  return {
    cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null,
    ctr: ratio(t.clicks, t.impressions),
    cvr: ratio(conv, t.clicks),
    aov: ratio(t.revenue, t.sales),
  };
}

export function driverAnalysis(planned: PlanTotals, actual: PlanTotals, fmtPct: (n: number) => string) {
  const p = impliedRates(planned);
  const a = impliedRates(actual);
  const defs: [DriverKey, boolean][] = [
    ["cpm", false],
    ["ctr", true],
    ["cvr", true],
    ["aov", true],
  ];
  const drivers: Driver[] = defs.map(([key, hib]) => {
    const pv = p[key];
    const av = a[key];
    const d = pv != null && av != null && pv > 0 ? (av - pv) / pv : null;
    const tone = d == null || Math.abs(d) < 0.05 ? "neutral" : d > 0 === hib ? "good" : "bad";
    return { key, planned: pv, actual: av, delta: d, tone, higherIsBetter: hib };
  });

  const reasons: Insight[] = [];
  const actions: Insight[] = [];
  const spendVar = planned.spend > 0 ? (actual.spend - planned.spend) / planned.spend : null;
  if (spendVar != null && spendVar < -0.1) {
    reasons.push({ key: "budget.pva.reason.underspend", vars: { pct: fmtPct(-spendVar) }, tone: "warning" });
    actions.push({ key: "budget.pva.action.underspend", tone: "info" });
  } else if (spendVar != null && spendVar > 0.1) {
    reasons.push({ key: "budget.pva.reason.overspend", vars: { pct: fmtPct(spendVar) }, tone: "bad" });
    actions.push({ key: "budget.pva.action.overspend", tone: "info" });
  }
  for (const d of drivers.filter((x) => x.delta != null && Math.abs(x.delta) >= 0.1).sort((x, y) => Math.abs(y.delta!) - Math.abs(x.delta!))) {
    const up = d.delta! > 0;
    reasons.push({ key: `budget.pva.reason.${d.key}${up ? "Up" : "Down"}`, vars: { pct: fmtPct(Math.abs(d.delta!)) }, tone: d.tone === "good" ? "good" : "bad" });
    if (d.tone === "bad") actions.push({ key: `budget.pva.action.${d.key}`, tone: "info" });
  }
  if (!reasons.length && planned.spend > 0) reasons.push({ key: "budget.pva.reason.onPlan", tone: "good" });
  return { drivers, reasons, actions, planned: p, actual: a };
}
