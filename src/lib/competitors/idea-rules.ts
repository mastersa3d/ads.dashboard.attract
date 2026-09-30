import type { ContentType, FunnelStage } from "@prisma/client";
import {
  CTA_BY_FUNNEL,
  COST_BY_EASE,
  EASE_BY_FORMAT,
  METRICS_BY_OBJECTIVE,
  OBJECTIVE_BY_FUNNEL,
  emptyDraft,
  notDuplicate,
  organicPlatform,
  pickBy,
  priorityFrom,
  tr,
  type IdeaContext,
  type IdeaDraft,
  type L,
} from "@/lib/trends/idea-draft";

/**
 * Rule-based competitor-inspired ideas (used when AI is disabled or fails).
 * Evidence = long-running / multi-variant competitor ads and their top posts. We describe the
 * competitor's *idea* in our own words and never reuse their copy (hooks/bodies are not read).
 */

const TWIST_BY_FORMAT: Partial<Record<ContentType, L>> & { DEFAULT: L } = {
  VIDEO: { en: "Re-shoot the concept with real {client} customers and {product}; open with a proof moment in the first 2 seconds and keep our own voice and visual identity.", ar: "أعد تنفيذ الفكرة مع عملاء {client} الحقيقيين و{product}؛ ابدأ بلحظة إثبات في أول ثانيتين مع الحفاظ على صوت وهوية البراند." },
  REEL: { en: "Turn it into a native 15–20s reel featuring {product}, with on-screen captions and a behind-the-scenes angle only we can show.", ar: "حوّلها إلى ريل قصير 15–20 ثانية يعرض {product} مع نصوص على الشاشة وزاوية من الكواليس لا يملكها غيرنا." },
  CAROUSEL: { en: "Build a save-worthy carousel: problem → 3 practical tips → {product} as the solution, using our brand templates.", ar: "صمّم كاروسيل يستحق الحفظ: المشكلة ← 3 نصائح عملية ← {product} كحل، بقوالب البراند الخاصة بنا." },
  IMAGE: { en: "Keep the single strong visual, but lead with a customer benefit and a real photo of {product} instead of a generic price tag.", ar: "حافظ على صورة واحدة قوية، لكن ابدأ بفائدة للعميل وصورة حقيقية لـ{product} بدلًا من ملصق السعر التقليدي." },
  STORY: { en: "Make it interactive: a poll or quiz sticker about {product} followed by a direct-message CTA.", ar: "اجعلها تفاعلية: ستيكر تصويت أو اختبار عن {product} يليه زر للمراسلة المباشرة." },
  LEAD_FORM: { en: "Offer a genuinely useful asset (guide, checklist or free consultation) in exchange for the lead instead of a discount.", ar: "قدّم قيمة حقيقية (دليل أو قائمة تحقق أو استشارة مجانية) مقابل بيانات العميل بدلًا من الخصم." },
  DEFAULT: { en: "Adapt the underlying idea to {client}'s positioning, proof points and tone — no reuse of the competitor's wording or visuals.", ar: "طوّع الفكرة الأساسية لتموضع {client} ونقاط الإثبات ونبرة البراند — دون استخدام كلمات أو تصاميم المنافس." },
};

const HOOKS: Record<FunnelStage, L[]> = {
  AWARENESS: [
    { en: "Most people get this wrong about {product}…", ar: "أغلب الناس يخطئون في هذا عند اختيار {product}…" },
    { en: "3 seconds to see why {audience} love this", ar: "3 ثوانٍ لتعرف لماذا يحب {audience} هذا" },
  ],
  CONSIDERATION: [
    { en: "Before you choose {product}, watch this", ar: "قبل أن تختار {product} شاهد هذا" },
    { en: "The honest comparison nobody shows you", ar: "المقارنة الصادقة التي لا يعرضها أحد" },
  ],
  CONVERSION: [
    { en: "Ready when you are — here's how to get {product} this week", ar: "جاهزون متى كنت جاهزًا — هكذا تحصل على {product} هذا الأسبوع" },
    { en: "What you get, what it costs, no surprises", ar: "ماذا ستحصل عليه وكم سيكلفك، بلا مفاجآت" },
  ],
  RETENTION: [{ en: "Get more from your {product} with this tip", ar: "استفد أكثر من {product} بهذه النصيحة" }],
  ADVOCACY: [{ en: "Our customers said it better than we could", ar: "عملاؤنا قالوها أفضل منا" }],
};

export const hookFor = (f: FunnelStage, i: number, locale: "ar" | "en", vars: Record<string, string>) => tr(pickBy(HOOKS[f], i)!, locale, vars);

export function competitorIdeasByRules(ctx: IdeaContext, count: number): IdeaDraft[] {
  const lc = ctx.locale;
  const fresh = notDuplicate(ctx.existingTitles);
  const out: IdeaDraft[] = [];
  const products = ctx.client.products.length ? ctx.client.products : [ctx.client.name];

  type Evidence = { competitor: string; label: string; format: ContentType; funnel: FunnelStage; platform: IdeaDraft["platform"]; why: string; strength: number; offer: string | null; product: string | null };
  const evidence: Evidence[] = [];

  for (const a of ctx.ads) {
    if (!a.creativeIdea) continue;
    const strength = Math.min(1, a.runningDays / 60) * 0.6 + Math.min(1, a.variantCount / 6) * 0.3 + (a.relaunched ? 0.1 : 0);
    evidence.push({
      competitor: a.competitor,
      label: a.creativeIdea,
      format: a.format ?? "IMAGE",
      funnel: a.funnelGuess ?? "CONSIDERATION",
      platform: organicPlatform(a.platform),
      why: tr(
        a.relaunched
          ? { en: "Ran {days} days with {v} variants and was relaunched — advertisers rarely keep funding or relaunch ads that don't perform (inference from ad-library data).", ar: "استمر {days} يومًا بعدد {v} نسخ وأعيد إطلاقه — نادرًا ما يستمر المعلن في تمويل إعلان لا يحقق نتائج (استنتاج من بيانات مكتبة الإعلانات)." }
          : { en: "Ran {days} days with {v} variants — long runs usually signal the ad pays back (inference from ad-library data).", ar: "استمر {days} يومًا بعدد {v} نسخ — الاستمرار الطويل يشير عادةً إلى أن الإعلان مربح (استنتاج من بيانات مكتبة الإعلانات)." },
        lc,
        { days: a.runningDays, v: a.variantCount },
      ),
      strength,
      offer: a.offer,
      product: a.product,
    });
  }
  for (const p of ctx.posts) {
    if (!p.topic || !(p.isTopPost || (p.engagements ?? 0) > 0)) continue;
    evidence.push({
      competitor: p.competitor,
      label: p.topic,
      format: p.type ?? "REEL",
      funnel: "AWARENESS",
      platform: organicPlatform(p.platform),
      why: tr({ en: "One of their top organic posts ({n} engagements){occ}.", ar: "من أفضل منشوراتهم العضوية ({n} تفاعل){occ}." }, lc, {
        n: p.engagements ?? "—",
        occ: p.occasion ? (lc === "ar" ? ` في مناسبة ${p.occasion}` : ` during ${p.occasion}`) : "",
      }),
      strength: p.isTopPost ? 0.7 : Math.min(0.6, (p.engagements ?? 0) / 10000),
      offer: null,
      product: null,
    });
  }
  // strongest first, one idea per (competitor, label)
  evidence.sort((a, b) => b.strength - a.strength);
  const used = new Set<string>();
  for (const [i, e] of evidence.entries()) {
    if (out.length >= count) break;
    const k = `${e.competitor}|${e.label}`.toLowerCase();
    if (used.has(k)) continue;
    used.add(k);
    const product = e.product && products.some((p) => p.toLowerCase() === e.product!.toLowerCase()) ? e.product : pickBy(products, i)!;
    const audience = pickBy(ctx.client.audiences, i) ?? (lc === "ar" ? "جمهورنا" : "our audience");
    const title = tr({ en: "Our take on “{idea}”", ar: "رؤيتنا الخاصة لفكرة «{idea}»" }, lc, { idea: e.label });
    if (!fresh(title)) continue;
    const ease = EASE_BY_FORMAT[e.format];
    const impact = Math.max(2, Math.min(5, Math.round(2 + e.strength * 3)));
    const objective = OBJECTIVE_BY_FUNNEL(e.funnel, ctx.client.conversionObjective);
    out.push({
      ...emptyDraft(),
      title,
      reason: tr({ en: "Inspired by a proven concept from {c}; adapted to our own positioning.", ar: "مستوحاة من فكرة أثبتت نجاحها لدى {c}، ومطوّعة لتموضعنا الخاص." }, lc, { c: e.competitor }),
      competitorName: e.competitor,
      originalIdea: tr({ en: "{c} used a {format} built around “{idea}”{offer}.", ar: "استخدم {c} محتوى من نوع {format} قائمًا على فكرة «{idea}»{offer}." }, lc, {
        c: e.competitor,
        format: e.format.toLowerCase(),
        idea: e.label,
        offer: e.offer ? (lc === "ar" ? ` مع عرض «${e.offer}»` : ` with a “${e.offer}” offer`) : "",
      }),
      whyItWorked: e.why,
      ourTwist: tr(TWIST_BY_FORMAT[e.format] ?? TWIST_BY_FORMAT.DEFAULT, lc, { client: ctx.client.name, product }),
      platform: e.platform,
      format: e.format,
      audience,
      objective,
      funnelStage: e.funnel,
      hook: hookFor(e.funnel, i, lc, { product, audience }),
      cta: tr(CTA_BY_FUNNEL[e.funnel], lc),
      priority: priorityFrom(ease, impact),
      ease,
      impact,
      costEstimate: tr(COST_BY_EASE(ease), lc),
      successMetrics: (METRICS_BY_OBJECTIVE[objective] ?? []).map((m) => tr(m, lc)),
      isEvergreen: true,
      confidence: Math.round((0.4 + e.strength * 0.4) * 100) / 100,
    });
  }
  return out;
}
