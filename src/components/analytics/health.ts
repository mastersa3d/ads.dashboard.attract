import type { Kpis } from "@/lib/metrics";

/** Frequency above this is flagged as audience-fatigue risk. */
export const FREQUENCY_WARNING = 3.5;

export type Health = "good" | "warning" | "bad" | "idle";
export type HealthReason = { key: "cpl" | "roas" | "freq" | "ctr" | "ok"; value?: number | null; median?: number };

/**
 * Traffic-light health for a campaign / ad set / ad row.
 *  - bad (red, needs action): CPL above the market median, or ROAS < 1 while revenue is tracked
 *  - warning (orange): frequency > 3.5, or CTR below the market median
 *  - good (green): otherwise; idle when nothing was spent in the period
 * Market medians must already be in the row's reporting currency.
 */
export function rowHealth(k: Kpis, market: { cpl?: number | null; ctr?: number | null }): { health: Health; reasons: HealthReason[] } {
  if (k.spend <= 0 && k.impressions <= 0) return { health: "idle", reasons: [] };
  const bad: HealthReason[] = [];
  const warn: HealthReason[] = [];
  if (k.cpl != null && market.cpl != null && k.cpl > market.cpl) bad.push({ key: "cpl", value: k.cpl, median: market.cpl });
  if (k.revenue > 0 && k.roas != null && k.roas < 1) bad.push({ key: "roas", value: k.roas });
  if (k.frequency != null && k.frequency > FREQUENCY_WARNING) warn.push({ key: "freq", value: k.frequency });
  if (k.ctr != null && market.ctr != null && k.impressions >= 1000 && k.ctr < market.ctr) warn.push({ key: "ctr", value: k.ctr, median: market.ctr });
  if (bad.length) return { health: "bad", reasons: [...bad, ...warn] };
  if (warn.length) return { health: "warning", reasons: warn };
  return { health: "good", reasons: [{ key: "ok" }] };
}
