"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ContentType, FunnelStage, Platform, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, type CurrentUser } from "@/lib/auth/session";
import { assertClientAccess } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { sha256 } from "@/lib/crypto";
import { getI18n } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/translate";
import { runAction, splitList, formObject, UserError, type ActionState } from "@/lib/competitors/action-result";
import { suggestCompetitors } from "@/lib/competitors/suggestions";
import { searchAdLibrary, mapLibraryAd, adLibraryConfigured } from "@/lib/competitors/meta-ad-library";
import { competitorAlertRecipients } from "@/lib/competitors/alerts";
import { topValues } from "@/lib/competitors/intensity";

/** Business limits (enforced here, mirrored in the UI). */
const MAX_MANUAL = 4;
const MAX_SUGGESTED = 4;

// ── Zod helpers (all inputs arrive as FormData strings) ──────────────────────────────────────

const optStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
const optUrl = optStr(500).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "url");
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
const reqDate = optDate.refine((v) => v != null, "required").transform((v) => v!);
const list = (max = 20) => z.unknown().transform((v) => splitList(v, max));
const csv = (max = 20) => z.unknown().transform((v) => splitList(v, max, /[,\n،]/));
const bool = z.unknown().transform((v) => v === "on" || v === "true" || v === "1");
const arrayOf = <T extends z.ZodType>(item: T) => z.preprocess((v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(item));
const id = z.string().min(1).max(40);

const SOCIAL_KEYS = ["facebook", "instagram", "tiktok", "linkedin", "youtube", "x"] as const;

const competitorSchema = z.object({
  id: id.optional(),
  clientId: id,
  name: z.string().trim().min(1).max(120),
  logoUrl: optUrl,
  website: optUrl,
  metaPageId: optStr(40).refine((v) => !v || /^\d+$/.test(v), "metaPageId"),
  activePlatforms: arrayOf(z.enum(Platform)),
  postingPerWeek: optNum,
  contentTypes: csv(),
  pillars: list(),
  engagementLevel: z.enum(["", "LOW", "MEDIUM", "HIGH"]).optional().transform((v) => v || null),
  recurringMessages: list(),
  designStyle: optStr(1000),
  ctas: csv(),
  landingPages: list(),
  strengths: list(),
  weaknesses: list(),
  opportunities: list(),
  notes: optStr(4000),
});

function socialAndFollowers(raw: Record<string, unknown>) {
  const links: Record<string, string> = {};
  const followers: Record<string, { count: number; growthPct: number | null; asOf: string; source: string }> = {};
  for (const k of SOCIAL_KEYS) {
    const url = typeof raw[`sl_${k}`] === "string" ? (raw[`sl_${k}`] as string).trim() : "";
    if (url) {
      if (!/^https?:\/\/\S+$/i.test(url)) throw new UserError("competitors.err.validation", { field: k });
      links[k] = url.slice(0, 500);
    }
    const count = Number(raw[`fc_${k}`]);
    if (raw[`fc_${k}`] && Number.isFinite(count) && count >= 0) {
      const g = raw[`fg_${k}`] ? Number(raw[`fg_${k}`]) : NaN;
      const asOf = typeof raw[`fd_${k}`] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw[`fd_${k}`] as string) ? (raw[`fd_${k}`] as string) : new Date().toISOString().slice(0, 10);
      const source = typeof raw[`fs_${k}`] === "string" && (raw[`fs_${k}`] as string).trim() ? (raw[`fs_${k}`] as string).trim().slice(0, 80) : "Manual";
      followers[k] = { count: Math.round(count), growthPct: Number.isFinite(g) ? g / 100 : null, asOf, source };
    }
  }
  return { links, followers };
}

async function loadCompetitor(user: CurrentUser, competitorId: string) {
  const comp = await db.competitor.findUnique({ where: { id: competitorId } });
  if (!comp) throw new UserError("competitors.err.notFound");
  await assertClientAccess(user, comp.clientId);
  return comp;
}

function revalidate() {
  revalidatePath("/competitors", "layout");
}

// ── Competitors ─────────────────────────────────────────────────────────────────────────────

export async function saveCompetitor(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("saveCompetitor", async () => {
    const user = await assertUser("competitors:edit");
    const raw = formObject(fd);
    const data = competitorSchema.parse(raw);
    await assertClientAccess(user, data.clientId);
    const { links, followers } = socialAndFollowers(raw);
    if (data.metaPageId) links.metaPageId = data.metaPageId;
    const fields = {
      name: data.name,
      logoUrl: data.logoUrl,
      website: data.website,
      socialLinks: links,
      activePlatforms: data.activePlatforms,
      followers,
      postingPerWeek: data.postingPerWeek,
      contentTypes: data.contentTypes,
      pillars: data.pillars,
      engagementLevel: data.engagementLevel,
      recurringMessages: data.recurringMessages,
      designStyle: data.designStyle,
      ctas: data.ctas,
      landingPages: data.landingPages,
      strengths: data.strengths,
      weaknesses: data.weaknesses,
      opportunities: data.opportunities,
      notes: data.notes,
    } satisfies Prisma.CompetitorUncheckedUpdateInput;

    if (data.id) {
      const existing = await loadCompetitor(user, data.id);
      if (existing.clientId !== data.clientId) throw new UserError("competitors.err.notFound");
      await db.competitor.update({ where: { id: existing.id }, data: { ...fields, source: existing.source === "DEMO" ? "DEMO" : "MANUAL" } });
      await audit(user, { action: "update", entity: "Competitor", entityId: existing.id, clientId: data.clientId, summary: data.name, diff: fields });
      revalidate();
      return { ok: "competitors.msg.saved" };
    }
    const created = await createManual(user, data.clientId, fields);
    await audit(user, { action: "create", entity: "Competitor", entityId: created.id, clientId: data.clientId, summary: data.name, diff: fields });
    revalidate();
    return { ok: "competitors.msg.created" };
  });
}

/** Creates a MANUAL competitor while holding the 4-per-client limit (serializable transaction). */
async function createManual(user: CurrentUser, clientId: string, fields: Omit<Prisma.CompetitorUncheckedCreateInput, "clientId">) {
  return db.$transaction(
    async (tx) => {
      const n = await tx.competitor.count({ where: { clientId, origin: "MANUAL" } });
      if (n >= MAX_MANUAL) throw new UserError("competitors.err.maxManual", { max: MAX_MANUAL });
      const dup = await tx.competitor.findFirst({ where: { clientId, name: { equals: fields.name, mode: "insensitive" }, state: { not: "REJECTED" } } });
      if (dup) throw new UserError("competitors.err.duplicate", { name: fields.name });
      return tx.competitor.create({ data: { ...fields, clientId, origin: "MANUAL", state: "ACCEPTED", source: "MANUAL" } });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function deleteCompetitor(_: ActionState, fd: FormData): Promise<ActionState> {
  const result = await runAction("deleteCompetitor", async () => {
    const user = await assertUser("competitors:edit");
    const { competitorId } = z.object({ competitorId: id }).parse(formObject(fd));
    const comp = await loadCompetitor(user, competitorId);
    await db.competitor.delete({ where: { id: comp.id } });
    await audit(user, { action: "delete", entity: "Competitor", entityId: comp.id, clientId: comp.clientId, summary: comp.name });
    revalidate();
    return { ok: "competitors.msg.deleted" };
  });
  // Leaving the deleted competitor's profile: only same-site competitor paths are allowed.
  const to = fd.get("redirectTo");
  if (result?.ok && typeof to === "string" && /^\/competitors(\?|$)/.test(to)) redirect(to);
  return result;
}

// ── Suggestions ─────────────────────────────────────────────────────────────────────────────

async function fillSuggestions(user: CurrentUser, clientId: string) {
  const { t, locale } = await getI18n();
  const [client, all, occupied] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, organizationId: true, name: true, industry: true, country: true, products: true, audiences: true, website: true } }),
    db.competitor.findMany({ where: { clientId }, select: { name: true } }),
    db.competitor.count({ where: { clientId, origin: "SUGGESTED", state: { in: ["PENDING", "ACCEPTED"] } } }),
  ]);
  const need = MAX_SUGGESTED - occupied;
  if (need <= 0) return { created: 0, run: null };
  const run = await suggestCompetitors({ client, exclude: all.map((c) => c.name), need, locale, t, allowAi: user.perms.has("ai:use") });
  for (const c of run.candidates) {
    await db.competitor.create({
      data: {
        clientId,
        name: c.name,
        website: c.website,
        activePlatforms: c.platforms,
        origin: "SUGGESTED",
        state: "PENDING",
        suggestionReason: c.reason,
        source: c.signal === "AD_LIBRARY" ? "API" : c.signal === "AI" ? "ESTIMATE" : "MANUAL",
        notes: c.signal === "AI" ? t("competitors.suggest.aiVerify") : null,
      },
    });
  }
  return { created: run.candidates.length, run };
}

export async function generateSuggestions(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("generateSuggestions", async (): Promise<ActionState> => {
    const user = await assertUser("competitors:edit");
    const { clientId } = z.object({ clientId: id }).parse(formObject(fd));
    await assertClientAccess(user, clientId);
    const { created, run } = await fillSuggestions(user, clientId);
    await audit(user, { action: "generate", entity: "CompetitorSuggestion", clientId, summary: `${created} suggestion(s)`, diff: run ? { adLibrary: run.adLibrary, ai: run.ai } : undefined });
    revalidate();
    if (!run) return { error: "competitors.err.maxSuggested", vars: { max: MAX_SUGGESTED } };
    if (created === 0) return { error: run.adLibrary === "NOT_CONFIGURED" && run.ai !== "OK" ? "competitors.err.noSuggestionSources" : "competitors.err.noNewSuggestions" };
    return { ok: "competitors.msg.suggested", vars: { n: created } };
  });
}

export async function decideSuggestion(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("decideSuggestion", async () => {
    const user = await assertUser("competitors:edit");
    const { competitorId, decision } = z.object({ competitorId: id, decision: z.enum(["ACCEPT", "REJECT"]) }).parse(formObject(fd));
    const comp = await loadCompetitor(user, competitorId);
    if (comp.origin !== "SUGGESTED" || comp.state !== "PENDING") throw new UserError("competitors.err.notPending");
    await db.competitor.update({ where: { id: comp.id }, data: { state: decision === "ACCEPT" ? "ACCEPTED" : "REJECTED" } });
    await audit(user, { action: decision === "ACCEPT" ? "approve" : "reject", entity: "CompetitorSuggestion", entityId: comp.id, clientId: comp.clientId, summary: comp.name });
    revalidate();
    return { ok: decision === "ACCEPT" ? "competitors.msg.accepted" : "competitors.msg.rejected" };
  });
}

/** Replace = reject the suggestion, then either add a manual competitor or generate a new suggestion. */
export async function replaceSuggestion(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("replaceSuggestion", async (): Promise<ActionState> => {
    const user = await assertUser("competitors:edit");
    const data = z
      .object({ competitorId: id, mode: z.enum(["generate", "manual"]), name: optStr(120), website: optUrl })
      .parse(formObject(fd));
    const comp = await loadCompetitor(user, data.competitorId);
    if (comp.origin !== "SUGGESTED" || comp.state === "REJECTED") throw new UserError("competitors.err.notPending");
    if (data.mode === "manual" && !data.name) throw new UserError("competitors.err.validation", { field: "name" });

    if (data.mode === "manual") {
      // Validate the manual slot first so a failed replace leaves the suggestion untouched.
      const created = await createManual(user, comp.clientId, { name: data.name!, website: data.website });
      await db.competitor.update({ where: { id: comp.id }, data: { state: "REJECTED" } });
      await audit(user, { action: "replace", entity: "CompetitorSuggestion", entityId: comp.id, clientId: comp.clientId, summary: `${comp.name} → ${data.name}`, diff: { newCompetitorId: created.id } });
      revalidate();
      return { ok: "competitors.msg.replaced" };
    }
    await db.competitor.update({ where: { id: comp.id }, data: { state: "REJECTED" } });
    const { created, run } = await fillSuggestions(user, comp.clientId);
    await audit(user, { action: "replace", entity: "CompetitorSuggestion", entityId: comp.id, clientId: comp.clientId, summary: `${comp.name} → ${created} new suggestion(s)` });
    revalidate();
    if (!created) return { error: run?.adLibrary === "NOT_CONFIGURED" && run?.ai !== "OK" ? "competitors.err.noSuggestionSources" : "competitors.err.noNewSuggestions" };
    return { ok: "competitors.msg.replaced" };
  });
}

// ── Ads ─────────────────────────────────────────────────────────────────────────────────────

const adSchema = z
  .object({
    id: id.optional(),
    competitorId: id,
    platform: z.enum(Platform),
    libraryId: optStr(120),
    libraryUrl: optUrl,
    firstSeen: reqDate,
    lastSeen: optDate,
    isActive: bool,
    placements: csv(10),
    format: z.enum(ContentType).optional().or(z.literal("").transform(() => undefined)),
    creativeIdea: optStr(300),
    hook: optStr(300),
    offer: optStr(300),
    message: optStr(1000),
    cta: optStr(120),
    product: optStr(200),
    audienceGuess: optStr(300),
    funnelGuess: z.enum(FunnelStage).optional().or(z.literal("").transform(() => undefined)),
    landingPage: optUrl,
    variantCount: z.coerce.number().int().min(1).max(500).default(1),
    relaunched: bool,
    officialSpendMin: optNum,
    officialSpendMax: optNum,
  })
  .refine((d) => !d.lastSeen || d.lastSeen >= d.firstSeen, { message: "lastSeen", path: ["lastSeen"] })
  .refine((d) => d.officialSpendMin == null || d.officialSpendMax == null || d.officialSpendMax >= d.officialSpendMin, { message: "officialSpendMax", path: ["officialSpendMax"] });

export async function saveCompetitorAd(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("saveCompetitorAd", async () => {
    const user = await assertUser("competitors:edit");
    const d = adSchema.parse(formObject(fd));
    const comp = await loadCompetitor(user, d.competitorId);
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    const fields = {
      platform: d.platform,
      libraryId: d.libraryId,
      libraryUrl: d.libraryUrl,
      firstSeen: d.firstSeen,
      lastSeen: d.isActive ? today : (d.lastSeen ?? d.firstSeen),
      isActive: d.isActive,
      placements: d.placements,
      format: d.format ?? null,
      creativeIdea: d.creativeIdea,
      hook: d.hook,
      offer: d.offer,
      message: d.message,
      cta: d.cta,
      product: d.product,
      audienceGuess: d.audienceGuess,
      funnelGuess: d.funnelGuess ?? null,
      landingPage: d.landingPage,
      variantCount: d.variantCount,
      relaunched: d.relaunched,
      officialSpendMin: d.officialSpendMin,
      officialSpendMax: d.officialSpendMax,
    };
    if (d.id) {
      const ad = await db.competitorAd.findFirst({ where: { id: d.id, competitorId: comp.id } });
      if (!ad) throw new UserError("competitors.err.notFound");
      // Fields that came from the official API stay authoritative; the analysis fields are editable.
      const editable = ad.source === "API" ? { ...fields, officialSpendMin: ad.officialSpendMin, officialSpendMax: ad.officialSpendMax, libraryId: ad.libraryId, firstSeen: ad.firstSeen, platform: ad.platform } : fields;
      await db.competitorAd.update({ where: { id: ad.id }, data: editable });
      await audit(user, { action: "update", entity: "CompetitorAd", entityId: ad.id, clientId: comp.clientId, diff: editable });
    } else {
      const ad = await db.competitorAd.create({ data: { ...fields, competitorId: comp.id, source: "MANUAL" } });
      await audit(user, { action: "create", entity: "CompetitorAd", entityId: ad.id, clientId: comp.clientId, diff: fields });
    }
    revalidate();
    return { ok: "competitors.msg.adSaved" };
  });
}

export async function deleteCompetitorAd(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("deleteCompetitorAd", async () => {
    const user = await assertUser("competitors:edit");
    const { adId } = z.object({ adId: id }).parse(formObject(fd));
    const ad = await db.competitorAd.findUnique({ where: { id: adId }, include: { competitor: { select: { clientId: true } } } });
    if (!ad) throw new UserError("competitors.err.notFound");
    await assertClientAccess(user, ad.competitor.clientId);
    await db.competitorAd.delete({ where: { id: ad.id } });
    await audit(user, { action: "delete", entity: "CompetitorAd", entityId: ad.id, clientId: ad.competitor.clientId });
    revalidate();
    return { ok: "competitors.msg.deleted" };
  });
}

/** Recurring message = most frequent message/offer across active ads. */
function recurringMessage(ads: { message: string | null; offer: string | null; isActive: boolean }[]) {
  const act = ads.filter((a) => a.isActive);
  return topValues([...act.map((a) => a.offer), ...act.map((a) => a.message)], 1)[0]?.label ?? null;
}

export async function importMetaAds(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("importMetaAds", async () => {
    const user = await assertUser("competitors:edit");
    const d = z
      .object({ competitorId: id, pageId: optStr(40).refine((v) => !v || /^\d+$/.test(v), "pageId"), country: optStr(2).refine((v) => !v || /^[A-Za-z]{2}$/.test(v), "country") })
      .parse(formObject(fd));
    const comp = await loadCompetitor(user, d.competitorId);
    if (!adLibraryConfigured()) return { error: "competitors.import.notConfigured" };
    const client = await db.client.findUniqueOrThrow({ where: { id: comp.clientId }, select: { country: true, organizationId: true } });
    const country = (d.country ?? client.country ?? "").toUpperCase();
    if (!country) throw new UserError("competitors.err.validation", { field: "country" });
    const links = (comp.socialLinks ?? {}) as Record<string, string>;
    const pageId = d.pageId ?? links.metaPageId ?? null;

    const res = await searchAdLibrary(pageId ? { countries: [country], pageIds: [pageId] } : { countries: [country], searchTerms: comp.name });
    if (!res.ok) return { error: `competitors.import.err.${res.reason}` };
    // Search by name returns any advertiser mentioning it — keep only ads from the matching page.
    const ads = pageId ? res.ads : res.ads.filter((a) => a.page_name?.trim().toLowerCase() === comp.name.trim().toLowerCase());

    const existing = await db.competitorAd.findMany({ where: { competitorId: comp.id }, select: { id: true, libraryId: true, message: true, offer: true, isActive: true } });
    const before = recurringMessage(existing);
    const byLib = new Map(existing.filter((e) => e.libraryId).map((e) => [e.libraryId!, e.id]));
    const newIds: string[] = [];
    let updated = 0;
    for (const a of ads) {
      const row = mapLibraryAd(a, comp.id);
      if (!row) continue;
      const existingId = byLib.get(a.id);
      if (existingId) {
        await db.competitorAd.update({
          where: { id: existingId },
          data: { lastSeen: row.lastSeen, isActive: row.isActive, placements: row.placements, variantCount: row.variantCount, officialSpendMin: row.officialSpendMin, officialSpendMax: row.officialSpendMax, source: "API" },
        });
        updated++;
      } else {
        await db.competitorAd.create({ data: row });
        newIds.push(a.id);
      }
    }
    if (pageId && pageId !== links.metaPageId) await db.competitor.update({ where: { id: comp.id }, data: { socialLinks: { ...links, metaPageId: pageId } } });

    const after = recurringMessage(await db.competitorAd.findMany({ where: { competitorId: comp.id }, select: { message: true, offer: true, isActive: true } }));
    const changed = Boolean(before && after && before.toLowerCase() !== after.toLowerCase());
    let notified = 0;
    if (newIds.length || changed) {
      const recipients = await competitorAlertRecipients(client.organizationId, comp.clientId);
      const users = await db.user.findMany({ where: { id: { in: recipients } }, select: { id: true, locale: true } });
      const data: Prisma.NotificationCreateManyInput[] = [];
      for (const u of users) {
        const tt = makeT(u.locale === "en" ? "en" : "ar");
        const link = `/competitors/${comp.id}?client=${comp.clientId}`;
        if (newIds.length)
          data.push({
            organizationId: client.organizationId,
            userId: u.id,
            clientId: comp.clientId,
            type: "COMPETITOR_AD",
            severity: "INFO",
            title: tt("competitors.alert.newAdsTitle", { name: comp.name, n: newIds.length }),
            body: tt("competitors.alert.newAdsBody", { name: comp.name, n: newIds.length }),
            link,
            dedupeKey: `competitor-ad:new:${comp.id}:${sha256([...newIds].sort().join(",")).slice(0, 24)}`,
          });
        if (changed)
          data.push({
            organizationId: client.organizationId,
            userId: u.id,
            clientId: comp.clientId,
            type: "COMPETITOR_AD",
            severity: "WARNING",
            title: tt("competitors.alert.messageTitle", { name: comp.name }),
            body: tt("competitors.alert.messageBody", { before: before!, after: after! }),
            link,
            dedupeKey: `competitor-ad:msg:${comp.id}:${sha256(after!.toLowerCase()).slice(0, 24)}`,
          });
      }
      if (data.length) notified = (await db.notification.createMany({ data, skipDuplicates: true })).count;
    }
    await audit(user, {
      action: "import",
      entity: "CompetitorAd",
      entityId: comp.id,
      clientId: comp.clientId,
      summary: `Meta Ad Library: ${newIds.length} new, ${updated} updated`,
      diff: { country, pageId, fetched: res.ads.length, matched: ads.length, truncated: res.truncated, notified, messageChanged: changed },
    });
    revalidate();
    if (!ads.length) return { error: pageId ? "competitors.import.noneForPage" : "competitors.import.noneForName" };
    return { ok: "competitors.import.done", vars: { created: newIds.length, updated } };
  });
}

// ── Posts (manual; feed seasonal analysis & top posts) ────────────────────────────────────────

const postSchema = z.object({
  competitorId: id,
  platform: z.enum(Platform),
  url: optUrl,
  postedAt: reqDate,
  type: z.enum(ContentType).optional().or(z.literal("").transform(() => undefined)),
  topic: optStr(200),
  occasion: optStr(120),
  engagements: optNum.refine((v) => v == null || v >= 0, "engagements"),
  isTopPost: bool,
});

export async function saveCompetitorPost(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("saveCompetitorPost", async () => {
    const user = await assertUser("competitors:edit");
    const d = postSchema.parse(formObject(fd));
    const comp = await loadCompetitor(user, d.competitorId);
    const post = await db.competitorPost.create({
      data: { competitorId: comp.id, platform: d.platform, url: d.url, postedAt: d.postedAt, type: d.type ?? null, topic: d.topic, occasion: d.occasion, engagements: d.engagements == null ? null : Math.round(d.engagements), isTopPost: d.isTopPost, source: "MANUAL" },
    });
    await audit(user, { action: "create", entity: "CompetitorPost", entityId: post.id, clientId: comp.clientId, diff: d });
    revalidate();
    return { ok: "competitors.msg.postSaved" };
  });
}

export async function deleteCompetitorPost(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("deleteCompetitorPost", async () => {
    const user = await assertUser("competitors:edit");
    const { postId } = z.object({ postId: id }).parse(formObject(fd));
    const post = await db.competitorPost.findUnique({ where: { id: postId }, include: { competitor: { select: { clientId: true } } } });
    if (!post) throw new UserError("competitors.err.notFound");
    await assertClientAccess(user, post.competitor.clientId);
    await db.competitorPost.delete({ where: { id: post.id } });
    await audit(user, { action: "delete", entity: "CompetitorPost", entityId: post.id, clientId: post.competitor.clientId });
    revalidate();
    return { ok: "competitors.msg.deleted" };
  });
}
