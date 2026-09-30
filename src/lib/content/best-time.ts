import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { zonedParts } from "./tz";

/**
 * Best Time to Post.
 *
 * 1. History (preferred): published posts of the client with organic results
 *    (resultEngagements / resultReach). Engagement rate is modelled as
 *    overall + weekday effect + 3-hour-block effect, each shrunk toward the overall mean
 *    (so a slot with two lucky posts can't win). Needs ≥ MIN_POSTS posts — first on the
 *    requested platform, else across all of the client's platforms.
 * 2. OrganicMetricDaily (page/profile daily totals) has no hour, so it only corroborates
 *    the best weekday.
 * 3. Too little data → a per-platform benchmark heuristic, always labelled
 *    "Estimated — not confirmed" with a low fixed confidence.
 *
 * The suggestion is advisory: the editor shows it next to the chosen time and users may ignore it.
 * Callers MUST pass a tenant-checked clientId.
 */

export const MIN_POSTS = 15;
const BLOCK_HOURS = 3;
const BLOCKS = 24 / BLOCK_HOURS;
const SHRINK = 3; // pseudo-observations pulling sparse slots toward the mean

export type PostSample = { publishAt: Date; reach: number | null; engagements: number | null };
export type OrganicSample = { date: Date; reach: number; engagements: number };

export type ChosenVerdict = "best" | "good" | "weak" | "unknown" | "matches" | "differs";

export type BestTimeResult = {
  method: "history" | "benchmark";
  /** history: analysed on this platform only, or on all platforms of the client */
  basis: "platform" | "client";
  platform: Platform | null;
  timezone: string;
  weekday: number;
  hour: number;
  alternatives: { weekday: number; hour: number; lift: number | null }[];
  /** relative engagement-rate lift of the best slot vs the average (history only) */
  lift: number | null;
  sampleSize: number;
  minSample: number;
  confidence: number;
  confidenceLevel: "high" | "medium" | "low";
  avgRate: number | null;
  organic: { weekday: number; lift: number; days: number } | null;
  heatmap: { weekday: number; block: number; rate: number | null; n: number }[] | null;
  blockHours: number;
  chosen: { weekday: number; hour: number; verdict: ChosenVerdict; relative: number | null } | null;
};

/** Generic industry heuristics (local time). Not client data — always shown as an estimate. */
export const PLATFORM_BENCHMARKS: Partial<Record<Platform, { days: number[]; hours: number[] }>> = {
  INSTAGRAM: { days: [2, 3, 4], hours: [11, 19] },
  FACEBOOK: { days: [3, 4], hours: [13, 20] },
  META: { days: [3, 4], hours: [13, 20] },
  TIKTOK: { days: [2, 4], hours: [19, 21] },
  LINKEDIN: { days: [2, 3, 4], hours: [9, 12] },
  X: { days: [2, 3], hours: [9, 12] },
  YOUTUBE: { days: [4, 5], hours: [15, 18] },
};
const DEFAULT_BENCHMARK = { days: [2, 3, 4], hours: [12, 19] };
const BENCHMARK_CONFIDENCE = 20;

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const level = (c: number): BestTimeResult["confidenceLevel"] => (c >= 70 ? "high" : c >= 45 ? "medium" : "low");

/** Best weekday from daily organic totals (engagements / reach). Needs 4+ weeks. */
export function organicWeekday(rows: OrganicSample[]): BestTimeResult["organic"] {
  const days = rows.filter((r) => r.reach > 0);
  if (days.length < 28) return null;
  const eng = Array(7).fill(0);
  const reach = Array(7).fill(0);
  for (const r of days) {
    const w = r.date.getUTCDay(); // @db.Date — already the local calendar day
    eng[w] += r.engagements;
    reach[w] += r.reach;
  }
  const total = eng.reduce((s, x) => s + x, 0) / reach.reduce((s, x) => s + x, 0);
  let best = -1;
  let bestRate = -Infinity;
  for (let w = 0; w < 7; w++) {
    if (!reach[w]) continue;
    const rate = eng[w] / reach[w];
    if (rate > bestRate) [best, bestRate] = [w, rate];
  }
  if (best < 0 || !total) return null;
  return { weekday: best, lift: bestRate / total - 1, days: days.length };
}

/** Pure analysis of post-level history. Returns null when there are fewer than MIN_POSTS usable posts. */
export function analyseHistory(posts: PostSample[], timeZone: string, chosen?: Date | null) {
  const pts = posts
    .filter((p) => p.reach != null && p.reach > 0 && p.engagements != null)
    .map((p) => {
      const z = zonedParts(p.publishAt, timeZone);
      return { w: z.weekday, h: z.hour, b: Math.floor(z.hour / BLOCK_HOURS), r: (p.engagements as number) / (p.reach as number) };
    });
  if (pts.length < MIN_POSTS) return null;

  const rates = pts.map((p) => p.r);
  const overall = mean(rates);
  const spread = sd(rates);
  const byW = Array.from({ length: 7 }, (_, w) => pts.filter((p) => p.w === w).map((p) => p.r));
  const byB = Array.from({ length: BLOCKS }, (_, b) => pts.filter((p) => p.b === b).map((p) => p.r));
  const shrunk = (xs: number[]) => (xs.reduce((s, x) => s + x, 0) + SHRINK * overall) / (xs.length + SHRINK);
  const effW = byW.map((xs) => shrunk(xs) - overall);
  const effB = byB.map((xs) => shrunk(xs) - overall);
  const expected = (w: number, b: number) => overall + effW[w] + effB[b];

  const slots: { w: number; b: number; v: number }[] = [];
  for (let w = 0; w < 7; w++) for (let b = 0; b < BLOCKS; b++) if (byW[w].length >= 2 && byB[b].length >= 2) slots.push({ w, b, v: expected(w, b) });
  if (!slots.length) return null;
  slots.sort((a, b) => b.v - a.v);
  const top = slots[0];

  // Most rewarding hour within the winning block
  const bestHourIn = (b: number) => {
    const hours = new Map<number, number[]>();
    for (const p of pts) if (p.b === b) hours.set(p.h, [...(hours.get(p.h) ?? []), p.r]);
    const ranked = [...hours.entries()].sort((a, c) => shrunk(c[1]) - shrunk(a[1]));
    return ranked[0]?.[0] ?? b * BLOCK_HOURS + 1;
  };

  // Confidence: sample size, separation of the winner from the mean, and consistency.
  const nW = byW[top.w].length;
  const nB = byB[top.b].length;
  const se = spread > 0 ? Math.sqrt(spread ** 2 / nW + spread ** 2 / nB) : 0;
  const z = se > 0 ? (top.v - overall) / se : 0;
  const size = clamp(pts.length / 60, 0, 1);
  const separation = clamp(z / 2.5, 0, 1);
  const consistency = overall > 0 ? 1 / (1 + spread / overall) : 0;
  const confidence = Math.round(clamp(100 * (0.4 * size + 0.4 * separation + 0.2 * consistency), 5, 95));

  const seen = new Set<string>([`${top.w}-${top.b}`]);
  const alternatives: BestTimeResult["alternatives"] = [];
  for (const s of slots.slice(1)) {
    if (alternatives.length >= 2) break;
    if (seen.has(`${s.w}-${s.b}`)) continue;
    seen.add(`${s.w}-${s.b}`);
    alternatives.push({ weekday: s.w, hour: bestHourIn(s.b), lift: overall ? s.v / overall - 1 : null });
  }

  const heatmap: NonNullable<BestTimeResult["heatmap"]> = [];
  for (let w = 0; w < 7; w++)
    for (let b = 0; b < BLOCKS; b++) {
      const n = pts.filter((p) => p.w === w && p.b === b).length;
      heatmap.push({ weekday: w, block: b, rate: byW[w].length && byB[b].length ? expected(w, b) : null, n });
    }

  let chosenOut: BestTimeResult["chosen"] = null;
  if (chosen) {
    const zc = zonedParts(chosen, timeZone);
    const cb = Math.floor(zc.hour / BLOCK_HOURS);
    if (!byW[zc.weekday].length || !byB[cb].length) chosenOut = { weekday: zc.weekday, hour: zc.hour, verdict: "unknown", relative: null };
    else {
      const rel = expected(zc.weekday, cb) / top.v;
      chosenOut = { weekday: zc.weekday, hour: zc.hour, verdict: rel >= 0.97 ? "best" : rel >= 0.85 ? "good" : "weak", relative: rel - 1 };
    }
  }

  return {
    weekday: top.w,
    hour: bestHourIn(top.b),
    alternatives,
    lift: overall ? top.v / overall - 1 : null,
    sampleSize: pts.length,
    confidence,
    confidenceLevel: level(confidence),
    avgRate: overall,
    heatmap,
    chosen: chosenOut,
  };
}

/** Benchmark fallback. Uses the account's organic weekday pattern when available. */
export function benchmarkSuggestion(platform: Platform | null, timeZone: string, organic: BestTimeResult["organic"], chosen?: Date | null) {
  const bm = (platform && PLATFORM_BENCHMARKS[platform]) || DEFAULT_BENCHMARK;
  const weekday = organic && organic.lift > 0.03 ? organic.weekday : bm.days[0];
  const hour = bm.hours[bm.hours.length - 1];
  const alternatives = [...bm.days.filter((d) => d !== weekday).map((d) => ({ weekday: d, hour: bm.hours[0], lift: null }))].slice(0, 2);
  let chosenOut: BestTimeResult["chosen"] = null;
  if (chosen) {
    const z = zonedParts(chosen, timeZone);
    const dayOk = bm.days.includes(z.weekday) || z.weekday === weekday;
    const hourOk = bm.hours.some((h) => Math.abs(h - z.hour) <= 1);
    chosenOut = { weekday: z.weekday, hour: z.hour, verdict: dayOk && hourOk ? "matches" : "differs", relative: null };
  }
  return { weekday, hour, alternatives, chosen: chosenOut };
}

/** Load data for one client (and optionally one platform) and produce a suggestion. */
export async function bestTimeFor(opts: { clientId: string; platform?: Platform | null; timezone: string; chosen?: Date | null; now?: Date }): Promise<BestTimeResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 365 * 86400000);
  const organicSince = new Date(now.getTime() - 180 * 86400000);
  const platform = opts.platform ?? null;

  const base = { clientId: opts.clientId, status: "PUBLISHED" as const, publishAt: { gte: since, lte: now }, resultReach: { gt: 0 } };
  const select = { publishAt: true, resultReach: true, resultEngagements: true } as const;
  const [platformPosts, organicRows] = await Promise.all([
    db.contentItem.findMany({ where: platform ? { ...base, platform } : base, select, take: 2000, orderBy: { publishAt: "desc" } }),
    db.organicMetricDaily.findMany({
      where: { clientId: opts.clientId, date: { gte: organicSince }, ...(platform ? { platform } : {}) },
      select: { date: true, reach: true, engagements: true },
    }),
  ]);
  const toSamples = (rows: typeof platformPosts): PostSample[] => rows.map((r) => ({ publishAt: r.publishAt as Date, reach: r.resultReach, engagements: r.resultEngagements }));

  let basis: BestTimeResult["basis"] = platform ? "platform" : "client";
  let hist = analyseHistory(toSamples(platformPosts), opts.timezone, opts.chosen);
  let sampleSize = platformPosts.length;
  if (!hist && platform) {
    const all = await db.contentItem.findMany({ where: base, select, take: 2000, orderBy: { publishAt: "desc" } });
    hist = analyseHistory(toSamples(all), opts.timezone, opts.chosen);
    basis = "client";
    sampleSize = all.length;
  }

  // Aggregate organic rows by day (several accounts can share a day).
  const byDay = new Map<number, OrganicSample>();
  for (const r of organicRows) {
    const k = r.date.getTime();
    const cur = byDay.get(k) ?? { date: r.date, reach: 0, engagements: 0 };
    cur.reach += r.reach;
    cur.engagements += r.engagements;
    byDay.set(k, cur);
  }
  const organic = organicWeekday([...byDay.values()]);

  if (hist) {
    return { method: "history", basis, platform, timezone: opts.timezone, organic, minSample: MIN_POSTS, blockHours: BLOCK_HOURS, ...hist };
  }
  const bm = benchmarkSuggestion(platform, opts.timezone, organic, opts.chosen);
  return {
    method: "benchmark",
    basis,
    platform,
    timezone: opts.timezone,
    ...bm,
    lift: null,
    sampleSize,
    minSample: MIN_POSTS,
    confidence: BENCHMARK_CONFIDENCE,
    confidenceLevel: "low",
    avgRate: null,
    organic,
    heatmap: null,
    blockHours: BLOCK_HOURS,
  };
}
