import type { ContentType, FunnelStage } from "@prisma/client";
import { hookFor } from "@/lib/competitors/idea-rules";
import {
  CTA_BY_FUNNEL,
  COST_BY_EASE,
  EASE_BY_FORMAT,
  METRICS_BY_OBJECTIVE,
  OBJECTIVE_BY_FUNNEL,
  emptyDraft,
  notDuplicate,
  pickBy,
  priorityFrom,
  tr,
  type IdeaContext,
  type IdeaDraft,
  type L,
} from "./idea-draft";

/** Rule-based trend/search ideas and original ideas (fallback when AI is disabled or fails). */

const QUESTION_RE = /^(how|what|why|when|where|which|who|can|is|are|do|does|should|كيف|ما|ماذا|لماذا|متى|أين|هل|كم|أي)\b|\?|؟/i;
const COMMERCIAL_RE = /(price|cost|cheap|best|vs|review|compare|offer|discount|installment|سعر|أسعار|تكلفة|أفضل|مقارنة|عرض|خصم|تقسيط)/i;
const TRANSACTIONAL_RE = /(buy|order|book|near me|shop|delivery|اشتري|شراء|اطلب|احجز|توصيل|قريب)/i;
const SEASONAL_RE = /(ramadan|eid|christmas|new year|black friday|white friday|summer|winter|back to school|valentine|mother'?s day|رمضان|عيد|الجمعة البيضاء|الصيف|الشتاء|المدارس|رأس السنة|عيد الأم)/i;

export function searchIntent(keyword: string): "Informational" | "Commercial" | "Transactional" {
  if (TRANSACTIONAL_RE.test(keyword)) return "Transactional";
  if (COMMERCIAL_RE.test(keyword)) return "Commercial";
  return "Informational";
}

const INTENT_LABEL: Record<string, L> = {
  Informational: { en: "Informational", ar: "معلوماتية" },
  Commercial: { en: "Commercial", ar: "تجارية (مقارنة)" },
  Transactional: { en: "Transactional", ar: "شرائية" },
};

const ANGLE_BY_KIND: Record<string, L> = {
  QUESTION: { en: "{kw}? — the straight answer", ar: "{kw}؟ — الإجابة المباشرة" },
  RISING: { en: "{kw}: what's behind the buzz", ar: "{kw}: ما وراء الاهتمام المتزايد" },
  SEARCH: { en: "{kw}: the practical guide", ar: "{kw}: الدليل العملي" },
  TOPIC: { en: "{kw} explained in 60 seconds", ar: "{kw} في 60 ثانية" },
  INTEREST: { en: "For fans of {kw}", ar: "لعشاق {kw}" },
  SOCIAL: { en: "Our version of the {kw} trend", ar: "نسختنا من ترند {kw}" },
  HOOK: { en: "Using the “{kw}” hook for our story", ar: "توظيف أسلوب «{kw}» لقصتنا" },
  FORMAT: { en: "{kw} format, our content", ar: "بصيغة {kw} وبمحتوانا" },
  NEWS: { en: "Timely: {kw}", ar: "في الوقت المناسب: {kw}" },
  SEASONAL: { en: "{kw}: seasonal edition", ar: "{kw}: نسخة الموسم" },
};

const FORMAT_BY_INTENT: Record<string, ContentType> = { Informational: "CAROUSEL", Commercial: "REEL", Transactional: "STORY" };
const FUNNEL_BY_INTENT: Record<string, FunnelStage> = { Informational: "AWARENESS", Commercial: "CONSIDERATION", Transactional: "CONVERSION" };

const OUTLINE: Record<string, L> = {
  Informational: { en: "1) The question in the searcher's words 2) Short, accurate answer 3) One expert tip 4) Soft CTA to save/follow", ar: "1) السؤال بكلمات الباحث 2) إجابة قصيرة ودقيقة 3) نصيحة خبير 4) دعوة لطيفة للحفظ أو المتابعة" },
  Commercial: { en: "1) What people compare 2) Honest criteria 3) Where our offer fits 4) CTA to message for advice", ar: "1) ما يقارنه الناس 2) معايير صادقة للاختيار 3) أين يناسب عرضنا 4) دعوة للمراسلة للاستشارة" },
  Transactional: { en: "1) The need, right now 2) How to get it from us (steps) 3) Proof / guarantee 4) Direct CTA", ar: "1) الحاجة الآن 2) خطوات الحصول عليها منا 3) إثبات أو ضمان 4) دعوة مباشرة لاتخاذ إجراء" },
};

const VISUAL: Record<string, L> = {
  CAROUSEL: { en: "Clean brand template, one idea per slide, bold keyword on the cover", ar: "قالب براند نظيف، فكرة واحدة لكل شريحة، والكلمة المفتاحية بخط عريض على الغلاف" },
  REEL: { en: "Fast native cuts, face to camera, captions burned in", ar: "لقطات سريعة بأسلوب طبيعي، حديث مباشر للكاميرا، ونصوص مدمجة" },
  STORY: { en: "Vertical, interactive sticker, product close-up", ar: "تصميم عمودي، ستيكر تفاعلي، ولقطة قريبة للمنتج" },
  SHORT: { en: "Vertical 30s, hook text in first frame", ar: "فيديو عمودي 30 ثانية، ونص الجذب في أول إطار" },
  VIDEO: { en: "Documentary style, real people and places", ar: "أسلوب وثائقي، أشخاص وأماكن حقيقية" },
  DEFAULT: { en: "On-brand visuals with a single focal point", ar: "تصميم متوافق مع البراند بنقطة تركيز واحدة" },
};

export function trendIdeasByRules(ctx: IdeaContext, count: number, now = new Date()): IdeaDraft[] {
  const lc = ctx.locale;
  const fresh = notDuplicate(ctx.existingTitles);
  const products = ctx.client.products.length ? ctx.client.products : [ctx.client.name];
  const live = ctx.signals
    .filter((s) => !s.expiresAt || s.expiresAt >= now)
    .sort((a, b) => (b.growthPct ?? -1) - (a.growthPct ?? -1));
  const out: IdeaDraft[] = [];
  for (const [i, s] of live.entries()) {
    if (out.length >= count) break;
    const intent = s.kind === "QUESTION" || QUESTION_RE.test(s.keyword) ? "Informational" : searchIntent(s.keyword);
    const format = s.kind === "FORMAT" ? "REEL" : FORMAT_BY_INTENT[intent];
    const funnel = FUNNEL_BY_INTENT[intent];
    const title = tr(ANGLE_BY_KIND[s.kind] ?? ANGLE_BY_KIND.SEARCH, lc, { kw: s.keyword });
    if (!fresh(title)) continue;
    const growth = s.growthPct;
    const ease = EASE_BY_FORMAT[format];
    const impact = growth == null ? 3 : growth >= 1 ? 5 : growth >= 0.3 ? 4 : growth > 0 ? 3 : 2;
    const objective = OBJECTIVE_BY_FUNNEL(funnel, ctx.client.conversionObjective);
    const product = pickBy(products, i)!;
    const audience = pickBy(ctx.client.audiences, i) ?? null;
    const validUntil = s.expiresAt ?? new Date(s.discoveredAt.getTime() + 30 * 86_400_000);
    const seasonal = s.kind === "SEASONAL" || SEASONAL_RE.test(s.keyword);
    out.push({
      ...emptyDraft(),
      title,
      reason:
        growth != null
          ? tr({ en: "“{kw}” is {dir} {g}% on {src} (signal discovered {d}).", ar: "«{kw}» {dir} بنسبة {g}% على {src} (رُصدت الإشارة في {d})." }, lc, {
              kw: s.keyword,
              dir: growth >= 0 ? (lc === "ar" ? "في ارتفاع" : "up") : lc === "ar" ? "في انخفاض" : "down",
              g: Math.round(Math.abs(growth) * 100),
              src: s.sourceName,
              d: s.discoveredAt.toISOString().slice(0, 10),
            })
          : tr({ en: "“{kw}” appears in {src} (signal discovered {d}).", ar: "«{kw}» ظاهرة في {src} (رُصدت الإشارة في {d})." }, lc, { kw: s.keyword, src: s.sourceName, d: s.discoveredAt.toISOString().slice(0, 10) }),
      signalSource: s.sourceName,
      signalGrowth: growth,
      validUntil: validUntil.toISOString().slice(0, 10),
      keyword: s.keyword,
      searchIntent: tr(INTENT_LABEL[intent], lc),
      platform: intent === "Informational" ? "INSTAGRAM" : i % 2 ? "TIKTOK" : "INSTAGRAM",
      format,
      audience,
      objective,
      funnelStage: funnel,
      hook: hookFor(funnel, i, lc, { product, audience: audience ?? product }),
      cta: tr(CTA_BY_FUNNEL[funnel], lc),
      captionOutline: tr(OUTLINE[intent], lc),
      visualDirection: tr(VISUAL[format] ?? VISUAL.DEFAULT, lc),
      priority: priorityFrom(ease, impact),
      ease,
      impact,
      costEstimate: tr(COST_BY_EASE(ease), lc),
      successMetrics: (METRICS_BY_OBJECTIVE[objective] ?? []).map((m) => tr(m, lc)),
      isSeasonal: seasonal,
      isEvergreen: !seasonal && s.kind !== "NEWS",
      confidence: growth == null ? 0.45 : 0.6,
    });
  }
  return out;
}

const ORIGINAL_TEMPLATES: { title: L; format: ContentType; funnel: FunnelStage; impact: number }[] = [
  { title: { en: "Myth vs fact: {topic}", ar: "خرافة أم حقيقة: {topic}" }, format: "CAROUSEL", funnel: "AWARENESS", impact: 4 },
  { title: { en: "Behind the scenes of {topic}", ar: "كواليس {topic}" }, format: "REEL", funnel: "AWARENESS", impact: 4 },
  { title: { en: "Customer story: {topic}", ar: "قصة عميل: {topic}" }, format: "VIDEO", funnel: "CONSIDERATION", impact: 5 },
  { title: { en: "{topic} in 60 seconds", ar: "{topic} في 60 ثانية" }, format: "SHORT", funnel: "AWARENESS", impact: 3 },
  { title: { en: "Buyer's guide: choosing {topic}", ar: "دليل الشراء: كيف تختار {topic}" }, format: "CAROUSEL", funnel: "CONSIDERATION", impact: 4 },
  { title: { en: "Your questions about {topic}, answered", ar: "إجابات أسئلتكم عن {topic}" }, format: "LIVE", funnel: "CONSIDERATION", impact: 4 },
  { title: { en: "The {topic} checklist (free download)", ar: "قائمة تحقق {topic} (تحميل مجاني)" }, format: "LEAD_FORM", funnel: "CONVERSION", impact: 4 },
  { title: { en: "Show us your {topic} — community challenge", ar: "شاركنا {topic} الخاص بك — تحدي المجتمع" }, format: "REEL", funnel: "ADVOCACY", impact: 3 },
  { title: { en: "Expert tip of the week: {topic}", ar: "نصيحة الخبير الأسبوعية: {topic}" }, format: "STORY", funnel: "RETENTION", impact: 3 },
  { title: { en: "Honest comparison: {topic} options", ar: "مقارنة صادقة: خيارات {topic}" }, format: "VIDEO", funnel: "CONSIDERATION", impact: 4 },
  { title: { en: "A day with the team behind {topic}", ar: "يوم مع الفريق وراء {topic}" }, format: "REEL", funnel: "AWARENESS", impact: 3 },
  { title: { en: "Care & aftercare guide: {topic}", ar: "دليل العناية والمتابعة: {topic}" }, format: "CAROUSEL", funnel: "RETENTION", impact: 3 },
];

export function originalIdeasByRules(ctx: IdeaContext, count: number): IdeaDraft[] {
  const lc = ctx.locale;
  const fresh = notDuplicate(ctx.existingTitles);
  // Topics: content gaps first (strongest reason), then pillars, then products.
  const topics: { topic: string; reason: string }[] = [
    ...ctx.gaps.map((g) => ({
      topic: g.label,
      reason: tr(
        g.kind === "WHITE_SPACE"
          ? { en: "White space: “{t}” is one of our pillars and no tracked competitor covers it.", ar: "مساحة فارغة: «{t}» من محاور محتوانا ولا يغطيها أي منافس متابَع." }
          : g.kind === "UNTAPPED"
            ? { en: "Untapped opportunity noted in competitor analysis: “{t}”.", ar: "فرصة غير مستغلة رُصدت في تحليل المنافسين: «{t}»." }
            : g.kind === "FORMAT"
              ? { en: "Competitors use the {t} format and we don't yet.", ar: "المنافسون يستخدمون صيغة {t} ونحن لا نستخدمها بعد." }
              : { en: "Competitors own the “{t}” topic; we can add our own angle.", ar: "المنافسون يسيطرون على موضوع «{t}»؛ يمكننا تقديم زاويتنا الخاصة." },
        lc,
        { t: g.label },
      ),
    })),
    ...ctx.client.pillars.map((p) => ({ topic: p, reason: tr({ en: "Supports the “{t}” content pillar in the strategy.", ar: "يدعم محور المحتوى «{t}» في الاستراتيجية." }, lc, { t: p }) })),
    ...ctx.client.products.map((p) => ({ topic: p, reason: tr({ en: "Evergreen education around a core product: {t}.", ar: "محتوى تعليمي دائم حول منتج أساسي: {t}." }, lc, { t: p }) })),
  ];
  if (!topics.length) topics.push({ topic: ctx.client.name, reason: tr({ en: "Brand-building evergreen content.", ar: "محتوى دائم لبناء البراند." }, lc) });

  const out: IdeaDraft[] = [];
  for (let i = 0; out.length < count && i < topics.length * ORIGINAL_TEMPLATES.length; i++) {
    const t = topics[i % topics.length];
    const tpl = ORIGINAL_TEMPLATES[(i + Math.floor(i / topics.length)) % ORIGINAL_TEMPLATES.length];
    const title = tr(tpl.title, lc, { topic: t.topic });
    if (!fresh(title)) continue;
    const ease = EASE_BY_FORMAT[tpl.format];
    const objective = OBJECTIVE_BY_FUNNEL(tpl.funnel, ctx.client.conversionObjective);
    const product = pickBy(ctx.client.products, i) ?? t.topic;
    const audience = pickBy(ctx.client.audiences, i) ?? null;
    out.push({
      ...emptyDraft(),
      title,
      reason: t.reason,
      platform: tpl.format === "LIVE" || tpl.format === "LEAD_FORM" ? "FACEBOOK" : i % 3 === 2 ? "TIKTOK" : "INSTAGRAM",
      format: tpl.format,
      audience,
      objective,
      funnelStage: tpl.funnel,
      hook: hookFor(tpl.funnel, i, lc, { product, audience: audience ?? product }),
      cta: tr(CTA_BY_FUNNEL[tpl.funnel], lc),
      captionOutline: tr(OUTLINE[tpl.funnel === "CONVERSION" ? "Transactional" : tpl.funnel === "CONSIDERATION" ? "Commercial" : "Informational"], lc),
      visualDirection: tr(VISUAL[tpl.format] ?? VISUAL.DEFAULT, lc),
      priority: priorityFrom(ease, tpl.impact),
      ease,
      impact: tpl.impact,
      costEstimate: tr(COST_BY_EASE(ease), lc),
      successMetrics: (METRICS_BY_OBJECTIVE[objective] ?? []).map((m) => tr(m, lc)),
      isEvergreen: true,
      confidence: 0.5,
    });
  }
  return out;
}
