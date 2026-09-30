/**
 * Benchmark Center model — pure functions shared by the page, the campaigns drill-down and the
 * server actions. No I/O here.
 */

export const BENCHMARK_METRICS = ["CPM", "CPC", "CTR", "CPL", "CPA", "CPP", "CVR", "ROAS", "ER", "VCR", "FREQ", "REACH_EFF", "FOLLOWER_GROWTH"] as const;
export type BenchmarkMetric = (typeof BENCHMARK_METRICS)[number];

/**
 * money      — amount in currency (stored in the organization's currency, converted for display)
 * perMoney   — "per 1,000 currency units" (reach efficiency): converted inversely
 * pct        — ratio stored 0..1, entered/displayed as %
 * ratio      — plain multiple (ROAS, frequency)
 */
export type MetricUnit = "money" | "perMoney" | "pct" | "ratio";

export const METRIC_DEFS: Record<BenchmarkMetric, { unit: MetricUnit; higherIsBetter: boolean }> = {
  CPM: { unit: "money", higherIsBetter: false },
  CPC: { unit: "money", higherIsBetter: false },
  CTR: { unit: "pct", higherIsBetter: true },
  CPL: { unit: "money", higherIsBetter: false },
  CPA: { unit: "money", higherIsBetter: false },
  CPP: { unit: "money", higherIsBetter: false },
  CVR: { unit: "pct", higherIsBetter: true },
  ROAS: { unit: "ratio", higherIsBetter: true },
  ER: { unit: "pct", higherIsBetter: true },
  VCR: { unit: "pct", higherIsBetter: true },
  FREQ: { unit: "ratio", higherIsBetter: false },
  REACH_EFF: { unit: "perMoney", higherIsBetter: true },
  FOLLOWER_GROWTH: { unit: "pct", higherIsBetter: true },
};

export function isBenchmarkMetric(v: unknown): v is BenchmarkMetric {
  return BENCHMARK_METRICS.includes(v as BenchmarkMetric);
}

export type BenchmarkLike = {
  id: string;
  organizationId: string | null;
  metric: string;
  platform: string | null;
  country: string | null;
  industry: string | null;
  businessSize: string | null;
  productType: string | null;
  isB2B: boolean | null;
  objective: string | null;
  audienceType: string | null;
  periodLabel: string | null;
  p25: number | null;
  median: number;
  p75: number | null;
  higherIsBetter: boolean;
  isManual: boolean;
  asOf: Date;
};

export type BenchmarkCriteria = {
  platform?: string | null;
  country?: string | null;
  industry?: string | null;
  businessSize?: string | null;
  productType?: string | null;
  isB2B?: boolean | null;
  objective?: string | null;
  audienceType?: string | null;
  periodLabel?: string | null;
};

const CRITERIA_FIELDS: (keyof BenchmarkCriteria)[] = ["platform", "country", "industry", "businessSize", "productType", "isB2B", "objective", "audienceType", "periodLabel"];

/**
 * Most relevant benchmark for a metric.
 *  - A set criterion must match exactly, or the benchmark must be generic (null) for that field.
 *  - A benchmark that is specific to something the user did NOT select (e.g. another industry)
 *    is only used when the criterion is left open ("any").
 *  - Ranking: exact matches on selected criteria, then the organization's own benchmarks, then
 *    fewer unrequested specifics, then recency.
 */
export function pickBenchmark<B extends BenchmarkLike>(rows: B[], metric: string, c: BenchmarkCriteria): B | null {
  let best: { row: B; score: number } | null = null;
  for (const b of rows) {
    if (b.metric !== metric) continue;
    let score = 0;
    let ok = true;
    for (const k of CRITERIA_FIELDS) {
      const want = c[k];
      const have = b[k as keyof BenchmarkLike] as string | boolean | null;
      if (want != null && want !== "") {
        if (have == null) continue;
        if (have !== want) {
          ok = false;
          break;
        }
        score += 10;
      } else if (have != null) score -= 1;
    }
    if (!ok) continue;
    if (b.organizationId) score += 5;
    score += b.asOf.getTime() / 1e13; // tie-break: newer wins
    if (!best || score > best.score) best = { row: b, score };
  }
  return best?.row ?? null;
}

/** Convert a stored benchmark value into the display currency (factor = display units per stored unit). */
export function convertBenchmarkValue(v: number | null, unit: MetricUnit, factor: number): number | null {
  if (v == null) return null;
  if (unit === "money") return v * factor;
  if (unit === "perMoney") return factor ? v / factor : v;
  return v;
}

/**
 * Estimated percentile of `value` in the market distribution, by linear interpolation between
 * P25 / median / P75 and linear extrapolation beyond (clamped to 1..99). Returned as a
 * performance rank: for "lower is better" metrics a low cost ranks high.
 * Null when quartiles are missing — we never invent a spread.
 */
export function estimatePercentile(value: number | null, b: { p25: number | null; median: number; p75: number | null; higherIsBetter: boolean }): number | null {
  if (value == null || b.p25 == null || b.p75 == null || !(b.p25 < b.median && b.median < b.p75)) return null;
  let raw: number;
  if (value <= b.median) raw = 50 - ((b.median - value) / (b.median - b.p25)) * 25;
  else raw = 50 + ((value - b.median) / (b.p75 - b.median)) * 25;
  raw = Math.max(1, Math.min(99, raw));
  return Math.round(b.higherIsBetter ? raw : 100 - raw);
}

export type Rating = "good" | "average" | "bad" | "none";

/** Good ≥ 60th performance percentile, needs attention < 40th; ±10% of median when no quartiles. */
export function rateAgainst(value: number | null, b: { p25: number | null; median: number; p75: number | null; higherIsBetter: boolean }): Rating {
  if (value == null) return "none";
  const pct = estimatePercentile(value, b);
  if (pct != null) return pct >= 60 ? "good" : pct < 40 ? "bad" : "average";
  if (!b.median) return "none";
  const rel = (value - b.median) / Math.abs(b.median);
  const better = b.higherIsBetter ? rel : -rel;
  return better > 0.1 ? "good" : better < -0.1 ? "bad" : "average";
}
