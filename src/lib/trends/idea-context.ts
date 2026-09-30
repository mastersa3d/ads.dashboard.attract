import "server-only";
import type { ContentType } from "@prisma/client";
import { db } from "@/lib/db";
import { runningDays } from "@/lib/competitors/intensity";
import { contentGaps } from "./gaps";
import type { IdeaContext } from "./idea-draft";

/** Pillars from the approved/draft strategy (sections.pillars.items) + pillars used in content. */
export async function clientPillars(clientId: string) {
  const [strategy, used] = await Promise.all([
    db.strategy.findUnique({ where: { clientId }, select: { sections: true } }),
    db.contentItem.findMany({ where: { clientId, pillar: { not: null } }, select: { pillar: true }, distinct: ["pillar"], take: 50 }),
  ]);
  const sections = (strategy?.sections ?? {}) as { pillars?: { items?: unknown } };
  const fromStrategy = Array.isArray(sections.pillars?.items) ? sections.pillars.items.filter((x): x is string => typeof x === "string") : [];
  return [...new Set([...fromStrategy, ...used.map((u) => u.pillar!)].map((s) => s.trim()).filter(Boolean))];
}

/** Content-gap rows for a client (client pillars/formats vs accepted competitors). */
export async function clientGaps(clientId: string) {
  const [pillars, types, competitors, posts] = await Promise.all([
    clientPillars(clientId),
    db.contentItem.findMany({ where: { clientId }, select: { type: true }, distinct: ["type"] }),
    db.competitor.findMany({ where: { clientId, state: "ACCEPTED" }, select: { name: true, pillars: true, contentTypes: true, opportunities: true } }),
    db.competitorPost.findMany({ where: { competitor: { clientId, state: "ACCEPTED" } }, select: { type: true, competitor: { select: { name: true } } }, distinct: ["competitorId", "type"] }),
  ]);
  return {
    pillars,
    gaps: contentGaps({
      clientPillars: pillars,
      clientTypes: types.map((x) => x.type as ContentType),
      competitors,
      competitorPostTypes: posts.map((p) => ({ competitor: p.competitor.name, type: p.type })),
    }),
  };
}

/** Tenant-scoped context for idea generation — the caller must have asserted client access. */
export async function loadIdeaContext(clientId: string, locale: "ar" | "en"): Promise<IdeaContext> {
  const now = new Date();
  const [client, { pillars, gaps }, competitors, ads, posts, signals, ideas] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, industry: true, country: true, products: true, audiences: true, goals: true, isB2B: true } }),
    clientGaps(clientId),
    db.competitor.findMany({ where: { clientId, state: "ACCEPTED" }, select: { name: true, pillars: true, contentTypes: true, weaknesses: true, opportunities: true } }),
    db.competitorAd.findMany({
      where: { competitor: { clientId, state: "ACCEPTED" } },
      orderBy: { lastSeen: "desc" },
      take: 200,
      include: { competitor: { select: { name: true } } },
    }),
    db.competitorPost.findMany({
      where: { competitor: { clientId, state: "ACCEPTED" } },
      orderBy: [{ isTopPost: "desc" }, { engagements: "desc" }],
      take: 60,
      include: { competitor: { select: { name: true } } },
    }),
    db.trendSignal.findMany({ where: { clientId }, orderBy: { discoveredAt: "desc" }, take: 100 }),
    db.idea.findMany({ where: { clientId }, select: { title: true } }),
  ]);
  const pending = await db.aiRecommendation.findMany({ where: { clientId, area: { startsWith: "ideas." }, state: "PENDING" }, select: { title: true } });
  const goals = (client.goals ?? "").toLowerCase();
  return {
    locale,
    client: {
      name: client.name,
      industry: client.industry,
      country: client.country,
      products: client.products,
      audiences: client.audiences,
      pillars,
      conversionObjective: client.isB2B || /lead|booking|حجز|عملاء محتمل/.test(goals) ? "LEADS" : "SALES",
    },
    competitors,
    ads: ads.map((a) => ({
      competitor: a.competitor.name,
      platform: a.platform,
      format: a.format,
      creativeIdea: a.creativeIdea,
      offer: a.offer,
      product: a.product,
      funnelGuess: a.funnelGuess,
      runningDays: runningDays(a, now),
      variantCount: a.variantCount,
      isActive: a.isActive,
      relaunched: a.relaunched,
    })),
    posts: posts.map((p) => ({ competitor: p.competitor.name, platform: p.platform, type: p.type, topic: p.topic, occasion: p.occasion, engagements: p.engagements, isTopPost: p.isTopPost })),
    signals: signals.map((s) => ({ keyword: s.keyword, kind: s.kind, sourceName: s.sourceName, growthPct: s.growthPct, discoveredAt: s.discoveredAt, expiresAt: s.expiresAt })),
    gaps: gaps.map((g) => ({ label: g.label, kind: g.kind })),
    existingTitles: [...ideas.map((i) => i.title), ...pending.map((p) => p.title)],
  };
}
