import "server-only";
import { z } from "zod";
import { aiEnabled, generateStructured, AiError } from "@/lib/ai/claude";
import { competitorIdeasByRules } from "@/lib/competitors/idea-rules";
import { trendIdeasByRules, originalIdeasByRules } from "@/lib/trends/idea-rules";
import { ideaDraftSchema, sanitizeDraft, type IdeaContext, type IdeaDraft, type IdeaSourceKey } from "@/lib/trends/idea-draft";

/**
 * Content-idea generation for the Competitor Idea Bank and the Trends & Opportunities Center.
 * Claude is used when enabled (and the user may use AI); otherwise — or if the call fails — the
 * deterministic rule-based engines produce ideas from the same tenant-scoped evidence.
 * Results are NOT saved as ideas here: callers store them as PENDING AiRecommendation rows.
 */

export type IdeaRun = { drafts: IdeaDraft[]; engine: "ai" | "rules"; aiStatus: "OK" | "DISABLED" | "FAILED" | "REFUSED" | "RATE_LIMITED" };

const TASKS: Record<IdeaSourceKey, string> = {
  COMPETITOR:
    "Generate competitor-inspired content ideas. Base each one on a concrete item in data.ads or data.posts (long-running, multi-variant, relaunched ads and top posts are the strongest evidence). " +
    "For each idea: competitorName = the competitor it came from; originalIdea = a neutral one-sentence description of THEIR concept in your own words; " +
    "whyItWorked = the evidence-based reason it likely worked (cite running days / variants / engagements from data, label it as an inference); " +
    "ourTwist = how the client can adapt the underlying idea to its own positioning WITHOUT copying. Leave signal fields null.",
  TREND:
    "Generate trend/search-based content ideas, one per relevant item in data.signals (prefer rising, still-valid signals). " +
    "For each idea: keyword = the signal keyword; signalSource = its sourceName; signalGrowth = its growthPct exactly as given (null if null); " +
    "validUntil = its expiresAt date (yyyy-mm-dd) or null; searchIntent = Informational / Commercial / Transactional (in the requested language). Leave competitor fields null.",
  ORIGINAL:
    "Generate original content ideas that are not derived from a specific competitor post or trend: build on data.client.pillars, data.client.products, data.client.audiences and the content gaps in data.gaps (white space first). " +
    "Leave competitor and signal fields null; reason must name the gap or pillar the idea serves.",
};

const COMMON =
  " NEVER copy competitor text verbatim — do not reuse their headlines, captions, hooks or slogans; every hook, CTA and caption outline must be original. " +
  "Do not invent numbers: growth, engagement and running-day figures may only be quoted from the data. " +
  "Fill every other field: title (short), reason (why suggested, citing the data), platform, format, audience (from client audiences), objective, funnelStage, hook, cta, captionOutline (numbered beats), visualDirection, " +
  "priority, ease and impact (integers 1–5, ease = how easy to produce), costEstimate (Low / Medium / High in the requested language), successMetrics (2–3 KPI names), isSeasonal, isEvergreen, confidence (0–1). " +
  "Do not repeat any title in data.existingTitles.";

export async function generateIdeas(opts: { source: IdeaSourceKey; ctx: IdeaContext; count: number; allowAi: boolean }): Promise<IdeaRun> {
  const count = Math.min(Math.max(opts.count, 1), 12);
  let aiStatus: IdeaRun["aiStatus"] = "DISABLED";
  if (opts.allowAi && aiEnabled()) {
    try {
      const r = await generateStructured({
        schema: z.object({ ideas: z.array(ideaDraftSchema) }),
        locale: opts.ctx.locale,
        effort: "medium",
        data: {
          client: opts.ctx.client,
          competitors: opts.source === "TREND" ? undefined : opts.ctx.competitors,
          ads: opts.source === "COMPETITOR" ? opts.ctx.ads.slice(0, 60) : undefined,
          posts: opts.source === "COMPETITOR" ? opts.ctx.posts.slice(0, 40) : undefined,
          signals: opts.source === "TREND" ? opts.ctx.signals.slice(0, 50) : undefined,
          gaps: opts.source === "ORIGINAL" ? opts.ctx.gaps : undefined,
          existingTitles: opts.ctx.existingTitles.slice(0, 200),
        },
        task: `${TASKS[opts.source]} Return exactly ${count} ideas (fewer only if the data cannot support them).${COMMON}`,
      });
      const drafts = r.ideas.slice(0, count).map(sanitizeDraft);
      if (opts.source !== "COMPETITOR") drafts.forEach((d) => ((d.competitorName = null), (d.originalIdea = null), (d.whyItWorked = null), (d.ourTwist = null)));
      if (drafts.length) return { drafts, engine: "ai", aiStatus: "OK" };
      aiStatus = "FAILED";
    } catch (e) {
      aiStatus = e instanceof AiError ? (e.code === "DISABLED" ? "DISABLED" : e.code) : "FAILED";
    }
  }
  const rules = opts.source === "COMPETITOR" ? competitorIdeasByRules : opts.source === "TREND" ? trendIdeasByRules : originalIdeasByRules;
  return { drafts: rules(opts.ctx, count).map(sanitizeDraft), engine: "rules", aiStatus };
}
