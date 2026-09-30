import { z } from "zod";
import type { ContentType, FunnelStage, Objective, Platform, Priority } from "@prisma/client";

/**
 * A generated (not yet accepted) content idea. Produced by Claude or by the rule-based engines,
 * stored as a PENDING AiRecommendation, and turned into an `Idea` row only when a human accepts it.
 */

const PLATFORMS = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "LINKEDIN", "YOUTUBE", "X"] as const;
const FORMATS = ["IMAGE", "VIDEO", "REEL", "STORY", "CAROUSEL", "TEXT", "ARTICLE", "LIVE", "SHORT", "LEAD_FORM"] as const;
const OBJECTIVES = ["AWARENESS", "REACH", "TRAFFIC", "ENGAGEMENT", "VIDEO_VIEWS", "LEADS", "SALES", "APP_INSTALLS", "MESSAGES"] as const;
const FUNNELS = ["AWARENESS", "CONSIDERATION", "CONVERSION", "RETENTION", "ADVOCACY"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** Loose schema (no numeric/length constraints) — also used as the Claude structured-output schema. */
export const ideaDraftSchema = z.object({
  title: z.string(),
  reason: z.string(),
  competitorName: z.string().nullable(),
  originalIdea: z.string().nullable(),
  whyItWorked: z.string().nullable(),
  ourTwist: z.string().nullable(),
  signalSource: z.string().nullable(),
  signalGrowth: z.number().nullable(),
  validUntil: z.string().nullable(),
  keyword: z.string().nullable(),
  searchIntent: z.string().nullable(),
  platform: z.enum(PLATFORMS).nullable(),
  format: z.enum(FORMATS).nullable(),
  audience: z.string().nullable(),
  objective: z.enum(OBJECTIVES).nullable(),
  funnelStage: z.enum(FUNNELS).nullable(),
  hook: z.string().nullable(),
  cta: z.string().nullable(),
  captionOutline: z.string().nullable(),
  visualDirection: z.string().nullable(),
  priority: z.enum(PRIORITIES),
  ease: z.number(),
  impact: z.number(),
  costEstimate: z.string().nullable(),
  successMetrics: z.array(z.string()),
  isSeasonal: z.boolean(),
  isEvergreen: z.boolean(),
  confidence: z.number(),
});

export type IdeaDraft = z.infer<typeof ideaDraftSchema>;
export type IdeaSourceKey = "COMPETITOR" | "TREND" | "ORIGINAL";

const clip = (s: string | null | undefined, n: number) => (s == null ? null : s.trim().slice(0, n) || null);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/** Normalise any draft (AI or rules) before it is stored: lengths, ranges, dates. */
export function sanitizeDraft(d: IdeaDraft): IdeaDraft {
  const valid = d.validUntil && /^\d{4}-\d{2}-\d{2}/.test(d.validUntil) && !Number.isNaN(new Date(d.validUntil).getTime()) ? d.validUntil.slice(0, 10) : null;
  return {
    ...d,
    title: (clip(d.title, 200) ?? "—") as string,
    reason: (clip(d.reason, 1000) ?? "") as string,
    competitorName: clip(d.competitorName, 120),
    originalIdea: clip(d.originalIdea, 500),
    whyItWorked: clip(d.whyItWorked, 500),
    ourTwist: clip(d.ourTwist, 800),
    signalSource: clip(d.signalSource, 120),
    signalGrowth: d.signalGrowth != null && Number.isFinite(d.signalGrowth) ? d.signalGrowth : null,
    validUntil: valid,
    keyword: clip(d.keyword, 120),
    searchIntent: clip(d.searchIntent, 60),
    audience: clip(d.audience, 200),
    hook: clip(d.hook, 300),
    cta: clip(d.cta, 120),
    captionOutline: clip(d.captionOutline, 1000),
    visualDirection: clip(d.visualDirection, 600),
    ease: clamp(d.ease, 1, 5),
    impact: clamp(d.impact, 1, 5),
    costEstimate: clip(d.costEstimate, 60),
    successMetrics: d.successMetrics.map((m) => m.trim().slice(0, 60)).filter(Boolean).slice(0, 6),
    confidence: Math.min(1, Math.max(0, Number.isFinite(d.confidence) ? d.confidence : 0.5)),
  };
}

/** Everything the generators may use — always tenant-scoped to one client by the caller. */
export type IdeaContext = {
  locale: "ar" | "en";
  client: { name: string; industry: string | null; country: string | null; products: string[]; audiences: string[]; pillars: string[]; conversionObjective: Objective };
  competitors: { name: string; pillars: string[]; contentTypes: string[]; weaknesses: string[]; opportunities: string[] }[];
  ads: { competitor: string; platform: Platform; format: ContentType | null; creativeIdea: string | null; offer: string | null; product: string | null; funnelGuess: FunnelStage | null; runningDays: number; variantCount: number; isActive: boolean; relaunched: boolean }[];
  posts: { competitor: string; platform: Platform; type: ContentType | null; topic: string | null; occasion: string | null; engagements: number | null; isTopPost: boolean }[];
  signals: { keyword: string; kind: string; sourceName: string; growthPct: number | null; discoveredAt: Date; expiresAt: Date | null }[];
  gaps: { label: string; kind: "COMPETITOR_ONLY" | "WHITE_SPACE" | "FORMAT" | "UNTAPPED" }[];
  existingTitles: string[];
};

// ── Small bilingual helpers shared by the rule-based generators ──────────────────────────────

export type L = { en: string; ar: string };
export const tr = (l: L, locale: "ar" | "en", vars: Record<string, string | number> = {}) => {
  let s = l[locale];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

export const CTA_BY_FUNNEL: Record<FunnelStage, L> = {
  AWARENESS: { en: "Follow for more", ar: "تابعنا للمزيد" },
  CONSIDERATION: { en: "Send us a message", ar: "راسلنا الآن" },
  CONVERSION: { en: "Order / book now", ar: "اطلب أو احجز الآن" },
  RETENTION: { en: "Share your experience", ar: "شاركنا تجربتك" },
  ADVOCACY: { en: "Tag a friend who needs this", ar: "منشن صديقًا يحتاج هذا" },
};

export const METRICS_BY_OBJECTIVE: Record<string, L[]> = {
  AWARENESS: [{ en: "Reach", ar: "الوصول" }, { en: "3-sec video views", ar: "مشاهدات 3 ثوانٍ" }],
  REACH: [{ en: "Reach", ar: "الوصول" }, { en: "Frequency", ar: "معدل التكرار" }],
  TRAFFIC: [{ en: "CTR", ar: "نسبة النقر" }, { en: "Landing page views", ar: "زيارات صفحة الهبوط" }],
  ENGAGEMENT: [{ en: "Saves", ar: "الحفظ" }, { en: "Shares", ar: "المشاركات" }, { en: "Engagement rate", ar: "معدل التفاعل" }],
  VIDEO_VIEWS: [{ en: "ThruPlays", ar: "المشاهدات الكاملة" }, { en: "Completion rate", ar: "نسبة الإكمال" }],
  LEADS: [{ en: "Leads", ar: "العملاء المحتملون" }, { en: "Cost per lead", ar: "تكلفة العميل المحتمل" }],
  SALES: [{ en: "Purchases", ar: "المشتريات" }, { en: "ROAS", ar: "العائد على الإنفاق" }],
  MESSAGES: [{ en: "Conversations started", ar: "المحادثات المبدوءة" }, { en: "Cost per conversation", ar: "تكلفة المحادثة" }],
  APP_INSTALLS: [{ en: "Installs", ar: "التثبيتات" }],
};

export const EASE_BY_FORMAT: Record<ContentType, number> = { IMAGE: 5, TEXT: 5, STORY: 4, CAROUSEL: 4, LEAD_FORM: 4, SHORT: 3, REEL: 3, LIVE: 3, ARTICLE: 3, VIDEO: 2 };

export const COST_BY_EASE = (ease: number): L =>
  ease >= 4 ? { en: "Low", ar: "منخفضة" } : ease === 3 ? { en: "Medium", ar: "متوسطة" } : { en: "High", ar: "مرتفعة" };

export const OBJECTIVE_BY_FUNNEL = (f: FunnelStage, conversion: Objective): Objective =>
  f === "AWARENESS" ? "REACH" : f === "CONSIDERATION" ? "ENGAGEMENT" : f === "CONVERSION" ? conversion : "ENGAGEMENT";

export const priorityFrom = (ease: number, impact: number): Priority => (impact >= 4 && ease >= 3 ? "HIGH" : impact + ease >= 7 ? "MEDIUM" : "LOW");

/** Platform + format best suited for an ad observed on META. */
export const organicPlatform = (p: Platform): IdeaDraft["platform"] =>
  p === "META" || p === "FACEBOOK" ? "INSTAGRAM" : (["INSTAGRAM", "TIKTOK", "LINKEDIN", "YOUTUBE", "X"] as const).find((x) => x === p) ?? "INSTAGRAM";

export const pickBy = <T,>(xs: T[], i: number): T | undefined => (xs.length ? xs[i % xs.length] : undefined);

export const emptyDraft = (): IdeaDraft => ({
  title: "",
  reason: "",
  competitorName: null,
  originalIdea: null,
  whyItWorked: null,
  ourTwist: null,
  signalSource: null,
  signalGrowth: null,
  validUntil: null,
  keyword: null,
  searchIntent: null,
  platform: null,
  format: null,
  audience: null,
  objective: null,
  funnelStage: null,
  hook: null,
  cta: null,
  captionOutline: null,
  visualDirection: null,
  priority: "MEDIUM",
  ease: 3,
  impact: 3,
  costEstimate: null,
  successMetrics: [],
  isSeasonal: false,
  isEvergreen: false,
  confidence: 0.5,
});

export const notDuplicate = (existing: string[]) => {
  const seen = new Set(existing.map((s) => s.trim().toLowerCase()));
  return (title: string) => {
    const k = title.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
};
