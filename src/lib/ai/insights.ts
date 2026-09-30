import type { Kpis } from "@/lib/metrics";
import { delta } from "@/lib/metrics";
import { fmtMoney, fmtNumber, fmtPct, fmtDate, type Locale } from "@/lib/format";
import type { TFunction } from "@/lib/i18n/translate";

/**
 * Deterministic "AI" executive summary. Every sentence is derived from numbers that exist in
 * the database — nothing is invented. Each item states its kind (fact / estimate / recommendation),
 * its data source and a confidence level. An LLM may later *rephrase* these items (see ai/assistant.ts)
 * but is never allowed to add figures.
 */
export type InsightKind = "fact" | "estimate" | "recommendation";
export type Insight = { text: string; kind: InsightKind; source: string; confidence: number; tone?: "good" | "bad" | "warning" | "info" };

export type SummaryInput = {
  current: Kpis;
  previous: Kpis | null;
  planned: number; // prorated planned budget for the range
  fullBudget: number;
  forecast: { projected: number; depletionDate: Date | null; pacing: number | null } | null;
  platforms: ({ platform: string } & Kpis)[];
  campaigns: ({ name: string } & Kpis)[];
  followersGrowth: number | null;
  benchmarks: { metric: string; median: number; higherIsBetter: boolean }[];
  currency: string;
  source: string;
};

export type ExecutiveSummary = {
  whatHappened: Insight[];
  why: Insight[];
  good: Insight[];
  problems: Insight[];
  actions: Insight[];
  outlook: Insight[];
  decisions: Insight[];
  enoughData: boolean;
};

export function buildExecutiveSummary(i: SummaryInput, t: TFunction, locale: Locale): ExecutiveSummary {
  const money = (n: number | null) => fmtMoney(n, i.currency, locale);
  const pct = (n: number | null) => fmtPct(n, locale);
  const c = i.current;
  const p = i.previous;
  const src = i.source;
  const out: ExecutiveSummary = { whatHappened: [], why: [], good: [], problems: [], actions: [], outlook: [], decisions: [], enoughData: c.spend > 0 };
  if (!out.enoughData) return out;

  // ── What happened
  const dSpend = p ? delta(c.spend, p.spend) : null;
  out.whatHappened.push({
    kind: "fact",
    source: src,
    confidence: 1,
    text: t("dashboard.ins.spent", { spend: money(c.spend), change: dSpend == null ? "—" : pct(dSpend), dir: dSpend == null ? "" : dSpend >= 0 ? t("dashboard.ins.up") : t("dashboard.ins.down") }),
  });
  if (c.revenue > 0) out.whatHappened.push({ kind: "fact", source: src, confidence: 1, text: t("dashboard.ins.revenue", { revenue: money(c.revenue), roas: fmtNumber(c.roas, locale, 2) }) });
  if (c.leads > 0) out.whatHappened.push({ kind: "fact", source: src, confidence: 1, text: t("dashboard.ins.leads", { leads: fmtNumber(c.leads, locale), cpl: money(c.cpl) }) });

  // ── Why (driver decomposition: spend = impressions × CPM; results = clicks × CVR)
  if (p) {
    const drivers: [string, number | null, boolean][] = [
      ["cpm", delta(c.cpm, p.cpm), false],
      ["ctr", delta(c.ctr, p.ctr), true],
      ["cvr", delta(c.cvr, p.cvr), true],
      ["frequency", delta(c.frequency, p.frequency), false],
    ];
    for (const [k, d, higherBetter] of drivers.sort((a, b) => Math.abs(b[1] ?? 0) - Math.abs(a[1] ?? 0)).slice(0, 3)) {
      if (d == null || Math.abs(d) < 0.05) continue;
      const good = d > 0 === higherBetter;
      out.why.push({
        kind: "fact",
        source: src,
        confidence: 0.8,
        tone: good ? "good" : "bad",
        text: t("dashboard.ins.driver", { metric: t(`kpi.${k}`), change: pct(Math.abs(d)), dir: d > 0 ? t("dashboard.ins.up") : t("dashboard.ins.down") }),
      });
    }
  }

  // ── Good / problems vs benchmarks and previous period
  const bench = (metric: string) => i.benchmarks.find((b) => b.metric === metric);
  const checks: [string, keyof Kpis, (n: number | null) => string][] = [
    ["CTR", "ctr", pct],
    ["CPM", "cpm", money],
    ["CPC", "cpc", money],
    ["CPL", "cpl", money],
    ["ROAS", "roas", (n) => fmtNumber(n, locale, 2)],
  ];
  for (const [metric, key, f] of checks) {
    const b = bench(metric);
    const v = c[key] as number | null;
    if (!b || v == null) continue;
    const better = b.higherIsBetter ? v >= b.median : v <= b.median;
    const gap = (v - b.median) / b.median;
    (better ? out.good : out.problems).push({
      kind: "fact",
      source: `${src} + ${t("dashboard.ins.benchmarkSource")}`,
      confidence: 0.7,
      tone: better ? "good" : "warning",
      text: t(better ? "dashboard.ins.beatsMarket" : "dashboard.ins.belowMarket", { metric: t(`kpi.${key}`), value: f(v), market: f(b.median), gap: pct(Math.abs(gap)) }),
    });
  }
  if (i.followersGrowth != null && i.followersGrowth > 0) out.good.push({ kind: "fact", source: t("dashboard.ins.organicSource"), confidence: 0.9, tone: "good", text: t("dashboard.ins.followers", { growth: pct(i.followersGrowth) }) });

  // ── Platform & campaign winners / losers
  const withSpend = i.platforms.filter((x) => x.spend > 0);
  const eff = (x: Kpis) => x.roas ?? (x.cpl ? 1 / x.cpl : null) ?? (x.cpa ? 1 / x.cpa : null) ?? x.ctr ?? 0;
  if (withSpend.length > 1) {
    const sorted = [...withSpend].sort((a, b) => (eff(b) ?? 0) - (eff(a) ?? 0));
    out.good.push({ kind: "fact", source: src, confidence: 0.8, tone: "good", text: t("dashboard.ins.bestPlatform", { name: t(`platform.${sorted[0].platform}`) }) });
    out.problems.push({ kind: "fact", source: src, confidence: 0.8, tone: "warning", text: t("dashboard.ins.worstPlatform", { name: t(`platform.${sorted.at(-1)!.platform}`) }) });
  }
  const camps = i.campaigns.filter((x) => x.spend > 0);
  const hiFreq = camps.filter((x) => (x.frequency ?? 0) > 3.5);
  for (const x of hiFreq.slice(0, 2)) {
    out.problems.push({ kind: "fact", source: src, confidence: 0.9, tone: "warning", text: t("dashboard.ins.frequency", { name: x.name, freq: fmtNumber(x.frequency, locale, 1) }) });
    out.actions.push({ kind: "recommendation", source: src, confidence: 0.75, text: t("dashboard.ins.refreshCreative", { name: x.name }) });
  }

  // ── Budget pacing & outlook (estimates)
  if (i.planned > 0) {
    const util = c.spend / i.planned;
    if (util > 1.1) out.problems.push({ kind: "fact", source: t("dashboard.ins.planSource"), confidence: 1, tone: "bad", text: t("dashboard.ins.overPlan", { pct: pct(util - 1) }) });
    else if (util < 0.85) out.problems.push({ kind: "fact", source: t("dashboard.ins.planSource"), confidence: 1, tone: "warning", text: t("dashboard.ins.underPlan", { pct: pct(1 - util) }) });
    else out.good.push({ kind: "fact", source: t("dashboard.ins.planSource"), confidence: 1, tone: "good", text: t("dashboard.ins.onPlan") });
  }
  if (i.forecast && i.fullBudget > 0) {
    out.outlook.push({ kind: "estimate", source: t("dashboard.ins.forecastSource"), confidence: 0.65, text: t("dashboard.ins.forecast", { projected: money(i.forecast.projected), budget: money(i.fullBudget) }) });
    if (i.forecast.depletionDate) out.outlook.push({ kind: "estimate", source: t("dashboard.ins.forecastSource"), confidence: 0.6, tone: "warning", text: t("dashboard.ins.depletion", { date: fmtDate(i.forecast.depletionDate, locale) }) });
    if (c.roas && c.spend > 0) out.outlook.push({ kind: "estimate", source: t("dashboard.ins.forecastSource"), confidence: 0.5, text: t("dashboard.ins.revenueOutlook", { revenue: money(c.roas * i.forecast.projected) }) });
  }

  // ── Recommended actions (reallocation from worst to best campaign by efficiency)
  const ranked = camps.filter((x) => x.spend > c.spend * 0.05).sort((a, b) => (eff(b) ?? 0) - (eff(a) ?? 0));
  if (ranked.length >= 2) {
    const best = ranked[0];
    const worst = ranked.at(-1)!;
    out.actions.push({ kind: "recommendation", source: src, confidence: 0.7, text: t("dashboard.ins.reallocate", { from: worst.name, to: best.name, amount: money(worst.spend * 0.15) }) });
    out.good.push({ kind: "fact", source: src, confidence: 0.85, tone: "good", text: t("dashboard.ins.bestCampaign", { name: best.name }) });
  }
  if (p && c.ctr != null && p.ctr != null && c.ctr < p.ctr * 0.9) out.actions.push({ kind: "recommendation", source: src, confidence: 0.65, text: t("dashboard.ins.testHooks") });
  if (i.planned > 0 && c.spend / i.planned < 0.85) out.actions.push({ kind: "recommendation", source: t("dashboard.ins.planSource"), confidence: 0.7, text: t("dashboard.ins.increaseBids") });
  if (i.planned > 0 && c.spend / i.planned > 1.1) out.actions.push({ kind: "recommendation", source: t("dashboard.ins.planSource"), confidence: 0.8, text: t("dashboard.ins.capBudgets") });
  if (!out.actions.length) out.actions.push({ kind: "recommendation", source: src, confidence: 0.5, text: t("dashboard.ins.keepCourse") });

  // ── Top 5 decisions = highest-confidence recommendations + critical problems
  out.decisions = [...out.actions, ...out.problems.filter((x) => x.tone === "bad").map((x) => ({ ...x, kind: "recommendation" as const, text: t("dashboard.ins.address", { issue: x.text }) }))]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  return out;
}
