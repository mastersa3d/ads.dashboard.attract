import "server-only";
import { z } from "zod";
import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import { fmtMoney, fmtNumber, fmtPct, isoDay, type Locale } from "@/lib/format";
import type { FxTable } from "@/lib/fx";
import type { TFunction } from "@/lib/i18n/translate";
import { byEntity, byPlatform, totals } from "@/lib/queries/performance";
import { benchmarksFor } from "@/lib/queries/benchmarks";
import { AiError, aiEnabled, generateStructured } from "@/lib/ai/claude";
import { readSections } from "@/components/strategy/sections";

/**
 * AI Strategy Assistant.
 *
 * 1. `buildStrategyPackage()` assembles a tenant-scoped data package (last 90 days of KPIs by
 *    platform / campaign, competitor summaries, top ideas, benchmarks, current strategy).
 * 2. `suggestStrategy()` asks Claude for measurable goals, channel mix, content pillars and a
 *    30/60/90-day plan — each with reasoning, confidence and data sources. When AI is disabled
 *    (no ANTHROPIC_API_KEY) or the call fails, a deterministic rule-based generator derives the
 *    same four outputs from the same package; its output is labelled "rule-based suggestion".
 * Nothing here writes to the strategy — the caller stores PENDING AiRecommendation rows.
 */

const HISTORY_DAYS = 90;

export type StrategyPackage = Awaited<ReturnType<typeof buildStrategyPackage>>;

export async function buildStrategyPackage(opts: { clientId: string; organizationId: string; fx: FxTable; t: TFunction; now?: Date }) {
  const { t } = opts;
  const now = opts.now ?? new Date();
  const client = await db.client.findUniqueOrThrow({
    where: { id: opts.clientId },
    select: { id: true, name: true, industry: true, country: true, currency: true, products: true, audiences: true, goals: true, isB2B: true, isDemo: true },
  });
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - (HISTORY_DAYS - 1) * 86400000);
  const f = parseFilters({ from: isoDay(from), to: isoDay(to) }, now);
  const q = { scope: { clientId: client.id }, currency: client.currency, fx: opts.fx };

  const [tot, plats, camps, competitors, ideas, strategy, sources] = await Promise.all([
    totals(f, q),
    byPlatform(f, q),
    byEntity(f, q, "campaign"),
    db.competitor.findMany({
      where: { clientId: client.id, state: "ACCEPTED" },
      select: { name: true, activePlatforms: true, pillars: true, strengths: true, weaknesses: true, opportunities: true, postingPerWeek: true, engagementLevel: true, source: true },
      take: 10,
    }),
    db.idea.findMany({
      where: { clientId: client.id },
      select: { title: true, source: true, platform: true, format: true, objective: true, funnelStage: true, impact: true, ease: true, reason: true, priority: true },
      orderBy: [{ impact: "desc" }, { ease: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
    db.strategy.findUnique({ where: { clientId: client.id }, select: { sections: true } }),
    db.metricDaily.groupBy({ by: ["platform", "source"], where: { clientId: client.id, date: { gte: from, lte: to } } }),
  ]);
  const platformList = plats.map((p) => p.platform);
  const benchmarks = await benchmarksFor({ organizationId: opts.organizationId, platforms: platformList, country: client.country, industry: client.industry });
  const sections = readSections(strategy?.sections);

  const demo = sources.some((s) => s.source === "DEMO") || client.isDemo;
  const perfSource = sources.length
    ? `${t("strategy.ds.performance")}: ${[...new Set(sources.map((s) => t(`platform.${s.platform}`)))].join(", ")}${demo ? ` (${t("source.DEMO")})` : ""}`
    : t("strategy.ds.noPerformance");
  const dataSources = {
    performance: perfSource,
    competitors: t("strategy.ds.competitors"),
    ideas: t("strategy.ds.ideas"),
    benchmarks: benchmarks[0] ? `${t("strategy.ds.benchmarks")}: ${benchmarks[0].sourceName}` : t("strategy.ds.benchmarks"),
    strategy: t("strategy.ds.strategy"),
  };
  const r = (n: number | null, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

  return {
    client: { name: client.name, industry: client.industry, country: client.country, currency: client.currency, products: client.products, audiences: client.audiences, goals: client.goals, isB2B: client.isB2B },
    period: { from: isoDay(from), to: isoDay(to), days: HISTORY_DAYS },
    totals: { spend: r(tot.spend), revenue: r(tot.revenue), leads: tot.leads, purchases: tot.purchases, clicks: tot.clicks, impressions: tot.impressions, reach: tot.reach, roas: r(tot.roas), cpl: r(tot.cpl), cpa: r(tot.cpa), ctr: r(tot.ctr, 4), cpm: r(tot.cpm), cvr: r(tot.cvr, 4), frequency: r(tot.frequency) },
    platforms: plats
      .filter((p) => p.spend > 0)
      .sort((a, b) => b.spend - a.spend)
      .map((p) => ({ platform: p.platform, spend: r(p.spend), sharePct: tot.spend > 0 ? r((p.spend / tot.spend) * 100, 1) : null, revenue: r(p.revenue), leads: p.leads, purchases: p.purchases, clicks: p.clicks, impressions: p.impressions, roas: r(p.roas), cpl: r(p.cpl), cpa: r(p.cpa), ctr: r(p.ctr, 4), cpm: r(p.cpm), cvr: r(p.cvr, 4) })),
    campaigns: camps
      .filter((c) => c.spend > 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 12)
      .map((c) => ({ name: c.name, platform: c.platform ?? null, objective: c.objective ?? null, spend: r(c.spend), leads: c.leads, purchases: c.purchases, revenue: r(c.revenue), roas: r(c.roas), cpl: r(c.cpl), ctr: r(c.ctr, 4), cvr: r(c.cvr, 4) })),
    competitors: competitors.map((c) => ({ name: c.name, platforms: c.activePlatforms, pillars: c.pillars, strengths: c.strengths, weaknesses: c.weaknesses, opportunities: c.opportunities, postingPerWeek: c.postingPerWeek, engagementLevel: c.engagementLevel, source: c.source })),
    ideas: ideas.map((i) => ({ title: i.title, source: i.source, platform: i.platform, format: i.format, objective: i.objective, funnelStage: i.funnelStage, impact: i.impact, ease: i.ease, reason: i.reason })),
    benchmarks: benchmarks.map((b) => ({ metric: b.metric, platform: b.platform, median: b.median, p25: b.p25, p75: b.p75, higherIsBetter: b.higherIsBetter, source: b.sourceName, isEstimate: b.isEstimate })),
    currentStrategy: { smartGoals: sections.smartGoals.items, pillars: sections.pillars.items, channels: sections.channels.items, kpis: sections.kpis.items },
    dataSources,
    isDemo: demo,
  };
}

// ── Output schema (shared by Claude and the rule-based generator) ──────────────
// No numeric bounds / array limits in the schema itself (structured outputs ignore most of them);
// values are clamped after parsing.
const point = { reasoning: z.string(), confidence: z.number(), dataSources: z.array(z.string()) };
export const strategySuggestionSchema = z.object({
  goals: z.array(z.object({ title: z.string(), metric: z.string(), baseline: z.string().nullable(), target: z.string(), deadline: z.string(), ...point })),
  channelMix: z.array(z.object({ platform: z.string(), sharePct: z.number(), role: z.string(), ...point })),
  pillars: z.array(z.object({ name: z.string(), description: z.string(), ...point })),
  plan: z.object({ days30: z.array(z.string()), days60: z.array(z.string()), days90: z.array(z.string()), ...point }),
});
export type StrategySuggestion = z.infer<typeof strategySuggestionSchema>;

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function sanitizeSuggestion(s: StrategySuggestion): StrategySuggestion {
  const fix = <T extends { confidence: number }>(x: T) => ({ ...x, confidence: clamp01(x.confidence) });
  return {
    goals: s.goals.slice(0, 6).map(fix),
    channelMix: s.channelMix.slice(0, 8).map((c) => fix({ ...c, sharePct: Math.max(0, Math.min(100, Math.round(c.sharePct))) })),
    pillars: s.pillars.slice(0, 6).map(fix),
    plan: fix({ ...s.plan, days30: s.plan.days30.slice(0, 6), days60: s.plan.days60.slice(0, 6), days90: s.plan.days90.slice(0, 6) }),
  };
}

const TASK = `Using ONLY the data package, propose for this client's marketing strategy:
1. goals: 3-5 SMART goals. Baselines must come from the data (totals / platforms); targets must be realistic versus the baseline and the benchmarks. Deadline relative to today (e.g. "90 days").
2. channelMix: budget share (percent, summing to ~100) per platform that appears in the data, with the role of each channel in the funnel.
3. pillars: 3-5 content pillars grounded in the competitor gaps, the ideas backlog and the current strategy.
4. plan: concrete actions for days 0-30, 31-60 and 61-90.
For every item give short reasoning that cites the numbers used, a confidence between 0 and 1 (lower when data is thin or demo), and dataSources chosen from the labels in data.dataSources.
If a part cannot be supported by the data, return fewer items and say why in the reasoning.`;

export type SuggestResult = { method: "ai" | "rules"; aiError: string | null; suggestion: StrategySuggestion };

export async function suggestStrategy(pkg: StrategyPackage, t: TFunction, locale: Locale): Promise<SuggestResult> {
  if (aiEnabled()) {
    try {
      const out = await generateStructured({ schema: strategySuggestionSchema, task: TASK, data: pkg, locale, effort: "medium" });
      return { method: "ai", aiError: null, suggestion: sanitizeSuggestion(out) };
    } catch (e) {
      const code = e instanceof AiError ? e.code : "FAILED";
      return { method: "rules", aiError: code, suggestion: ruleBasedStrategy(pkg, t, locale) };
    }
  }
  return { method: "rules", aiError: null, suggestion: ruleBasedStrategy(pkg, t, locale) };
}

/**
 * Deterministic fallback. Every number comes from the package; confidence reflects data depth
 * (lower when demo data or no benchmark is available).
 */
export function ruleBasedStrategy(pkg: StrategyPackage, t: TFunction, locale: Locale): StrategySuggestion {
  const cur = pkg.client.currency;
  const money = (n: number | null) => fmtMoney(n, cur, locale);
  const num = (n: number | null, d = 0) => fmtNumber(n, locale, d);
  const pct = (n: number | null, d = 1) => fmtPct(n, locale, d);
  const ds = pkg.dataSources;
  const tot = pkg.totals;
  const depth = (pkg.isDemo ? 0.85 : 1) * (tot.spend && tot.spend > 0 ? 1 : 0.5);
  const bm = (metric: string, platform?: Platform | null) => pkg.benchmarks.find((b) => b.metric === metric && (!platform || b.platform === platform)) ?? pkg.benchmarks.find((b) => b.metric === metric);
  const days = t("strategy.rule.days90");

  // ── Goals
  const goals: StrategySuggestion["goals"] = [];
  if (tot.revenue && tot.roas) {
    const m = bm("ROAS");
    const target = m && tot.roas < m.median ? tot.roas + (m.median - tot.roas) / 2 : tot.roas * 1.1;
    goals.push({
      title: t("strategy.rule.goalRoas", { target: num(target, 1) }),
      metric: t("kpi.roas"),
      baseline: num(tot.roas, 2) + "x",
      target: num(target, 2) + "x",
      deadline: days,
      reasoning: m ? t("strategy.rule.goalRoasWhyBm", { base: num(tot.roas, 2), median: num(m.median, 1) }) : t("strategy.rule.goalRoasWhy", { base: num(tot.roas, 2) }),
      confidence: (m ? 0.7 : 0.55) * depth,
      dataSources: m ? [ds.performance, ds.benchmarks] : [ds.performance],
    });
  }
  if (tot.leads && tot.cpl) {
    const m = bm("CPL");
    const target = m && tot.cpl > m.median ? tot.cpl - (tot.cpl - m.median) / 2 : tot.cpl * 0.92;
    goals.push({
      title: t("strategy.rule.goalCpl", { target: money(target) }),
      metric: t("kpi.cpl"),
      baseline: money(tot.cpl),
      target: money(target),
      deadline: days,
      reasoning: m ? t("strategy.rule.goalCplWhyBm", { base: money(tot.cpl), median: money(m.median) }) : t("strategy.rule.goalCplWhy", { base: money(tot.cpl) }),
      confidence: (m ? 0.7 : 0.55) * depth,
      dataSources: m ? [ds.performance, ds.benchmarks] : [ds.performance],
    });
    const monthly = (tot.leads / pkg.period.days) * 30;
    goals.push({
      title: t("strategy.rule.goalLeads", { target: num(monthly * 1.15) }),
      metric: t("kpi.leads"),
      baseline: num(monthly),
      target: num(monthly * 1.15),
      deadline: days,
      reasoning: t("strategy.rule.goalVolumeWhy", { base: num(monthly), days: pkg.period.days }),
      confidence: 0.6 * depth,
      dataSources: [ds.performance],
    });
  }
  if (tot.purchases) {
    const monthly = (tot.purchases / pkg.period.days) * 30;
    goals.push({
      title: t("strategy.rule.goalSales", { target: num(monthly * 1.15) }),
      metric: t("kpi.purchases"),
      baseline: num(monthly),
      target: num(monthly * 1.15),
      deadline: days,
      reasoning: t("strategy.rule.goalVolumeWhy", { base: num(monthly), days: pkg.period.days }),
      confidence: 0.6 * depth,
      dataSources: [ds.performance],
    });
  }
  const ctrBm = bm("CTR", pkg.platforms[0]?.platform);
  if (tot.ctr != null && ctrBm && tot.ctr < ctrBm.median) {
    goals.push({
      title: t("strategy.rule.goalCtr", { target: pct(ctrBm.median, 2) }),
      metric: t("kpi.ctr"),
      baseline: pct(tot.ctr, 2),
      target: pct(ctrBm.median, 2),
      deadline: days,
      reasoning: t("strategy.rule.goalCtrWhy", { base: pct(tot.ctr, 2), median: pct(ctrBm.median, 2) }),
      confidence: 0.6 * depth,
      dataSources: [ds.performance, ds.benchmarks],
    });
  }
  if (!goals.length) {
    goals.push({ title: t("strategy.rule.goalBaseline"), metric: t("strategy.rule.tracking"), baseline: null, target: t("strategy.rule.goalBaselineTarget"), deadline: t("strategy.rule.days30"), reasoning: t("strategy.rule.goalBaselineWhy"), confidence: 0.4, dataSources: [ds.performance] });
  }

  // ── Channel mix: half current spend share, half relative efficiency (objective-aware)
  const plats = pkg.platforms.filter((p) => (p.spend ?? 0) > 0);
  const effOf = (p: (typeof plats)[number]) => (tot.revenue ? (p.revenue ?? 0) / (p.spend ?? 1) : tot.leads ? p.leads / (p.spend ?? 1) : p.clicks / (p.spend ?? 1));
  const effs = plats.map(effOf);
  const effSum = effs.reduce((s, e) => s + e, 0);
  const avgEff = plats.length ? effSum / plats.length : 0;
  const raw = plats.map((p, i) => 0.5 * ((p.spend ?? 0) / (tot.spend || 1)) + 0.5 * (effSum > 0 ? effs[i] / effSum : 1 / plats.length));
  const rounded = raw.map((v) => Math.max(5, Math.round((v * 100) / 5) * 5));
  const drift = 100 - rounded.reduce((s, v) => s + v, 0);
  if (rounded.length) rounded[rounded.indexOf(Math.max(...rounded))] += drift;
  const bestIdx = effs.indexOf(Math.max(...effs));
  const cheapestIdx = plats.reduce((bi, p, i) => ((p.cpm ?? Infinity) < (plats[bi]?.cpm ?? Infinity) ? i : bi), 0);
  const channelMix: StrategySuggestion["channelMix"] = plats.map((p, i) => ({
    platform: p.platform,
    sharePct: rounded[i],
    role: i === bestIdx ? t("strategy.rule.roleScale") : i === cheapestIdx ? t("strategy.rule.roleReach") : t("strategy.rule.roleSupport"),
    reasoning: t("strategy.rule.mixWhy", {
      share: pct((p.spend ?? 0) / (tot.spend || 1)),
      eff: avgEff > 0 ? pct(effs[i] / avgEff - 1) : "—",
      dir: avgEff > 0 && effs[i] >= avgEff ? t("strategy.rule.above") : t("strategy.rule.below"),
      metric: tot.revenue ? t("kpi.roas") : tot.leads ? t("kpi.cpl") : t("kpi.cpc"),
    }),
    confidence: (plats.length > 1 ? 0.6 : 0.45) * depth,
    dataSources: [ds.performance],
  }));

  // ── Pillars: competitor pillars (table stakes), competitor gaps, funnel coverage of top ideas
  const pillars: StrategySuggestion["pillars"] = [];
  const pillarCount = new Map<string, number>();
  for (const c of pkg.competitors) for (const p of c.pillars) pillarCount.set(p, (pillarCount.get(p) ?? 0) + 1);
  const existing = new Set(pkg.currentStrategy.pillars.map((p) => p.toLowerCase()));
  for (const [name, n] of [...pillarCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    pillars.push({ name, description: t("strategy.rule.pillarCompetitorDesc"), reasoning: t("strategy.rule.pillarCompetitorWhy", { n, total: pkg.competitors.length }), confidence: 0.55 * depth, dataSources: [ds.competitors] });
  }
  const weakness = pkg.competitors.flatMap((c) => c.weaknesses)[0];
  if (weakness) pillars.push({ name: t("strategy.rule.pillarGap", { gap: weakness }), description: t("strategy.rule.pillarGapDesc"), reasoning: t("strategy.rule.pillarGapWhy", { gap: weakness }), confidence: 0.5 * depth, dataSources: [ds.competitors] });
  const stageCount = new Map<string, number>();
  for (const i of pkg.ideas) if (i.funnelStage) stageCount.set(i.funnelStage, (stageCount.get(i.funnelStage) ?? 0) + 1);
  for (const [stage, n] of [...stageCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    pillars.push({ name: t(`strategy.rule.pillarStage.${stage}`), description: t("strategy.rule.pillarStageDesc", { stage: t(`funnel.${stage}`) }), reasoning: t("strategy.rule.pillarStageWhy", { n, stage: t(`funnel.${stage}`) }), confidence: 0.5 * depth, dataSources: [ds.ideas] });
  }
  const unique = pillars.filter((p, i) => !existing.has(p.name.toLowerCase()) && pillars.findIndex((x) => x.name === p.name) === i).slice(0, 5);

  // ── 30/60/90-day plan
  const ranked = pkg.campaigns.filter((c) => c.spend && c.spend > 0);
  const effC = (c: (typeof ranked)[number]) => (tot.revenue ? (c.roas ?? 0) : c.cpl ? 1 / c.cpl : (c.ctr ?? 0));
  const sortedC = [...ranked].sort((a, b) => effC(b) - effC(a));
  const worst = sortedC.length > 1 ? sortedC.at(-1) : null;
  const best = sortedC[0];
  const days30: string[] = [];
  const days60: string[] = [];
  const days90: string[] = [];
  if (worst) days30.push(t("strategy.rule.p30Worst", { name: worst.name }));
  for (const idea of pkg.ideas.slice(0, 2)) days30.push(t("strategy.rule.p30Idea", { title: idea.title }));
  days30.push(t("strategy.rule.p30Tracking"));
  if (plats[bestIdx]) days60.push(t("strategy.rule.p60Shift", { platform: t(`platform.${plats[bestIdx].platform}`), share: `${rounded[bestIdx]}%` }));
  if (best) days60.push(t("strategy.rule.p60Scale", { name: best.name }));
  days60.push(t("strategy.rule.p60Pillars"));
  days90.push(t("strategy.rule.p90Review"));
  days90.push(t("strategy.rule.p90Retarget"));
  days90.push(t("strategy.rule.p90Next"));

  return {
    goals: goals.slice(0, 5).map((g) => ({ ...g, confidence: clamp01(g.confidence) })),
    channelMix: channelMix.map((c) => ({ ...c, confidence: clamp01(c.confidence) })),
    pillars: unique.map((p) => ({ ...p, confidence: clamp01(p.confidence) })),
    plan: {
      days30,
      days60,
      days90,
      reasoning: t("strategy.rule.planWhy", { best: best?.name ?? "—", worst: worst?.name ?? "—", ideas: pkg.ideas.length }),
      confidence: clamp01(0.55 * depth),
      dataSources: [ds.performance, ds.ideas],
    },
  };
}
