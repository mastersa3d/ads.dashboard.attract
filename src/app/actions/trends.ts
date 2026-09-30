"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ContentType, FunnelStage, Objective, Platform, Priority, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, AuthError, type CurrentUser } from "@/lib/auth/session";
import { assertClientAccess } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { getI18n } from "@/lib/i18n/server";
import type { Permission } from "@/lib/rbac";
import { runAction, splitList, formObject, UserError, type ActionState } from "@/lib/competitors/action-result";
import { parseGoogleTrendsCsv } from "@/lib/trends/google-trends-csv";
import { fetchSearchConsoleSignals } from "@/lib/trends/search-console";
import { loadIdeaContext } from "@/lib/trends/idea-context";
import { ideaDraftSchema, sanitizeDraft } from "@/lib/trends/idea-draft";
import { generateIdeas } from "@/lib/ai/ideas";
import { SIGNAL_KINDS } from "@/lib/trends/signals";

const id = z.string().min(1).max(40);
const optStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
const optNum = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? Number(v) : null))
  .refine((v) => v == null || Number.isFinite(v), "number");
const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? new Date(v + "T00:00:00.000Z") : null))
  .refine((v) => v == null || !Number.isNaN(v.getTime()), "date");
const optEnum = <T extends Record<string, string>>(e: T) => z.enum(e).optional().or(z.literal("").transform(() => undefined));
const bool = z.unknown().transform((v) => v === "on" || v === "true" || v === "1");

const IDEA_SOURCES = ["COMPETITOR", "TREND", "ORIGINAL"] as const;
type IdeaSourceKey = (typeof IDEA_SOURCES)[number];

/** Competitor ideas are managed by competitor editors; trend & original ideas by trend editors. */
function ideaPermission(source: IdeaSourceKey): Permission {
  return source === "COMPETITOR" ? "competitors:edit" : "trends:edit";
}

function requirePerm(user: CurrentUser, p: Permission) {
  if (!user.perms.has(p)) throw new AuthError("FORBIDDEN");
}

function revalidate() {
  revalidatePath("/trends");
  revalidatePath("/competitors", "layout");
}

// ── Trend signals ───────────────────────────────────────────────────────────────────────────

const signalSchema = z.object({
  clientId: id,
  keyword: z.string().trim().min(1).max(160),
  kind: z.enum(SIGNAL_KINDS),
  sourceName: z.string().trim().min(1).max(80),
  sourceUrl: optStr(500).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "url"),
  growthPct: optNum, // entered as a percentage
  volumeIndex: optNum.refine((v) => v == null || (v >= 0 && v <= 100), "volumeIndex"),
  expiresAt: optDate,
});

export async function saveSignal(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("saveSignal", async () => {
    const user = await assertUser("trends:edit");
    const d = signalSchema.parse(formObject(fd));
    await assertClientAccess(user, d.clientId);
    const s = await db.trendSignal.create({
      data: {
        clientId: d.clientId,
        keyword: d.keyword,
        kind: d.kind,
        sourceName: d.sourceName,
        sourceUrl: d.sourceUrl,
        growthPct: d.growthPct == null ? null : d.growthPct / 100,
        volumeIndex: d.volumeIndex == null ? null : Math.round(d.volumeIndex),
        expiresAt: d.expiresAt,
        source: "MANUAL",
      },
    });
    await audit(user, { action: "create", entity: "TrendSignal", entityId: s.id, clientId: d.clientId, summary: d.keyword, diff: d });
    revalidate();
    return { ok: "trends.msg.signalSaved" };
  });
}

export async function deleteSignal(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("deleteSignal", async () => {
    const user = await assertUser("trends:edit");
    const { signalId } = z.object({ signalId: id }).parse(formObject(fd));
    const s = await db.trendSignal.findUnique({ where: { id: signalId } });
    if (!s) throw new UserError("competitors.err.notFound");
    await assertClientAccess(user, s.clientId);
    await db.trendSignal.delete({ where: { id: s.id } });
    await audit(user, { action: "delete", entity: "TrendSignal", entityId: s.id, clientId: s.clientId, summary: s.keyword });
    revalidate();
    return { ok: "competitors.msg.deleted" };
  });
}

const MAX_CSV_BYTES = 1_000_000;

export async function importTrendsCsv(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("importTrendsCsv", async () => {
    const user = await assertUser("trends:edit");
    const d = z
      .object({ clientId: id, topKind: z.enum(["SEARCH", "TOPIC"]).default("SEARCH"), region: optStr(80), validDays: z.coerce.number().int().min(1).max(365).default(30) })
      .parse({ ...formObject(fd), file: undefined });
    await assertClientAccess(user, d.clientId);
    const file = fd.get("file");
    let text = typeof fd.get("text") === "string" ? (fd.get("text") as string) : "";
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_CSV_BYTES) throw new UserError("trends.import.tooLarge");
      text = await file.text();
    }
    if (text.length > MAX_CSV_BYTES) throw new UserError("trends.import.tooLarge");
    const parsed = parseGoogleTrendsCsv(text, d.topKind);
    if (!parsed.ok) return { error: `trends.import.err.${parsed.error}` };
    const now = new Date();
    const region = d.region ?? parsed.region;
    const sourceName = region ? `Google Trends (${region})` : "Google Trends";
    const rows = parsed.signals.slice(0, 200).map((s) => ({
      clientId: d.clientId,
      keyword: s.keyword.slice(0, 160),
      kind: s.kind,
      sourceName,
      sourceUrl: `https://trends.google.com/trends/explore?q=${encodeURIComponent(s.keyword)}`,
      growthPct: s.growthPct,
      volumeIndex: s.volumeIndex == null ? null : Math.round(Math.min(100, Math.max(0, s.volumeIndex))),
      discoveredAt: now,
      expiresAt: new Date(now.getTime() + d.validDays * 86_400_000),
      source: "IMPORT" as const,
    }));
    await db.trendSignal.createMany({ data: rows });
    await audit(user, { action: "import", entity: "TrendSignal", clientId: d.clientId, summary: `Google Trends CSV (${parsed.format}): ${rows.length} signal(s)` });
    revalidate();
    return { ok: "trends.import.done", vars: { n: rows.length } };
  });
}

export async function syncSearchConsole(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("syncSearchConsole", async () => {
    const user = await assertUser("trends:edit");
    const { clientId } = z.object({ clientId: id }).parse(formObject(fd));
    await assertClientAccess(user, clientId);
    const r = await fetchSearchConsoleSignals(clientId);
    if (!r.ok) return { error: `trends.sc.err.${r.reason}` };
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 86_400_000);
    // Refresh rather than duplicate: replace this week's Search Console signals for the client.
    await db.$transaction([
      db.trendSignal.deleteMany({ where: { clientId, sourceName: "Search Console", discoveredAt: { gte: since } } }),
      db.trendSignal.createMany({
        data: r.signals.map((s) => ({
          clientId,
          keyword: s.keyword.slice(0, 160),
          kind: s.kind,
          sourceName: "Search Console",
          sourceUrl: `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(r.site)}`,
          growthPct: s.growthPct,
          volumeIndex: s.volumeIndex,
          discoveredAt: now,
          expiresAt: new Date(now.getTime() + 28 * 86_400_000),
          source: "API" as const,
        })),
      }),
    ]);
    await audit(user, { action: "sync", entity: "TrendSignal", clientId, summary: `Search Console ${r.range.from}..${r.range.to}: ${r.signals.length} queries` });
    revalidate();
    return { ok: "trends.sc.done", vars: { n: r.signals.length } };
  });
}

// ── Idea generation (stored as PENDING suggestions until a human accepts) ────────────────────

export async function generateIdeaSuggestions(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("generateIdeaSuggestions", async () => {
    const user = await assertUser();
    const d = z.object({ clientId: id, source: z.enum(IDEA_SOURCES), count: z.coerce.number().int().min(1).max(12).default(6) }).parse(formObject(fd));
    requirePerm(user, ideaPermission(d.source));
    await assertClientAccess(user, d.clientId);
    const { locale } = await getI18n();
    const ctx = await loadIdeaContext(d.clientId, locale);
    const run = await generateIdeas({ source: d.source, ctx, count: d.count, allowAi: user.perms.has("ai:use") });
    if (!run.drafts.length) return { error: d.source === "COMPETITOR" ? "trends.gen.noCompetitorData" : d.source === "TREND" ? "trends.gen.noSignals" : "trends.gen.noData" };
    const area = `ideas.${d.source.toLowerCase()}`;
    const dataSources = d.source === "COMPETITOR" ? ["CompetitorAd", "CompetitorPost"] : d.source === "TREND" ? ["TrendSignal"] : ["Strategy.pillars", "Competitor.pillars", "ContentItem"];
    await db.aiRecommendation.createMany({
      data: run.drafts.map((draft) => ({
        clientId: d.clientId,
        area,
        title: draft.title,
        body: { ...draft, source: d.source, engine: run.engine } as unknown as Prisma.InputJsonValue,
        reasoning: draft.reason,
        confidence: draft.confidence,
        dataSources: [...dataSources, run.engine === "ai" ? "Claude" : "Rule engine"],
      })),
    });
    await audit(user, { action: "generate", entity: "Idea", clientId: d.clientId, summary: `${run.drafts.length} ${d.source} idea suggestion(s) via ${run.engine}`, diff: { aiStatus: run.aiStatus } });
    revalidate();
    return { ok: run.engine === "ai" ? "trends.gen.doneAi" : "trends.gen.doneRules", vars: { n: run.drafts.length } };
  });
}

function draftToIdea(clientId: string, source: IdeaSourceKey, draft: z.infer<typeof ideaDraftSchema>, aiGenerated: boolean): Prisma.IdeaUncheckedCreateInput {
  const d = sanitizeDraft(draft);
  return {
    clientId,
    source,
    title: d.title,
    reason: d.reason,
    competitorName: d.competitorName,
    originalIdea: d.originalIdea,
    whyItWorked: d.whyItWorked,
    ourTwist: d.ourTwist,
    signalSource: d.signalSource,
    signalGrowth: d.signalGrowth,
    validUntil: d.validUntil ? new Date(d.validUntil + "T00:00:00.000Z") : null,
    keyword: d.keyword,
    searchIntent: d.searchIntent,
    platform: d.platform,
    format: d.format,
    audience: d.audience,
    objective: d.objective,
    funnelStage: d.funnelStage,
    hook: d.hook,
    cta: d.cta,
    captionOutline: d.captionOutline,
    visualDirection: d.visualDirection,
    priority: d.priority,
    ease: d.ease,
    impact: d.impact,
    costEstimate: d.costEstimate,
    successMetrics: d.successMetrics,
    isSeasonal: d.isSeasonal,
    isEvergreen: d.isEvergreen,
    aiGenerated,
    dataSource: "MANUAL",
  };
}

export async function decideIdeaSuggestion(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("decideIdeaSuggestion", async () => {
    const user = await assertUser();
    const d = z.object({ recId: id, decision: z.enum(["ACCEPT", "REJECT"]) }).parse(formObject(fd));
    const rec = await db.aiRecommendation.findUnique({ where: { id: d.recId } });
    if (!rec || !rec.area.startsWith("ideas.") || rec.state !== "PENDING") throw new UserError("competitors.err.notPending");
    await assertClientAccess(user, rec.clientId);
    const body = rec.body as Record<string, unknown>;
    const source = z.enum(IDEA_SOURCES).parse(body.source);
    requirePerm(user, ideaPermission(source));
    let ideaId: string | null = null;
    if (d.decision === "ACCEPT") {
      const draft = ideaDraftSchema.parse(body);
      const idea = await db.idea.create({ data: draftToIdea(rec.clientId, source, draft, body.engine === "ai") });
      ideaId = idea.id;
    }
    await db.aiRecommendation.update({ where: { id: rec.id }, data: { state: d.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED", decidedById: user.id, decidedAt: new Date() } });
    await audit(user, { action: d.decision === "ACCEPT" ? "approve" : "reject", entity: "AiRecommendation", entityId: rec.id, clientId: rec.clientId, summary: rec.title, diff: { ideaId } });
    revalidate();
    return { ok: d.decision === "ACCEPT" ? "trends.msg.ideaAccepted" : "trends.msg.ideaRejected" };
  });
}

// ── Ideas ───────────────────────────────────────────────────────────────────────────────────

const ideaSchema = z.object({
  id: id.optional(),
  clientId: id,
  source: z.enum(IDEA_SOURCES),
  title: z.string().trim().min(1).max(200),
  reason: optStr(1000),
  competitorName: optStr(120),
  originalIdea: optStr(500),
  whyItWorked: optStr(500),
  ourTwist: optStr(800),
  signalSource: optStr(120),
  signalGrowth: optNum,
  validUntil: optDate,
  keyword: optStr(120),
  searchIntent: optStr(60),
  platform: optEnum(Platform),
  format: optEnum(ContentType),
  audience: optStr(200),
  objective: optEnum(Objective),
  funnelStage: optEnum(FunnelStage),
  hook: optStr(300),
  cta: optStr(120),
  captionOutline: optStr(1000),
  visualDirection: optStr(600),
  priority: z.enum(Priority).default("MEDIUM"),
  ease: z.coerce.number().int().min(1).max(5).default(3),
  impact: z.coerce.number().int().min(1).max(5).default(3),
  costEstimate: optStr(60),
  successMetrics: z.unknown().transform((v) => splitList(v, 6, /[,\n،]/)),
  isSeasonal: bool,
  isEvergreen: bool,
});

export async function saveIdea(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("saveIdea", async () => {
    const user = await assertUser();
    const d = ideaSchema.parse(formObject(fd));
    requirePerm(user, ideaPermission(d.source));
    await assertClientAccess(user, d.clientId);
    const { id: ideaId, clientId, ...rest } = d;
    const fields = {
      ...rest,
      reason: rest.reason,
      signalGrowth: rest.signalGrowth == null ? null : rest.signalGrowth / 100,
      platform: rest.platform ?? null,
      format: rest.format ?? null,
      objective: rest.objective ?? null,
      funnelStage: rest.funnelStage ?? null,
    };
    if (ideaId) {
      const existing = await db.idea.findFirst({ where: { id: ideaId, clientId } });
      if (!existing) throw new UserError("competitors.err.notFound");
      // An AI idea stays flagged as AI-generated after human edits (provenance is never erased).
      await db.idea.update({ where: { id: existing.id }, data: { ...fields, source: existing.source } });
      await audit(user, { action: "update", entity: "Idea", entityId: existing.id, clientId, summary: d.title, diff: fields });
    } else {
      const idea = await db.idea.create({ data: { ...fields, clientId, dataSource: "MANUAL" } });
      await audit(user, { action: "create", entity: "Idea", entityId: idea.id, clientId, summary: d.title, diff: fields });
    }
    revalidate();
    return { ok: "trends.msg.ideaSaved" };
  });
}

export async function deleteIdea(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("deleteIdea", async () => {
    const user = await assertUser();
    const { ideaId } = z.object({ ideaId: id }).parse(formObject(fd));
    const idea = await db.idea.findUnique({ where: { id: ideaId } });
    if (!idea) throw new UserError("competitors.err.notFound");
    await assertClientAccess(user, idea.clientId);
    requirePerm(user, ideaPermission(idea.source));
    await db.idea.delete({ where: { id: idea.id } });
    await audit(user, { action: "delete", entity: "Idea", entityId: idea.id, clientId: idea.clientId, summary: idea.title });
    revalidate();
    return { ok: "competitors.msg.deleted" };
  });
}

/** "Add to Content Calendar": creates a ContentItem (status IDEA) linked to the idea. */
export async function addIdeaToCalendar(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("addIdeaToCalendar", async () => {
    const user = await assertUser("content:create");
    const d = z
      .object({ ideaId: id, platform: z.enum(Platform), type: z.enum(ContentType), publishAt: optDate })
      .parse(formObject(fd));
    const idea = await db.idea.findUnique({ where: { id: d.ideaId }, include: { client: { select: { timezone: true } } } });
    if (!idea) throw new UserError("competitors.err.notFound");
    await assertClientAccess(user, idea.clientId);
    if (idea.addedToCalendar) throw new UserError("trends.err.alreadyInCalendar");
    const item = await db.$transaction(async (tx) => {
      const c = await tx.contentItem.create({
        data: {
          clientId: idea.clientId,
          title: idea.title,
          platform: d.platform,
          type: d.type,
          publishAt: d.publishAt,
          timezone: idea.client.timezone,
          funnelStage: idea.funnelStage,
          objective: idea.objective,
          audience: idea.audience,
          hook: idea.hook,
          cta: idea.cta,
          caption: idea.captionOutline,
          designBrief: idea.visualDirection,
          keywords: idea.keyword ? [idea.keyword] : [],
          notes: [idea.reason, idea.ourTwist].filter(Boolean).join("\n\n") || null,
          status: "IDEA",
          ideaId: idea.id,
          createdById: user.id,
          source: "MANUAL",
        },
      });
      await tx.idea.update({ where: { id: idea.id }, data: { addedToCalendar: true } });
      return c;
    });
    await audit(user, { action: "create", entity: "ContentItem", entityId: item.id, clientId: idea.clientId, summary: `From idea: ${idea.title}`, diff: { ideaId: idea.id, platform: d.platform, type: d.type } });
    revalidate();
    revalidatePath("/calendar");
    return { ok: "trends.msg.addedToCalendar" };
  });
}
