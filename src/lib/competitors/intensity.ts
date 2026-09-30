/**
 * Competitor ad analytics that never pretend to know spend.
 *
 * Official spend ranges exist only when the ad library discloses them (e.g. EU / political ads).
 * Everywhere else we show an "Estimated Advertising Intensity" — a 0–100 index of how hard a
 * competitor is pushing ads, computed purely from observable ad-library facts. It is an index,
 * never money, and the UI always labels it as an estimate with the formula below.
 */

export const NEW_AD_DAYS = 14;
export const LONG_RUNNING_DAYS = 30;
const DAY = 86_400_000;

export type AdFacts = {
  firstSeen: Date;
  lastSeen: Date;
  isActive: boolean;
  variantCount: number;
  relaunched: boolean;
};

export type AdStatus = "NEW" | "ACTIVE" | "STOPPED";

function utcDay(d: Date) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Inclusive number of days the ad has been (or was) running. */
export function runningDays(ad: Pick<AdFacts, "firstSeen" | "lastSeen" | "isActive">, now = new Date()) {
  const end = ad.isActive ? now : ad.lastSeen;
  return Math.max(1, Math.round((utcDay(end) - utcDay(ad.firstSeen)) / DAY) + 1);
}

export function isNewAd(ad: Pick<AdFacts, "firstSeen">, now = new Date()) {
  return (utcDay(now) - utcDay(ad.firstSeen)) / DAY <= NEW_AD_DAYS;
}

export function adStatus(ad: AdFacts, now = new Date()): AdStatus {
  if (!ad.isActive) return "STOPPED";
  return isNewAd(ad, now) ? "NEW" : "ACTIVE";
}

export function isLongRunning(ad: AdFacts, now = new Date()) {
  return runningDays(ad, now) >= LONG_RUNNING_DAYS;
}

/** Weights (sum = 100) and saturation caps. Shown verbatim in the UI tooltip. */
export const INTENSITY_WEIGHTS = { active: 25, duration: 20, variants: 20, relaunch: 15, recency: 20 } as const;
export const INTENSITY_CAPS = { active: 10, durationDays: 60, variants: 30, recentNew: 5 } as const;

export type Intensity = {
  score: number; // 0..100
  level: "LOW" | "MEDIUM" | "HIGH";
  parts: Record<keyof typeof INTENSITY_WEIGHTS, number>;
  inputs: { active: number; avgRunningDays: number; activeVariants: number; relaunchShare: number; newAds: number; total: number };
};

/**
 * Estimated Advertising Intensity (0–100):
 *   25 × min(active ads / 10, 1)
 * + 20 × min(avg running days of active ads / 60, 1)
 * + 20 × min(variants across active ads / 30, 1)
 * + 15 × (relaunched ads / all observed ads)
 * + 20 × min(ads first seen in the last 14 days / 5, 1)
 * Returns null when no ads were observed (we never show a score without evidence).
 */
export function advertisingIntensity(ads: AdFacts[], now = new Date()): Intensity | null {
  if (!ads.length) return null;
  const active = ads.filter((a) => a.isActive);
  const avgRunningDays = active.length ? active.reduce((s, a) => s + runningDays(a, now), 0) / active.length : 0;
  const activeVariants = active.reduce((s, a) => s + Math.max(1, a.variantCount), 0);
  const relaunchShare = ads.filter((a) => a.relaunched).length / ads.length;
  const newAds = ads.filter((a) => isNewAd(a, now)).length;
  const W = INTENSITY_WEIGHTS;
  const C = INTENSITY_CAPS;
  const parts = {
    active: W.active * Math.min(active.length / C.active, 1),
    duration: W.duration * Math.min(avgRunningDays / C.durationDays, 1),
    variants: W.variants * Math.min(activeVariants / C.variants, 1),
    relaunch: W.relaunch * relaunchShare,
    recency: W.recency * Math.min(newAds / C.recentNew, 1),
  };
  const score = Math.round(Object.values(parts).reduce((s, v) => s + v, 0));
  return {
    score,
    level: score >= 67 ? "HIGH" : score >= 34 ? "MEDIUM" : "LOW",
    parts,
    inputs: { active: active.length, avgRunningDays, activeVariants, relaunchShare, newAds, total: ads.length },
  };
}

/** Most frequent non-empty values (case-insensitive), e.g. the recurring message/offer of a competitor. */
export function topValues(values: (string | null | undefined)[], limit = 3) {
  const counts = new Map<string, { label: string; n: number }>();
  for (const v of values) {
    const s = v?.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    const cur = counts.get(k);
    if (cur) cur.n++;
    else counts.set(k, { label: s, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit);
}
