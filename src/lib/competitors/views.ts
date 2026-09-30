import "server-only";
import type { AiRecommendation, CompetitorAd, Idea } from "@prisma/client";
import { toNum } from "@/lib/format";
import { adStatus, isLongRunning, isNewAd, runningDays } from "./intensity";
import type { AdView } from "@/components/competitors/ads-explorer";
import type { IdeaView } from "@/components/trends/idea-form";
import type { PendingIdea } from "@/components/trends/idea-tools";
import type { FollowerStat } from "@/components/competitors/competitor-form";

/** Prisma rows → serialisable props for the client components (dates as ISO strings). */

export function toAdView(a: CompetitorAd, competitor: string, now = new Date()): AdView {
  return {
    id: a.id,
    competitorId: a.competitorId,
    competitor,
    platform: a.platform,
    libraryId: a.libraryId,
    libraryUrl: a.libraryUrl,
    firstSeen: a.firstSeen.toISOString(),
    lastSeen: a.lastSeen.toISOString(),
    isActive: a.isActive,
    placements: a.placements,
    format: a.format,
    creativeIdea: a.creativeIdea,
    hook: a.hook,
    offer: a.offer,
    message: a.message,
    cta: a.cta,
    product: a.product,
    audienceGuess: a.audienceGuess,
    funnelGuess: a.funnelGuess,
    landingPage: a.landingPage,
    variantCount: a.variantCount,
    relaunched: a.relaunched,
    spendMin: a.officialSpendMin == null ? null : toNum(a.officialSpendMin),
    spendMax: a.officialSpendMax == null ? null : toNum(a.officialSpendMax),
    spendCurrency: a.officialSpendCurrency ?? null,
    source: a.source,
    status: adStatus(a, now),
    runningDays: runningDays(a, now),
    isNew: isNewAd(a, now),
    longRunning: isLongRunning(a, now),
  };
}

export function toIdeaView(i: Idea): IdeaView {
  return {
    id: i.id,
    source: i.source,
    title: i.title,
    reason: i.reason,
    competitorName: i.competitorName,
    originalIdea: i.originalIdea,
    whyItWorked: i.whyItWorked,
    ourTwist: i.ourTwist,
    signalSource: i.signalSource,
    signalGrowth: i.signalGrowth,
    validUntil: i.validUntil?.toISOString() ?? null,
    keyword: i.keyword,
    searchIntent: i.searchIntent,
    platform: i.platform,
    format: i.format,
    audience: i.audience,
    objective: i.objective,
    funnelStage: i.funnelStage,
    hook: i.hook,
    cta: i.cta,
    captionOutline: i.captionOutline,
    visualDirection: i.visualDirection,
    priority: i.priority,
    ease: i.ease,
    impact: i.impact,
    costEstimate: i.costEstimate,
    successMetrics: i.successMetrics,
    isSeasonal: i.isSeasonal,
    isEvergreen: i.isEvergreen,
    addedToCalendar: i.addedToCalendar,
    aiGenerated: i.aiGenerated,
    dataSource: i.dataSource,
    createdAt: i.createdAt.toISOString(),
  };
}

export function toPendingIdea(r: AiRecommendation): PendingIdea | null {
  const b = (r.body ?? {}) as Record<string, unknown>;
  const source = b.source;
  if (source !== "COMPETITOR" && source !== "TREND" && source !== "ORIGINAL") return null;
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : null);
  return {
    id: r.id,
    title: r.title,
    reason: r.reasoning,
    confidence: r.confidence,
    engine: b.engine === "ai" ? "ai" : "rules",
    source,
    platform: s("platform"),
    format: s("format"),
    hook: s("hook"),
    competitorName: s("competitorName"),
    keyword: s("keyword"),
    createdAt: r.createdAt.toISOString(),
  };
}

/** Competitor.followers JSON → only well-formed entries (never invent missing numbers). */
export function parseFollowers(json: unknown): Record<string, FollowerStat> {
  const out: Record<string, FollowerStat> = {};
  if (!json || typeof json !== "object") return out;
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    const f = v as Partial<FollowerStat> | null;
    if (!f || typeof f.count !== "number" || !Number.isFinite(f.count)) continue;
    out[k] = {
      count: f.count,
      growthPct: typeof f.growthPct === "number" && Number.isFinite(f.growthPct) ? f.growthPct : null,
      asOf: typeof f.asOf === "string" ? f.asOf : "",
      source: typeof f.source === "string" && f.source ? f.source : "—",
    };
  }
  return out;
}

export function parseLinks(json: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!json || typeof json !== "object") return out;
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) if (typeof v === "string" && v) out[k] = v;
  return out;
}

/** Human-readable data-source list for DataMeta, e.g. "Meta Ad Library API, Manual entry". */
export function sourcesLabel(sources: string[], t: (k: string) => string, apiLabel: string) {
  const uniq = [...new Set(sources)];
  if (!uniq.length) return "—";
  return uniq.map((s) => (s === "API" ? apiLabel : t(`source.${s}`))).join(", ");
}
