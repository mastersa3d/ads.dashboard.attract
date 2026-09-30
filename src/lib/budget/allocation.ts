import type { BudgetLineCategory, BudgetScenario, FunnelStage, Objective, Platform } from "@prisma/client";

/**
 * Media budget allocation engine — pure and deterministic so the plan form can preview it in the
 * browser and the server action can recompute it (the client preview is never trusted).
 *
 * Budget flows top-down:
 *   total → reserves (production / testing / scaling / contingency) → working media
 *   working media → platforms (blend of even split and historical efficiency)
 *   platform → audience role (prospecting / retargeting / retention)
 *   role → linked campaigns (by their historical spend share) or an unlinked role line
 *
 * Only that leaf partition is persisted as BudgetLine rows so line totals never double count.
 * The other breakdowns (objective, funnel stage, audience, weekly phasing) are derived views.
 * Every planned result is an ESTIMATE computed from the cost assumptions below.
 */

export type AudienceRole = "PROSPECTING" | "RETARGETING" | "RETENTION";
export const ROLES: AudienceRole[] = ["PROSPECTING", "RETARGETING", "RETENTION"];
export type Phasing = "flat" | "rampUp" | "frontLoad";
export type CostKey = "cpm" | "cpc" | "cpl" | "cvr" | "aov";
export const COST_KEYS: CostKey[] = ["cpm", "cpc", "cpl", "cvr", "aov"];

/** Expected unit costs for one platform, in the plan currency. null = unknown. */
export type CostAssumption = Record<CostKey, number | null>;
export type CostSource = "history" | "benchmark" | "manual";

export type ScenarioWeights = {
  /** Shares of the total budget held outside working media (0..1). */
  production: number;
  testing: number;
  scaling: number;
  contingency: number;
  /** Split of working media per platform across audience roles (sums to 1). */
  prospecting: number;
  retargeting: number;
  retention: number;
  /** 0 = split media evenly across platforms, 1 = purely by historical efficiency. */
  efficiencyBias: number;
  phasing: Phasing;
};

/**
 * Scenario presets. Rationale (shown in the UI):
 *  - Conservative protects the downside: bigger contingency, more retargeting/retention of warm
 *    audiences, leans on proven platforms, ramps spend up as results confirm.
 *  - Balanced: standard agency split with moderate testing and scaling reserves.
 *  - Aggressive buys growth: more prospecting, larger testing and scaling pools, explores
 *    platforms beyond the historical winner and front-loads spend to exit learning faster.
 */
export const SCENARIO_WEIGHTS: Record<Exclude<BudgetScenario, "CUSTOM">, ScenarioWeights> = {
  CONSERVATIVE: { production: 0.08, testing: 0.05, scaling: 0, contingency: 0.1, prospecting: 0.45, retargeting: 0.35, retention: 0.2, efficiencyBias: 0.7, phasing: "rampUp" },
  BALANCED: { production: 0.06, testing: 0.08, scaling: 0.05, contingency: 0.05, prospecting: 0.55, retargeting: 0.3, retention: 0.15, efficiencyBias: 0.5, phasing: "flat" },
  AGGRESSIVE: { production: 0.05, testing: 0.12, scaling: 0.1, contingency: 0.03, prospecting: 0.65, retargeting: 0.25, retention: 0.1, efficiencyBias: 0.3, phasing: "frontLoad" },
};

/**
 * Role multipliers applied to a platform's base (prospecting) costs. Warm audiences cost more per
 * impression but convert better. Industry rules of thumb — labelled as assumptions in the UI.
 */
export const ROLE_FACTORS: Record<AudienceRole, { cpm: number; cvr: number }> = {
  PROSPECTING: { cpm: 1, cvr: 1 },
  RETARGETING: { cpm: 1.3, cvr: 2 },
  RETENTION: { cpm: 1.2, cvr: 2.5 },
};

/** Default frequency used to estimate reach from impressions when no history exists. */
export const DEFAULT_FREQUENCY = 2;

export type HistoryKpis = { spend: number; impressions: number; clicks: number; leads: number; purchases: number; revenue: number; reach: number };

export type CampaignInput = { id: string; name: string; platform: Platform; objective: Objective; funnelStage: FunnelStage | null; historySpend: number };

export type AllocationInput = {
  total: number;
  platforms: Platform[];
  objective: Objective | null;
  scenario: BudgetScenario;
  /** Required when scenario = CUSTOM; ignored otherwise. */
  customWeights?: ScenarioWeights | null;
  /** Optional manual platform shares (CUSTOM only), e.g. { META: 0.6, TIKTOK: 0.4 }. */
  platformShares?: Partial<Record<Platform, number>> | null;
  costs: Partial<Record<Platform, CostAssumption>>;
  history: Partial<Record<Platform, HistoryKpis>>;
  campaigns: CampaignInput[];
  audiences: string[];
  startDate: Date;
  endDate: Date;
};

export type PlannedResults = { impressions: number; reach: number; clicks: number; leads: number; sales: number; revenue: number };

export type PlannedLine = PlannedResults & {
  key: string;
  category: BudgetLineCategory;
  label: string;
  platform: Platform | null;
  campaignId: string | null;
  funnelStage: FunnelStage | null;
  role: AudienceRole | null;
  objective: Objective | null;
  budget: number;
  /** True when a cost assumption needed for the estimate is missing. */
  incomplete: boolean;
};

export type PlatformShare = { platform: Platform; share: number; amount: number; basis: "even" | "efficiency" | "manual"; efficiency: number | null };

export type Allocation = {
  weights: ScenarioWeights;
  total: number;
  media: number;
  reserves: { production: number; testing: number; scaling: number; contingency: number };
  platforms: PlatformShare[];
  lines: PlannedLine[];
  totals: PlannedResults;
  views: {
    byRole: { key: AudienceRole; amount: number }[];
    byFunnel: { key: FunnelStage; amount: number }[];
    byObjective: { key: Objective | "UNSET"; amount: number }[];
    byAudience: { key: string; amount: number }[];
    weekly: { start: Date; end: Date; amount: number }[];
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const pos = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? n : null);

export function weightsFor(scenario: BudgetScenario, custom?: ScenarioWeights | null): ScenarioWeights {
  if (scenario === "CUSTOM") return normalizeWeights(custom ?? SCENARIO_WEIGHTS.BALANCED);
  return SCENARIO_WEIGHTS[scenario];
}

/** Clamp reserves so at least 40% stays in working media, and make the role split sum to 1. */
export function normalizeWeights(w: ScenarioWeights): ScenarioWeights {
  const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  const out = { ...w, production: clamp(w.production), testing: clamp(w.testing), scaling: clamp(w.scaling), contingency: clamp(w.contingency), efficiencyBias: clamp(w.efficiencyBias) };
  const reserve = out.production + out.testing + out.scaling + out.contingency;
  if (reserve > 0.6) {
    const k = 0.6 / reserve;
    out.production *= k;
    out.testing *= k;
    out.scaling *= k;
    out.contingency *= k;
  }
  const roles = clamp(w.prospecting) + clamp(w.retargeting) + clamp(w.retention);
  if (roles > 0) {
    out.prospecting = clamp(w.prospecting) / roles;
    out.retargeting = clamp(w.retargeting) / roles;
    out.retention = clamp(w.retention) / roles;
  } else {
    Object.assign(out, { prospecting: 1, retargeting: 0, retention: 0 });
  }
  if (!["flat", "rampUp", "frontLoad"].includes(out.phasing)) out.phasing = "flat";
  return out;
}

export function roleOfFunnel(stage: FunnelStage | null | undefined): AudienceRole {
  if (stage === "RETENTION" || stage === "ADVOCACY") return "RETENTION";
  if (stage === "CONVERSION") return "RETARGETING";
  return "PROSPECTING";
}

function funnelOfRole(role: AudienceRole, objective: Objective | null): FunnelStage {
  if (role === "RETENTION") return "RETENTION";
  if (role === "RETARGETING") return "CONVERSION";
  return objective && ["AWARENESS", "REACH", "VIDEO_VIEWS"].includes(objective) ? "AWARENESS" : "CONSIDERATION";
}

/** Objective-specific efficiency: revenue per unit spend for sales, leads per spend for leads, impressions per spend otherwise. */
export function efficiencyOf(h: HistoryKpis | undefined, objective: Objective | null): number | null {
  if (!h || h.spend <= 0) return null;
  if (objective === "SALES") return h.revenue > 0 ? h.revenue / h.spend : null;
  if (objective === "LEADS" || objective === "MESSAGES") return h.leads > 0 ? h.leads / h.spend : null;
  return h.impressions > 0 ? h.impressions / h.spend : null;
}

/** Converts budget into estimated results using unit-cost assumptions. */
export function estimateResults(budget: number, cost: CostAssumption | undefined, objective: Objective | null, role: AudienceRole = "PROSPECTING", frequency = DEFAULT_FREQUENCY) {
  const f = ROLE_FACTORS[role];
  const cpm = pos(cost?.cpm);
  const cpc = pos(cost?.cpc);
  const cpl = pos(cost?.cpl);
  const cvr = pos(cost?.cvr);
  const aov = pos(cost?.aov);
  const out: PlannedResults = { impressions: 0, reach: 0, clicks: 0, leads: 0, sales: 0, revenue: 0 };
  let incomplete = false;
  if (budget <= 0) return { ...out, incomplete };
  if (cpm) out.impressions = (budget / (cpm * f.cpm)) * 1000;
  else incomplete = true;
  out.reach = out.impressions / Math.max(1, frequency);
  if (cpc) out.clicks = budget / cpc;
  else incomplete = true;
  const wantsSales = objective === "SALES";
  const wantsLeads = objective === "LEADS" || objective === "MESSAGES" || objective == null;
  if (wantsLeads) {
    if (cpl) out.leads = budget / (cpl / f.cvr);
    else if (cvr && out.clicks) out.leads = out.clicks * cvr * f.cvr;
    else incomplete = true;
  }
  if (wantsSales) {
    if (cvr && out.clicks) out.sales = out.clicks * cvr * f.cvr;
    else incomplete = true;
    if (aov) out.revenue = out.sales * aov;
    else if (out.sales) incomplete = true;
  }
  return {
    impressions: Math.round(out.impressions),
    reach: Math.round(out.reach),
    clicks: Math.round(out.clicks),
    leads: Math.round(out.leads),
    sales: Math.round(out.sales),
    revenue: round2(out.revenue),
    incomplete,
  };
}

/** Relative weight of each day for a phasing curve; sums to 1 across the period. */
export function dailyWeights(start: Date, end: Date, phasing: Phasing): number[] {
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const raw = Array.from({ length: days }, (_, i) => {
    const x = days === 1 ? 0 : i / (days - 1);
    return phasing === "rampUp" ? 0.8 + 0.4 * x : phasing === "frontLoad" ? 1.2 - 0.4 * x : 1;
  });
  const sum = raw.reduce((s, v) => s + v, 0);
  return raw.map((v) => v / sum);
}

/** Planned spend per day (UTC midnight dates) for a budget over a period. */
export function dailyPlan(start: Date, end: Date, amount: number, phasing: Phasing) {
  return dailyWeights(start, end, phasing).map((w, i) => ({ date: new Date(start.getTime() + i * 86400000), amount: amount * w }));
}

export function weeklyPhasing(start: Date, end: Date, amount: number, phasing: Phasing) {
  const days = dailyPlan(start, end, amount, phasing);
  const weeks: { start: Date; end: Date; amount: number }[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    weeks.push({ start: chunk[0].date, end: chunk[chunk.length - 1].date, amount: round2(chunk.reduce((s, d) => s + d.amount, 0)) });
  }
  return weeks;
}

function platformShares(input: AllocationInput, w: ScenarioWeights): PlatformShare[] {
  const plats = [...new Set(input.platforms)];
  if (!plats.length) return [];
  if (input.scenario === "CUSTOM" && input.platformShares) {
    const vals = plats.map((p) => Math.max(0, input.platformShares?.[p] ?? 0));
    const sum = vals.reduce((s, v) => s + v, 0);
    if (sum > 0) return plats.map((p, i) => ({ platform: p, share: vals[i] / sum, amount: 0, basis: "manual" as const, efficiency: efficiencyOf(input.history[p], input.objective) }));
  }
  const effs = plats.map((p) => efficiencyOf(input.history[p], input.objective));
  const known = effs.filter((e): e is number => e != null);
  const avg = known.length ? known.reduce((s, e) => s + e, 0) / known.length : null;
  // Platforms without history are treated as average so they still get a fair test budget.
  const filled = effs.map((e) => e ?? avg ?? 1);
  const effSum = filled.reduce((s, e) => s + e, 0);
  const even = 1 / plats.length;
  const bias = known.length ? w.efficiencyBias : 0;
  return plats.map((p, i) => ({
    platform: p,
    share: bias * (filled[i] / effSum) + (1 - bias) * even,
    amount: 0,
    basis: bias > 0 && effs[i] != null ? ("efficiency" as const) : ("even" as const),
    efficiency: effs[i],
  }));
}

export function allocate(input: AllocationInput): Allocation {
  const w = weightsFor(input.scenario, input.customWeights);
  const total = Math.max(0, input.total);
  const reserves = {
    production: round2(total * w.production),
    testing: round2(total * w.testing),
    scaling: round2(total * w.scaling),
    contingency: round2(total * w.contingency),
  };
  const media = round2(total - reserves.production - reserves.testing - reserves.scaling - reserves.contingency);
  const shares = platformShares(input, w).map((s) => ({ ...s, amount: round2(media * s.share) }));
  const roleShare: Record<AudienceRole, number> = { PROSPECTING: w.prospecting, RETARGETING: w.retargeting, RETENTION: w.retention };

  const lines: PlannedLine[] = [];
  for (const ps of shares) {
    const cost = input.costs[ps.platform];
    const h = input.history[ps.platform];
    const freq = h && h.reach > 0 ? Math.max(1, h.impressions / h.reach) : DEFAULT_FREQUENCY;
    const camps = input.campaigns.filter((c) => c.platform === ps.platform);
    for (const role of ROLES) {
      const roleBudget = ps.amount * roleShare[role];
      if (roleBudget <= 0) continue;
      const linked = camps.filter((c) => roleOfFunnel(c.funnelStage) === role);
      if (linked.length) {
        const hist = linked.reduce((s, c) => s + Math.max(0, c.historySpend), 0);
        for (const c of linked) {
          const b = round2(hist > 0 ? roleBudget * (Math.max(0, c.historySpend) / hist) : roleBudget / linked.length);
          const r = estimateResults(b, cost, c.objective, role, freq);
          lines.push({ key: `c:${c.id}`, category: "CAMPAIGN", label: c.name, platform: ps.platform, campaignId: c.id, funnelStage: c.funnelStage ?? funnelOfRole(role, c.objective), role, objective: c.objective, budget: b, ...r });
        }
      } else {
        const b = round2(roleBudget);
        const r = estimateResults(b, cost, input.objective, role, freq);
        lines.push({ key: `r:${ps.platform}:${role}`, category: role, label: `${ps.platform} · ${role}`, platform: ps.platform, campaignId: null, funnelStage: funnelOfRole(role, input.objective), role, objective: input.objective, budget: b, ...r });
      }
    }
  }
  const reserveCats: [BudgetLineCategory, number][] = [
    ["PRODUCTION", reserves.production],
    ["TESTING", reserves.testing],
    ["SCALING", reserves.scaling],
    ["CONTINGENCY", reserves.contingency],
  ];
  for (const [cat, amount] of reserveCats) {
    if (amount <= 0) continue;
    lines.push({ key: `x:${cat}`, category: cat, label: cat, platform: null, campaignId: null, funnelStage: null, role: null, objective: null, budget: amount, impressions: 0, reach: 0, clicks: 0, leads: 0, sales: 0, revenue: 0, incomplete: false });
  }

  // Rounding drift goes to the largest line so lines always sum to the total.
  const drift = round2(total - lines.reduce((s, l) => s + l.budget, 0));
  if (drift !== 0 && lines.length) {
    const biggest = lines.reduce((a, b) => (b.budget > a.budget ? b : a));
    biggest.budget = round2(biggest.budget + drift);
  }

  const sumBy = <K extends string>(keyOf: (l: PlannedLine) => K | null) => {
    const m = new Map<K, number>();
    for (const l of lines) {
      const k = keyOf(l);
      if (k != null) m.set(k, round2((m.get(k) ?? 0) + l.budget));
    }
    return [...m.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => b.amount - a.amount);
  };
  const prospectingTotal = lines.filter((l) => l.role === "PROSPECTING").reduce((s, l) => s + l.budget, 0);
  const auds = input.audiences.filter(Boolean);

  const totals = lines.reduce<PlannedResults>(
    (acc, l) => ({ impressions: acc.impressions + l.impressions, reach: acc.reach + l.reach, clicks: acc.clicks + l.clicks, leads: acc.leads + l.leads, sales: acc.sales + l.sales, revenue: round2(acc.revenue + l.revenue) }),
    { impressions: 0, reach: 0, clicks: 0, leads: 0, sales: 0, revenue: 0 },
  );

  return {
    weights: w,
    total,
    media,
    reserves,
    platforms: shares,
    lines,
    totals,
    views: {
      byRole: sumBy((l) => l.role),
      byFunnel: sumBy((l) => l.funnelStage),
      byObjective: sumBy((l) => (l.role ? (l.objective ?? "UNSET") : null)),
      byAudience: auds.map((a) => ({ key: a, amount: round2(prospectingTotal / auds.length) })),
      weekly: weeklyPhasing(input.startDate, input.endDate, media, w.phasing),
    },
  };
}

/** Period end from a start date (inclusive): monthly → end of that month, etc. */
export function periodEnd(start: Date, period: "MONTHLY" | "QUARTERLY" | "YEARLY") {
  const months = period === "MONTHLY" ? 1 : period === "QUARTERLY" ? 3 : 12;
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate() - 1));
}
