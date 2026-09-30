import type { Objective } from "@prisma/client";

/**
 * Line-level budget advice and reallocation proposals ("move from the least to the most
 * efficient line"). Pure and deterministic. Proposals are only suggestions: approving one records
 * the decision and creates a task — nothing is ever pushed to an ad platform.
 */
export type ResultMetric = "revenue" | "leads" | "sales" | "clicks";

export function resultMetricFor(objective: Objective | null): ResultMetric {
  if (objective === "SALES") return "revenue";
  if (objective === "LEADS" || objective === "MESSAGES") return "leads";
  return "clicks";
}

export type LinePerf = { id: string; label: string; planned: number; actual: number; results: number; plannedResults: number };

export type AdviceReason = "lowEfficiency" | "highEfficiency" | "overPacing" | "underPacing" | "noResults" | "onTrack" | "insufficientData";
export type LineAdvice = { action: "increase" | "decrease" | "hold" | "review"; reason: AdviceReason; efficiency: number | null; avgEfficiency: number | null; pacing: number | null };
export type Proposal = { key: string; fromId: string; toId: string; fromLabel: string; toLabel: string; amount: number; fromEfficiency: number; toEfficiency: number };

const LOW = 0.8; // ≤ 80% of the plan's average efficiency
const HIGH = 1.2; // ≥ 120%

export function reallocate(lines: LinePerf[], opts: { elapsedRatio: number; maxProposals?: number }) {
  const advice = new Map<string, LineAdvice>();
  const elapsed = Math.max(0, Math.min(1, opts.elapsedRatio));
  // Lines not planned to produce this result (e.g. awareness judged on leads) are not compared.
  const eligible = lines.filter((l) => l.actual > 0 && l.actual >= l.planned * elapsed * 0.1 && (l.plannedResults > 0 || l.results > 0));
  const totActual = eligible.reduce((s, l) => s + l.actual, 0);
  const totResults = eligible.reduce((s, l) => s + l.results, 0);
  const avg = totActual > 0 && totResults > 0 ? totResults / totActual : null;

  for (const l of lines) {
    const expected = l.planned * elapsed;
    const pacing = expected > 0 ? l.actual / expected : null;
    const eff = l.actual > 0 ? l.results / l.actual : null;
    let a: LineAdvice = { action: "hold", reason: "onTrack", efficiency: eff, avgEfficiency: avg, pacing };
    if (!eligible.includes(l) || avg == null) {
      const reason: AdviceReason = pacing != null && pacing < 0.5 && elapsed > 0.2 ? "underPacing" : pacing != null && pacing > 1.15 ? "overPacing" : l.plannedResults === 0 && l.actual > 0 ? "onTrack" : "insufficientData";
      a = { ...a, action: reason === "underPacing" || reason === "overPacing" ? "review" : "hold", reason };
    }
    else if (l.results === 0) a = { ...a, action: "decrease", reason: "noResults" };
    else if (eff != null && eff <= avg * LOW) a = { ...a, action: "decrease", reason: "lowEfficiency" };
    // Fast spend on an efficient line is a reason to fund it, not to hold it back.
    else if (eff != null && eff >= avg * HIGH) a = { ...a, action: "increase", reason: "highEfficiency" };
    else if (pacing != null && pacing > 1.15) a = { ...a, action: "review", reason: "overPacing" };
    else if (pacing != null && pacing < 0.7) a = { ...a, action: "review", reason: "underPacing" };
    advice.set(l.id, a);
  }

  const donors = eligible
    .filter((l) => ["decrease"].includes(advice.get(l.id)!.action) && l.planned - l.actual > 0)
    .sort((x, y) => x.results / x.actual - y.results / y.actual);
  const receivers = eligible.filter((l) => advice.get(l.id)!.action === "increase").sort((x, y) => y.results / y.actual - x.results / x.actual);

  const proposals: Proposal[] = [];
  const max = opts.maxProposals ?? 3;
  for (let i = 0; i < Math.min(donors.length, receivers.length, max); i++) {
    const from = donors[i];
    const to = receivers[i];
    const raw = Math.min((from.planned - from.actual) * 0.25, to.planned * 0.25);
    const amount = raw >= 100 ? Math.floor(raw / 10) * 10 : Math.round(raw);
    if (amount <= 0) continue;
    proposals.push({ key: `${from.id}>${to.id}`, fromId: from.id, toId: to.id, fromLabel: from.label, toLabel: to.label, amount, fromEfficiency: from.results / from.actual, toEfficiency: to.results / to.actual });
  }
  return { advice, proposals, avgEfficiency: avg };
}

/** Linear run-rate forecast of a line's spend at period end. Labelled as an estimate. */
export function lineForecast(actual: number, elapsedDays: number, totalDays: number) {
  if (elapsedDays <= 0) return null;
  return (actual / elapsedDays) * totalDays;
}
