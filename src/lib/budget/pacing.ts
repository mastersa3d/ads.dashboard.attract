import { isoDay } from "@/lib/format";

export type Grain = "daily" | "weekly" | "monthly";
export type PacingRow = { date: string; planned: number; actual: number | null; cumPlanned: number; cumActual: number | null };

/**
 * Planned vs actual spend bucketed by day / week / month, with cumulative lines.
 * Buckets after `asOf` have no actual (null) so charts don't draw a false drop to zero.
 */
export function pacingSeries(planned: { date: Date; amount: number }[], actual: { date: Date; spend: number }[], grain: Grain, asOf: Date): PacingRow[] {
  const actualByDay = new Map(actual.map((a) => [isoDay(a.date), a.spend]));
  const start = planned[0]?.date;
  const bucketOf = (d: Date) => {
    if (grain === "daily" || !start) return isoDay(d);
    if (grain === "monthly") return isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    const idx = Math.floor((d.getTime() - start.getTime()) / (7 * 86400000));
    return isoDay(new Date(start.getTime() + idx * 7 * 86400000));
  };
  const rows = new Map<string, { planned: number; actual: number; hasActual: boolean }>();
  for (const p of planned) {
    const k = bucketOf(p.date);
    const r = rows.get(k) ?? { planned: 0, actual: 0, hasActual: false };
    r.planned += p.amount;
    if (p.date <= asOf) {
      r.actual += actualByDay.get(isoDay(p.date)) ?? 0;
      r.hasActual = true;
    }
    rows.set(k, r);
  }
  let cp = 0;
  let ca = 0;
  return [...rows.entries()].map(([date, r]) => {
    cp += r.planned;
    if (r.hasActual) ca += r.actual;
    return { date, planned: round(r.planned), actual: r.hasActual ? round(r.actual) : null, cumPlanned: round(cp), cumActual: r.hasActual ? round(ca) : null };
  });
}

export type PacingAlert = { tone: "bad" | "warning" | "good" | "info"; key: string; vars?: Record<string, string | number> };

/** Human-facing pacing alerts. Keys resolve under the "budget" i18n namespace. */
export function pacingAlerts(opts: { pacing: number | null; projected: number; budget: number; depletionDate: Date | null; periodEnd: Date; started: boolean; fmtPct: (n: number) => string; fmtMoney: (n: number) => string; fmtDate: (d: Date) => string }): PacingAlert[] {
  const out: PacingAlert[] = [];
  if (!opts.started) return [{ tone: "info", key: "budget.alert.notStarted" }];
  if (opts.budget <= 0) return out;
  if (opts.pacing != null) {
    if (opts.pacing > 1.1) out.push({ tone: "bad", key: "budget.alert.overPacing", vars: { pct: opts.fmtPct(opts.pacing - 1) } });
    else if (opts.pacing < 0.85) out.push({ tone: "warning", key: "budget.alert.underPacing", vars: { pct: opts.fmtPct(1 - opts.pacing) } });
    else out.push({ tone: "good", key: "budget.alert.onPace" });
  }
  if (opts.depletionDate && opts.depletionDate < opts.periodEnd) out.push({ tone: "bad", key: "budget.alert.depletion", vars: { date: opts.fmtDate(opts.depletionDate) } });
  const over = opts.projected - opts.budget;
  if (over > opts.budget * 0.05) out.push({ tone: "bad", key: "budget.alert.projectedOver", vars: { amount: opts.fmtMoney(over) } });
  else if (-over > opts.budget * 0.1) out.push({ tone: "warning", key: "budget.alert.projectedUnder", vars: { amount: opts.fmtMoney(-over) } });
  return out;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
