import { z } from "zod";
import type { BudgetLine, BudgetPlan, Platform } from "@prisma/client";
import { COST_KEYS, SCENARIO_WEIGHTS, type CostAssumption, type CostSource, type ScenarioWeights, type Phasing } from "./allocation";

/**
 * Shape of BudgetPlan.assumptions (JSON). Everything the planner needs to explain and re-run an
 * allocation lives here: selected platforms/products/audiences/regions, per-platform cost
 * assumptions (with their origin), the snapshot of market averages and previous results used as
 * defaults, and the custom scenario weights. Older/seeded plans may hold a partial shape —
 * `readAssumptions()` is tolerant and fills gaps.
 */
export type PlanAssumptions = {
  version: 1;
  platforms: Platform[];
  products: string[];
  audiences: string[];
  regions: string[];
  campaignIds: string[];
  costs: Partial<Record<Platform, CostAssumption>>;
  costSources: Partial<Record<Platform, Partial<Record<keyof CostAssumption, CostSource>>>>;
  market: Partial<Record<Platform, Partial<CostAssumption> & { sourceName?: string }>>;
  previous: Partial<Record<Platform, { spend: number; cpm: number | null; cpc: number | null; cpl: number | null; cvr: number | null; roas: number | null }>>;
  weights: ScenarioWeights | null;
  platformShares: Partial<Record<Platform, number>> | null;
  phasing: Phasing;
  notes?: string;
};

const num = z.number().finite().nonnegative().nullable();
export const costSchema = z.object({ cpm: num, cpc: num, cpl: num, cvr: num, aov: num });

export const weightsSchema = z.object({
  production: z.number().min(0).max(1),
  testing: z.number().min(0).max(1),
  scaling: z.number().min(0).max(1),
  contingency: z.number().min(0).max(1),
  prospecting: z.number().min(0).max(1),
  retargeting: z.number().min(0).max(1),
  retention: z.number().min(0).max(1),
  efficiencyBias: z.number().min(0).max(1),
  phasing: z.enum(["flat", "rampUp", "frontLoad"]),
});

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function readAssumptions(raw: unknown): PlanAssumptions {
  const a = obj(raw);
  const costs: PlanAssumptions["costs"] = {};
  for (const [p, c] of Object.entries(obj(a.costs))) {
    const o = obj(c);
    costs[p as Platform] = Object.fromEntries(COST_KEYS.map((k) => [k, n(o[k])])) as CostAssumption;
  }
  // Legacy/seed shape: { cpm: { META: 60, ... } }
  for (const [p, v] of Object.entries(obj(a.cpm))) {
    const c = (costs[p as Platform] ??= { cpm: null, cpc: null, cpl: null, cvr: null, aov: null });
    c.cpm ??= n(v);
  }
  const w = weightsSchema.safeParse(a.weights);
  const phasing = (["flat", "rampUp", "frontLoad"] as const).find((x) => x === a.phasing) ?? (w.success ? w.data.phasing : SCENARIO_WEIGHTS.BALANCED.phasing);
  return {
    version: 1,
    platforms: strs(a.platforms) as Platform[],
    products: strs(a.products),
    audiences: strs(a.audiences),
    regions: strs(a.regions),
    campaignIds: strs(a.campaignIds),
    costs,
    costSources: obj(a.costSources) as PlanAssumptions["costSources"],
    market: obj(a.market) as PlanAssumptions["market"],
    previous: obj(a.previous) as PlanAssumptions["previous"],
    weights: w.success ? w.data : null,
    platformShares: a.platformShares ? (obj(a.platformShares) as PlanAssumptions["platformShares"]) : null,
    phasing,
    notes: typeof a.notes === "string" ? a.notes : typeof a.note === "string" ? a.note : undefined,
  };
}

/** Platforms that can carry paid media in a plan. */
export const PAID_PLATFORMS: Platform[] = ["META", "GOOGLE_ADS", "TIKTOK", "LINKEDIN", "YOUTUBE", "X"];

/** Media lines carry ad spend; the rest are reserves or non-media costs tracked through expenses. */
export const MEDIA_CATEGORIES = ["PLATFORM", "OBJECTIVE", "FUNNEL", "PROSPECTING", "RETARGETING", "RETENTION", "CAMPAIGN", "AUDIENCE"] as const;
export function isMediaLine(l: { category: string; platform: Platform | null; campaignId: string | null }) {
  return Boolean(l.campaignId || (l.platform && (MEDIA_CATEGORIES as readonly string[]).includes(l.category)));
}

export function planDays(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

/** Display label: campaign lines keep their campaign name; generated lines are translated. */
export function lineLabel(l: { category: string; platform: Platform | null; campaignId: string | null; label: string }, t: (k: string) => string) {
  if (l.category === "CAMPAIGN" || l.campaignId) return l.label;
  const cat = t(`budget.cat.${l.category}`);
  return l.platform ? `${t(`platform.${l.platform}`)} · ${cat}` : cat;
}

export type PlanWithLinesLite = BudgetPlan & { lines: BudgetLine[] };
