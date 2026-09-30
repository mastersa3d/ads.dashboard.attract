"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, AuthError, type CurrentUser } from "@/lib/auth/session";
import { assertClientAccess } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { getI18n } from "@/lib/i18n/server";
import { fxFromSettings } from "@/lib/fx";
import { buildStrategyPackage, suggestStrategy, type StrategySuggestion } from "@/lib/ai/strategy";
import { AREA_SECTION, SECTION_IDS, readSection, readSections, type SectionId, type StrategyArea } from "@/components/strategy/sections";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  if (e instanceof z.ZodError) return { ok: false, error: "VALIDATION" };
  if (e instanceof StrategyError) return { ok: false, error: e.message };
  throw e;
}
class StrategyError extends Error {}

const sectionSchema = z.object({
  clientId: z.string().min(1),
  sectionId: z.enum(SECTION_IDS as [SectionId, ...SectionId[]]),
  text: z.string().max(10000),
  items: z.array(z.string().trim().min(1).max(1000)).max(100),
});

/**
 * Editing an APPROVED strategy starts a new draft version: status → DRAFT, version + 1.
 * Returns the updated row.
 */
async function writeSection(user: CurrentUser, clientId: string, sectionId: SectionId, content: { text: string; items: string[] }) {
  const current = await db.strategy.findUnique({ where: { clientId } });
  const sections = { ...((current?.sections as Record<string, unknown> | null) ?? {}), [sectionId]: content } as Prisma.InputJsonObject;
  const reopen = current?.status === "APPROVED";
  const row = current
    ? await db.strategy.update({
        where: { clientId },
        data: { sections, ...(reopen ? { status: "DRAFT", version: current.version + 1, approvedAt: null, approvedById: null } : {}) },
      })
    : await db.strategy.create({ data: { clientId, sections } });
  if (reopen) await audit(user, { action: "new_version", entity: "Strategy", entityId: row.id, clientId, summary: `v${row.version}`, diff: { from: "APPROVED", to: "DRAFT" } });
  return { row, before: current ? readSection((current.sections as Record<string, unknown>)[sectionId]) : null };
}

export async function saveStrategySection(input: z.input<typeof sectionSchema>): Promise<ActionResult> {
  try {
    const user = await assertUser("strategy:edit");
    const data = sectionSchema.parse(input);
    await assertClientAccess(user, data.clientId);
    const content = { text: data.text.trim(), items: data.items };
    const { row, before } = await writeSection(user, data.clientId, data.sectionId, content);
    await audit(user, { action: "update", entity: "Strategy", entityId: row.id, clientId: data.clientId, summary: `section ${data.sectionId}`, diff: { section: data.sectionId, before, after: content } });
    revalidatePath("/strategy");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const statusSchema = z.object({ clientId: z.string().min(1), status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED"]) });

/**
 * Workflow: DRAFT → IN_REVIEW (strategy:edit) → APPROVED (strategy:approve).
 * IN_REVIEW → DRAFT = changes requested (strategy:approve). APPROVED → DRAFT starts version + 1 (strategy:edit).
 */
export async function setStrategyStatus(input: z.input<typeof statusSchema>): Promise<ActionResult> {
  try {
    const data = statusSchema.parse(input);
    const user = await assertUser("strategy:view");
    await assertClientAccess(user, data.clientId);
    const current = await db.strategy.findUnique({ where: { clientId: data.clientId } });
    if (!current) throw new StrategyError("EMPTY");
    const from = current.status;
    const need =
      from === "DRAFT" && data.status === "IN_REVIEW"
        ? "strategy:edit"
        : from === "IN_REVIEW" && (data.status === "APPROVED" || data.status === "DRAFT")
          ? "strategy:approve"
          : from === "APPROVED" && data.status === "DRAFT"
            ? "strategy:edit"
            : null;
    if (!need) throw new StrategyError("INVALID_TRANSITION");
    if (!user.perms.has(need)) throw new AuthError("FORBIDDEN");

    const row = await db.strategy.update({
      where: { clientId: data.clientId },
      data:
        data.status === "APPROVED"
          ? { status: "APPROVED", approvedById: user.id, approvedAt: new Date() }
          : from === "APPROVED"
            ? { status: "DRAFT", version: current.version + 1, approvedById: null, approvedAt: null }
            : { status: data.status },
    });
    const action = data.status === "APPROVED" ? "approve" : data.status === "IN_REVIEW" ? "submit" : from === "IN_REVIEW" ? "reject" : "new_version";
    await audit(user, { action, entity: "Strategy", entityId: row.id, clientId: data.clientId, summary: `${from} → ${row.status} (v${row.version})`, diff: { from, to: row.status, version: row.version } });
    revalidatePath("/strategy");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── AI Strategy Assistant ─────────────────────────────────────────────

function toLines(area: StrategyArea, s: StrategySuggestion, t: (k: string, v?: Record<string, string | number>) => string): string[] {
  switch (area) {
    case "strategy.smartGoals":
      return s.goals.map((g) => `${g.title} — ${g.metric}: ${g.baseline ?? "—"} → ${g.target} (${g.deadline})`);
    case "strategy.channels":
      return s.channelMix.map((c) => `${t(`platform.${c.platform}`)} — ${c.sharePct}% · ${c.role}`);
    case "strategy.pillars":
      return s.pillars.map((p) => (p.description ? `${p.name} — ${p.description}` : p.name));
    case "strategy.plan":
      return [
        ...s.plan.days30.map((x) => `${t("strategy.ai.days30")}: ${x}`),
        ...s.plan.days60.map((x) => `${t("strategy.ai.days60")}: ${x}`),
        ...s.plan.days90.map((x) => `${t("strategy.ai.days90")}: ${x}`),
      ];
  }
}

const genSchema = z.object({ clientId: z.string().min(1) });

export async function generateStrategySuggestions(input: z.input<typeof genSchema>): Promise<ActionResult & { method?: "ai" | "rules"; aiError?: string | null }> {
  try {
    const user = await assertUser("strategy:edit");
    if (!user.perms.has("ai:use")) throw new AuthError("FORBIDDEN");
    const { clientId } = genSchema.parse(input);
    await assertClientAccess(user, clientId);
    const { t, locale } = await getI18n();
    const org = await db.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { settings: true } });
    const pkg = await buildStrategyPackage({ clientId, organizationId: user.organizationId, fx: fxFromSettings(org.settings), t });
    const { method, aiError, suggestion } = await suggestStrategy(pkg, t, locale);

    const strategy = await db.strategy.upsert({ where: { clientId }, update: {}, create: { clientId, sections: {} } });
    const avg = (xs: { confidence: number }[]) => (xs.length ? xs.reduce((s, x) => s + x.confidence, 0) / xs.length : 0);
    const uniq = (xs: string[]) => [...new Set(xs)].slice(0, 8);
    const entries: { area: StrategyArea; items: unknown[]; reasoning: string; confidence: number; dataSources: string[] }[] = [
      { area: "strategy.smartGoals", items: suggestion.goals, reasoning: suggestion.goals.map((g) => `• ${g.title}: ${g.reasoning}`).join("\n"), confidence: avg(suggestion.goals), dataSources: uniq(suggestion.goals.flatMap((g) => g.dataSources)) },
      { area: "strategy.channels", items: suggestion.channelMix, reasoning: suggestion.channelMix.map((c) => `• ${t(`platform.${c.platform}`)}: ${c.reasoning}`).join("\n"), confidence: avg(suggestion.channelMix), dataSources: uniq(suggestion.channelMix.flatMap((c) => c.dataSources)) },
      { area: "strategy.pillars", items: suggestion.pillars, reasoning: suggestion.pillars.map((p) => `• ${p.name}: ${p.reasoning}`).join("\n"), confidence: avg(suggestion.pillars), dataSources: uniq(suggestion.pillars.flatMap((p) => p.dataSources)) },
      { area: "strategy.plan", items: [suggestion.plan], reasoning: suggestion.plan.reasoning, confidence: suggestion.plan.confidence, dataSources: uniq(suggestion.plan.dataSources) },
    ];

    // Replace earlier undecided strategy suggestions; decided ones stay as history.
    const removed = await db.aiRecommendation.deleteMany({ where: { clientId, strategyId: strategy.id, state: "PENDING", area: { startsWith: "strategy." } } });
    const generatedAt = new Date().toISOString();
    for (const e of entries) {
      const lines = toLines(e.area, suggestion, t);
      if (!lines.length) continue;
      await db.aiRecommendation.create({
        data: {
          clientId,
          strategyId: strategy.id,
          area: e.area,
          title: t(`strategy.ai.area.${e.area}`),
          body: { method, locale, generatedAt, period: pkg.period, lines, items: e.items } as object,
          reasoning: e.reasoning,
          confidence: e.confidence,
          dataSources: e.dataSources,
          state: "PENDING",
        },
      });
    }
    await audit(user, { action: "ai_generate", entity: "AiRecommendation", entityId: strategy.id, clientId, summary: `strategy suggestions (${method})`, diff: { method, aiError, replacedPending: removed.count, period: pkg.period } });
    revalidatePath("/strategy");
    return { ok: true, method, aiError };
  } catch (e) {
    return fail(e);
  }
}

const decideSchema = z.object({ id: z.string().min(1), decision: z.enum(["ACCEPTED", "REJECTED"]) });

/** Accept merges the suggestion's lines into its section (deduplicated); reject only records the decision. */
export async function decideStrategySuggestion(input: z.input<typeof decideSchema>): Promise<ActionResult> {
  try {
    const user = await assertUser("strategy:edit");
    const data = decideSchema.parse(input);
    const rec = await db.aiRecommendation.findUnique({ where: { id: data.id } });
    if (!rec || !rec.area.startsWith("strategy.")) throw new AuthError("NOT_FOUND");
    await assertClientAccess(user, rec.clientId);
    if (rec.state !== "PENDING") throw new StrategyError("ALREADY_DECIDED");

    if (data.decision === "ACCEPTED") {
      const sectionId = AREA_SECTION[rec.area as StrategyArea];
      if (!sectionId) throw new StrategyError("UNKNOWN_AREA");
      const body = (rec.body ?? {}) as { lines?: unknown };
      const lines = Array.isArray(body.lines) ? body.lines.filter((x): x is string => typeof x === "string") : [];
      const current = await db.strategy.findUnique({ where: { clientId: rec.clientId }, select: { sections: true } });
      const section = readSections(current?.sections)[sectionId];
      const seen = new Set(section.items.map((i) => i.trim().toLowerCase()));
      const merged = { text: section.text, items: [...section.items, ...lines.filter((l) => !seen.has(l.trim().toLowerCase()))] };
      const { row } = await writeSection(user, rec.clientId, sectionId, merged);
      await audit(user, { action: "update", entity: "Strategy", entityId: row.id, clientId: rec.clientId, summary: `section ${sectionId} ← AI suggestion`, diff: { section: sectionId, recommendationId: rec.id, added: merged.items.length - section.items.length } });
    }
    await db.aiRecommendation.update({ where: { id: rec.id }, data: { state: data.decision, decidedById: user.id, decidedAt: new Date() } });
    await audit(user, { action: data.decision === "ACCEPTED" ? "accept" : "reject", entity: "AiRecommendation", entityId: rec.id, clientId: rec.clientId, summary: rec.area });
    revalidatePath("/strategy");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
