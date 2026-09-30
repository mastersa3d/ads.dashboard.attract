"use server";

import { unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ContentStatus, ContentType, FunnelStage, Objective, Platform, Prisma, type ContentItem } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, AuthError, type CurrentUser } from "@/lib/auth/session";
import { accessibleClientIds, assertClientAccess } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { checkTransition, INITIAL_STATUSES, LOCKED_STATUSES, type ApprovalStage } from "@/lib/content/workflow";
import { expandOccurrences, formatRecurrence, RECURRENCE_FREQS } from "@/lib/content/recurrence";
import { diffSnapshots, snapshotOf, type FieldChange, type Snapshot } from "@/lib/content/versions";
import { findConflicts, orgConflictSettings, type Conflict } from "@/lib/content/conflicts";
import { isDayKey, isValidTimeZone, zonedTime, zonedToUtc } from "@/lib/content/tz";
import { bestTimeFor, type BestTimeResult } from "@/lib/content/best-time";
import { PUBLISH_JOB_TYPE, publishingIntegrationPlatforms } from "@/lib/content/publishing";
import { assetPath } from "@/lib/content/uploads";

/**
 * Content calendar / approval server actions. Every action:
 *   assertUser(permission) → Zod parse → tenant check → workflow check → write + version → audit.
 * Actions return `{ ok: false, error }` codes (translated by the UI as content.err.<code>)
 * instead of throwing, so the drawer can show precise messages.
 */

export type ActionError =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "INVALID_TRANSITION"
  | "COMMENT_REQUIRED"
  | "PUBLISH_AT_REQUIRED"
  | "CONFLICT"
  | "CONFLICT_BLOCKED"
  | "LOCKED"
  | "NO_INTEGRATION"
  | "NOT_READY"
  | "INTERNAL";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: ActionError; conflicts?: Conflict[]; windowMinutes?: number; fields?: string[] };

async function run<T extends object>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.code };
    if (e instanceof z.ZodError) return { ok: false, error: "VALIDATION", fields: [...new Set(e.issues.map((i) => String(i.path[0] ?? "")))] };
    logger.error("content.action", { message: (e as Error)?.message });
    return { ok: false, error: "INTERNAL" };
  }
}

function revalidateContent() {
  revalidatePath("/calendar");
  revalidatePath("/library");
  revalidatePath("/approvals");
}

/** Load an item only if it belongs to a client the user can access (tenant isolation). */
async function scopedItem(user: CurrentUser, id: string) {
  const ids = await accessibleClientIds(user);
  const item = await db.contentItem.findFirst({ where: { id, clientId: { in: ids } } });
  if (!item) throw new AuthError("NOT_FOUND");
  return item;
}

async function writeVersion(tx: Prisma.TransactionClient, item: ContentItem, userId: string) {
  await tx.contentVersion.create({ data: { contentId: item.id, version: item.version, snapshot: snapshotOf(item) as Prisma.InputJsonValue, editedById: userId } });
}

/** Approval row + decision comment for a status change that is a review decision. */
async function recordDecision(
  tx: Prisma.TransactionClient,
  user: CurrentUser,
  contentId: string,
  approval: { stage: ApprovalStage; decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" } | undefined,
  comment: string | null | undefined,
) {
  if (approval) await tx.approval.create({ data: { contentId, userId: user.id, stage: approval.stage, decision: approval.decision, comment: comment?.trim() || null } });
  // Internal-review reasons stay internal; client-stage decisions are visible to the client.
  if (comment?.trim()) await tx.comment.create({ data: { contentId, userId: user.id, body: comment.trim(), internal: approval?.stage === "INTERNAL" } });
}

const auditAction = (to: ContentStatus, approval?: { decision: string }) =>
  approval?.decision === "APPROVED" ? "approve" : approval?.decision === "REJECTED" ? "reject" : approval ? "request_changes" : to === "SCHEDULED" ? "schedule" : to === "PUBLISHED" ? "publish" : "status";

// ───────────────────────────── Create / update ─────────────────────────────

const localDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const optUrl = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v == null || /^https?:\/\//i.test(v), "Invalid URL");
const tagList = z
  .array(z.string().trim().max(100))
  .max(50)
  .default([])
  .transform((xs) => [...new Set(xs.filter(Boolean))]);
const assetRef = z.string().refine((v) => /^\/api\/uploads\/[a-f0-9]{24}$/.test(v) || /^https:\/\//i.test(v), "Invalid asset");

const contentSchema = z.object({
  id: z.string().max(40).optional(),
  clientId: z.string().min(1).max(40),
  brandId: z.string().max(40).nullish().transform((v) => v || null),
  title: z.string().trim().min(1).max(200),
  campaignName: optText(160),
  platform: z.enum(Platform),
  publishLocal: z.string().regex(localDateTime).nullish().transform((v) => v || null),
  timezone: z.string().max(64).refine(isValidTimeZone, "Invalid timezone"),
  type: z.enum(ContentType),
  pillar: optText(120),
  funnelStage: z.enum(FunnelStage).nullish().transform((v) => v ?? null),
  objective: z.enum(Objective).nullish().transform((v) => v ?? null),
  audience: optText(300),
  caption: optText(5000),
  hook: optText(500),
  cta: optText(200),
  hashtags: tagList,
  keywords: tagList,
  designBrief: optText(5000),
  designUrl: optUrl,
  videoUrl: optUrl,
  assetUrls: z.array(assetRef).max(30).default([]),
  assigneeId: z.string().max(40).nullish().transform((v) => v || null),
  status: z.enum(ContentStatus),
  statusComment: optText(2000),
  notes: optText(5000),
  publishedUrl: optUrl,
  isPaid: z.boolean().default(false),
  boostBudget: z.number().nonnegative().max(1e10).nullish().transform((v) => v ?? null),
  approvalDeadlineLocal: z.string().regex(localDateTime).nullish().transform((v) => v || null),
  recurrence: z.object({ freq: z.enum(RECURRENCE_FREQS), count: z.number().int().min(2).max(52) }).nullish(),
  resultReach: z.number().int().nonnegative().nullish().transform((v) => v ?? null),
  resultEngagements: z.number().int().nonnegative().nullish().transform((v) => v ?? null),
  allowConflict: z.boolean().default(false),
});

export type ContentInput = z.input<typeof contentSchema>;

const toUtc = (local: string | null, tz: string) => (local ? zonedToUtc(local.slice(0, 10), local.slice(11, 16), tz) : null);

export async function saveContent(input: ContentInput): Promise<ActionResult<{ id: string; created: number }>> {
  return run<{ id: string; created: number }>(async () => {
    const isNew = !(input as { id?: string })?.id;
    const user = await assertUser(isNew ? "content:create" : "content:edit");
    const data = contentSchema.parse(input);
    await assertClientAccess(user, data.clientId);

    const [brand, assignee] = await Promise.all([
      data.brandId ? db.brand.findFirst({ where: { id: data.brandId, clientId: data.clientId }, select: { id: true } }) : null,
      data.assigneeId ? db.user.findFirst({ where: { id: data.assigneeId, organizationId: user.organizationId, active: true }, select: { id: true } }) : null,
    ]);
    if (data.brandId && !brand) return { ok: false, error: "VALIDATION", fields: ["brandId"] };
    if (data.assigneeId && !assignee) return { ok: false, error: "VALIDATION", fields: ["assigneeId"] };

    const publishAt = toUtc(data.publishLocal, data.timezone);
    const approvalDeadline = toUtc(data.approvalDeadlineLocal, data.timezone);
    const existing = data.id ? await scopedItem(user, data.id) : null;
    if (existing && existing.clientId !== data.clientId) return { ok: false, error: "VALIDATION", fields: ["clientId"] };

    // Workflow: new items start early in the flow; status changes on edit follow the state machine.
    let transition: ReturnType<typeof checkTransition> | null = null;
    if (!existing) {
      if (!INITIAL_STATUSES.includes(data.status)) return { ok: false, error: "INVALID_TRANSITION" };
    } else if (existing.status !== data.status) {
      transition = checkTransition(existing.status, data.status, user.perms, { comment: data.statusComment, publishAt });
      if (!transition.ok) return { ok: false, error: transition.reason };
    }

    const fields = {
      brandId: data.brandId,
      title: data.title,
      campaignName: data.campaignName,
      platform: data.platform,
      publishAt,
      timezone: data.timezone,
      type: data.type,
      pillar: data.pillar,
      funnelStage: data.funnelStage,
      objective: data.objective,
      audience: data.audience,
      caption: data.caption,
      hook: data.hook,
      cta: data.cta,
      hashtags: data.hashtags,
      keywords: data.keywords,
      designBrief: data.designBrief,
      designUrl: data.designUrl,
      videoUrl: data.videoUrl,
      assetUrls: data.assetUrls,
      assigneeId: data.assigneeId,
      status: data.status,
      notes: data.notes,
      publishedUrl: data.publishedUrl,
      isPaid: data.isPaid,
      boostBudget: data.isPaid && data.boostBudget != null ? new Prisma.Decimal(data.boostBudget) : null,
      approvalDeadline,
      resultReach: data.resultReach,
      resultEngagements: data.resultEngagements,
    };

    // Published posts are locked except for post-publish fields.
    if (existing && LOCKED_STATUSES.includes(existing.status)) {
      const allowed = { publishedUrl: fields.publishedUrl, resultReach: fields.resultReach, resultEngagements: fields.resultEngagements, notes: fields.notes, assetUrls: fields.assetUrls };
      const updated = await db.$transaction(async (tx) => {
        const row = await tx.contentItem.update({ where: { id: existing.id }, data: { ...allowed, version: { increment: 1 } } });
        await writeVersion(tx, row, user.id);
        return row;
      });
      await audit(user, { action: "update", entity: "ContentItem", entityId: updated.id, clientId: updated.clientId, summary: updated.title, diff: diffSnapshots(snapshotOf(existing), snapshotOf(updated)) });
      revalidateContent();
      return { ok: true, id: updated.id, created: 0 };
    }

    // Occurrences (recurrence only on create) + conflict prevention.
    const recurrence = !existing && data.recurrence && publishAt ? data.recurrence : null;
    const slots = publishAt ? (recurrence ? expandOccurrences(publishAt, recurrence, data.timezone) : [publishAt]) : [];
    const moved = !existing || existing.publishAt?.getTime() !== publishAt?.getTime() || existing.platform !== data.platform;
    if (slots.length && moved && data.status !== "REJECTED") {
      const settings = await orgConflictSettings(user.organizationId);
      const conflicts = await findConflicts({ clientId: data.clientId, platform: data.platform, slots, windowMinutes: settings.windowMinutes, excludeIds: existing ? [existing.id] : [] });
      if (conflicts.length && (settings.mode === "block" || !data.allowConflict)) {
        return { ok: false, error: settings.mode === "block" ? "CONFLICT_BLOCKED" : "CONFLICT", conflicts, windowMinutes: settings.windowMinutes };
      }
    }

    if (existing) {
      const t = transition && transition.ok ? transition.transition : undefined;
      const updated = await db.$transaction(async (tx) => {
        const row = await tx.contentItem.update({ where: { id: existing.id }, data: { ...fields, version: { increment: 1 } } });
        await writeVersion(tx, row, user.id);
        if (t) await recordDecision(tx, user, row.id, t.approval, data.statusComment);
        return row;
      });
      const diff = diffSnapshots(snapshotOf(existing), snapshotOf(updated));
      await audit(user, { action: "update", entity: "ContentItem", entityId: updated.id, clientId: updated.clientId, summary: updated.title, diff });
      if (t) await audit(user, { action: auditAction(updated.status, t.approval), entity: "ContentItem", entityId: updated.id, clientId: updated.clientId, summary: `${existing.status} → ${updated.status}`, diff: { comment: data.statusComment } });
      revalidateContent();
      return { ok: true, id: updated.id, created: 0 };
    }

    const seriesId = recurrence ? randomUUID() : null;
    const recurrenceStr = recurrence ? formatRecurrence(recurrence) : null;
    const slotList: (Date | null)[] = slots.length ? slots : [null];
    const deadlineOffset = approvalDeadline && publishAt ? publishAt.getTime() - approvalDeadline.getTime() : null;
    const rows = await db.$transaction(async (tx) => {
      const out: ContentItem[] = [];
      for (const slot of slotList) {
        const row = await tx.contentItem.create({
          data: {
            ...fields,
            clientId: data.clientId,
            publishAt: slot,
            approvalDeadline: slot && deadlineOffset != null ? new Date(slot.getTime() - deadlineOffset) : approvalDeadline,
            recurrence: recurrenceStr,
            seriesId,
            createdById: user.id,
            source: "MANUAL",
            version: 1,
          },
        });
        await writeVersion(tx, row, user.id);
        out.push(row);
      }
      return out;
    });
    await audit(user, {
      action: "create",
      entity: "ContentItem",
      entityId: rows[0].id,
      clientId: data.clientId,
      summary: rows.length > 1 ? `${data.title} (×${rows.length}, ${recurrenceStr})` : data.title,
      diff: { ids: rows.map((r) => r.id), seriesId, status: data.status, platform: data.platform, publishAt: publishAt?.toISOString() ?? null },
    });
    revalidateContent();
    return { ok: true, id: rows[0].id, created: rows.length };
  });
}

// ───────────────────────────── Status changes ─────────────────────────────

const statusSchema = z.object({ id: z.string().min(1).max(40), to: z.enum(ContentStatus), comment: optText(2000) });

export async function changeStatus(input: z.input<typeof statusSchema>): Promise<ActionResult> {
  return run<object>(async () => {
    const user = await assertUser("content:view");
    const data = statusSchema.parse(input);
    const item = await scopedItem(user, data.id);
    const check = checkTransition(item.status, data.to, user.perms, { comment: data.comment, publishAt: item.publishAt });
    if (!check.ok) return { ok: false, error: check.reason };
    await db.$transaction(async (tx) => {
      const row = await tx.contentItem.update({ where: { id: item.id }, data: { status: data.to, version: { increment: 1 } } });
      await writeVersion(tx, row, user.id);
      await recordDecision(tx, user, item.id, check.transition.approval, data.comment);
    });
    await audit(user, { action: auditAction(data.to, check.transition.approval), entity: "ContentItem", entityId: item.id, clientId: item.clientId, summary: `${item.status} → ${data.to}`, diff: { from: item.status, to: data.to, comment: data.comment } });
    revalidateContent();
    return { ok: true };
  });
}

const bulkSchema = z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(100) });

/** Manager bulk approval: Internal Review → Client Review, Client Review → Approved. */
export async function bulkApprove(input: z.input<typeof bulkSchema>): Promise<ActionResult<{ approved: number; skipped: number }>> {
  return run<{ approved: number; skipped: number }>(async () => {
    const user = await assertUser("content:view");
    if (!user.perms.has("content:approve_internal")) throw new AuthError("FORBIDDEN");
    const { ids } = bulkSchema.parse(input);
    const clientIds = await accessibleClientIds(user);
    const items = await db.contentItem.findMany({ where: { id: { in: ids }, clientId: { in: clientIds } } });
    let approved = 0;
    for (const item of items) {
      const to: ContentStatus | null = item.status === "INTERNAL_REVIEW" ? "CLIENT_REVIEW" : item.status === "CLIENT_REVIEW" ? "APPROVED" : null;
      const check = to ? checkTransition(item.status, to, user.perms, {}) : null;
      if (!to || !check?.ok) continue;
      await db.$transaction(async (tx) => {
        const row = await tx.contentItem.update({ where: { id: item.id }, data: { status: to, version: { increment: 1 } } });
        await writeVersion(tx, row, user.id);
        await recordDecision(tx, user, item.id, check.transition.approval, null);
      });
      await audit(user, { action: "approve", entity: "ContentItem", entityId: item.id, clientId: item.clientId, summary: `${item.status} → ${to} (bulk)`, diff: { from: item.status, to, bulk: true } });
      approved++;
    }
    revalidateContent();
    return { ok: true, approved, skipped: ids.length - approved };
  });
}

// ───────────────────────────── Drag & drop reschedule ─────────────────────────────

const moveSchema = z.object({
  id: z.string().min(1).max(40),
  day: z.string().refine(isDayKey),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  /** timezone the calendar is displayed in (the drop target's day/hour are in this zone) */
  tz: z.string().max(64).refine(isValidTimeZone),
  allowConflict: z.boolean().default(false),
});

export async function moveContent(input: z.input<typeof moveSchema>): Promise<ActionResult<{ publishAt: string }>> {
  return run<{ publishAt: string }>(async () => {
    const user = await assertUser("content:edit");
    const data = moveSchema.parse(input);
    const item = await scopedItem(user, data.id);
    if (LOCKED_STATUSES.includes(item.status)) return { ok: false, error: "LOCKED" };
    const time = data.time ?? (item.publishAt ? zonedTime(item.publishAt, data.tz) : "10:00");
    const publishAt = zonedToUtc(data.day, time, data.tz);
    if (item.publishAt?.getTime() === publishAt.getTime()) return { ok: true, publishAt: publishAt.toISOString() };

    const settings = await orgConflictSettings(user.organizationId);
    const conflicts = await findConflicts({ clientId: item.clientId, platform: item.platform, slots: [publishAt], windowMinutes: settings.windowMinutes, excludeIds: [item.id] });
    if (conflicts.length && (settings.mode === "block" || !data.allowConflict)) {
      return { ok: false, error: settings.mode === "block" ? "CONFLICT_BLOCKED" : "CONFLICT", conflicts, windowMinutes: settings.windowMinutes };
    }
    // Keep the approval deadline the same distance before the post.
    const deadline = item.approvalDeadline && item.publishAt ? new Date(item.approvalDeadline.getTime() + (publishAt.getTime() - item.publishAt.getTime())) : item.approvalDeadline;
    await db.$transaction(async (tx) => {
      const row = await tx.contentItem.update({ where: { id: item.id }, data: { publishAt, approvalDeadline: deadline, version: { increment: 1 } } });
      await writeVersion(tx, row, user.id);
    });
    await audit(user, { action: "reschedule", entity: "ContentItem", entityId: item.id, clientId: item.clientId, summary: item.title, diff: { from: item.publishAt?.toISOString() ?? null, to: publishAt.toISOString(), conflictsAccepted: conflicts.length } });
    revalidateContent();
    return { ok: true, publishAt: publishAt.toISOString() };
  });
}

// ───────────────────────────── Comments ─────────────────────────────

const commentSchema = z.object({ contentId: z.string().min(1).max(40), body: z.string().trim().min(1).max(4000), internal: z.boolean().default(false) });

export async function addComment(input: z.input<typeof commentSchema>): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const user = await assertUser("content:comment");
    const data = commentSchema.parse(input);
    if (data.internal && !user.perms.has("content:comment_internal")) throw new AuthError("FORBIDDEN");
    const item = await scopedItem(user, data.contentId);
    const c = await db.comment.create({ data: { contentId: item.id, userId: user.id, body: data.body, internal: data.internal } });
    await audit(user, { action: "comment", entity: "ContentItem", entityId: item.id, clientId: item.clientId, summary: data.internal ? "internal comment" : "comment" });
    revalidateContent();
    return { ok: true, id: c.id };
  });
}

// ───────────────────────────── Detail (drawer tabs) ─────────────────────────────

export type ContentDetail = {
  comments: { id: string; body: string; internal: boolean; userName: string; createdAt: string }[];
  approvals: { id: string; stage: string; decision: string; comment: string | null; userName: string; createdAt: string }[];
  versions: { id: string; version: number; editedBy: string | null; createdAt: string; changes: FieldChange[] }[];
  publishJob: { status: string; runAt: string; lastError: string | null } | null;
};

export async function getContentDetail(id: string): Promise<ActionResult<{ detail: ContentDetail }>> {
  return run<{ detail: ContentDetail }>(async () => {
    const user = await assertUser("content:view");
    const item = await scopedItem(user, z.string().min(1).max(40).parse(id));
    const seeInternal = user.perms.has("content:comment_internal");
    const [comments, approvals, versions, job] = await Promise.all([
      db.comment.findMany({ where: { contentId: item.id, ...(seeInternal ? {} : { internal: false }) }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 500 }),
      db.approval.findMany({ where: { contentId: item.id }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 }),
      db.contentVersion.findMany({ where: { contentId: item.id }, orderBy: { version: "asc" }, take: 200 }),
      db.job.findFirst({ where: { organizationId: user.organizationId, type: PUBLISH_JOB_TYPE, payload: { path: ["contentId"], equals: item.id } }, orderBy: { createdAt: "desc" } }),
    ]);
    const editorIds = [...new Set(versions.map((v) => v.editedById).filter((x): x is string => Boolean(x)))];
    const editors = new Map((await db.user.findMany({ where: { id: { in: editorIds }, organizationId: user.organizationId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    let prev: Snapshot | null = null;
    const vs: ContentDetail["versions"] = [];
    for (const v of versions) {
      const snap = v.snapshot as Snapshot;
      vs.push({ id: v.id, version: v.version, editedBy: v.editedById ? (editors.get(v.editedById) ?? null) : null, createdAt: v.createdAt.toISOString(), changes: diffSnapshots(prev, snap) });
      prev = snap;
    }
    return {
      ok: true,
      detail: {
        comments: comments.map((c) => ({ id: c.id, body: c.body, internal: c.internal, userName: c.user.name, createdAt: c.createdAt.toISOString() })),
        approvals: approvals.map((a) => ({ id: a.id, stage: a.stage, decision: a.decision, comment: a.comment, userName: a.user.name, createdAt: a.createdAt.toISOString() })),
        versions: vs.reverse(),
        publishJob: job ? { status: job.status, runAt: job.runAt.toISOString(), lastError: job.lastError } : null,
      },
    };
  });
}

// ───────────────────────────── Delete ─────────────────────────────

const deleteSchema = z.object({ id: z.string().min(1).max(40), series: z.boolean().default(false) });

export async function deleteContent(input: z.input<typeof deleteSchema>): Promise<ActionResult<{ deleted: number }>> {
  return run<{ deleted: number }>(async () => {
    const user = await assertUser("content:delete");
    const data = deleteSchema.parse(input);
    const item = await scopedItem(user, data.id);
    // Deleting a series removes the not-yet-published occurrences only.
    const where: Prisma.ContentItemWhereInput =
      data.series && item.seriesId ? { seriesId: item.seriesId, clientId: item.clientId, status: { not: "PUBLISHED" } } : { id: item.id, clientId: item.clientId };
    const { count } = await db.contentItem.deleteMany({ where });
    await audit(user, { action: "delete", entity: "ContentItem", entityId: item.id, clientId: item.clientId, summary: item.title, diff: { series: data.series ? item.seriesId : null, count } });
    revalidateContent();
    return { ok: true, deleted: count };
  });
}

// ───────────────────────────── Publish via official API ─────────────────────────────

export async function enqueuePublish(id: string): Promise<ActionResult<{ runAt: string }>> {
  return run<{ runAt: string }>(async () => {
    const user = await assertUser("content:edit");
    const item = await scopedItem(user, z.string().min(1).max(40).parse(id));
    if (!["APPROVED", "SCHEDULED"].includes(item.status)) return { ok: false, error: "NOT_READY" };
    if (!item.publishAt) return { ok: false, error: "PUBLISH_AT_REQUIRED" };
    const integration = await db.integration.findFirst({
      where: { organizationId: user.organizationId, clientId: item.clientId, platform: { in: publishingIntegrationPlatforms(item.platform) }, status: "CONNECTED", enabled: true },
      select: { id: true, platform: true },
    });
    if (!integration) return { ok: false, error: "NO_INTEGRATION" };

    const runAt = item.publishAt.getTime() > Date.now() ? item.publishAt : new Date();
    const payload = { contentId: item.id, clientId: item.clientId, integrationId: integration.id, platform: item.platform, requestedBy: user.id };
    await db.$transaction(async (tx) => {
      const queued = await tx.job.findFirst({ where: { organizationId: user.organizationId, type: PUBLISH_JOB_TYPE, status: "QUEUED", payload: { path: ["contentId"], equals: item.id } } });
      if (queued) await tx.job.update({ where: { id: queued.id }, data: { runAt, payload } });
      else await tx.job.create({ data: { organizationId: user.organizationId, type: PUBLISH_JOB_TYPE, payload, runAt } });
      if (item.status === "APPROVED") {
        const row = await tx.contentItem.update({ where: { id: item.id }, data: { status: "SCHEDULED", version: { increment: 1 } } });
        await writeVersion(tx, row, user.id);
      }
    });
    await audit(user, { action: "schedule_publish", entity: "ContentItem", entityId: item.id, clientId: item.clientId, summary: item.title, diff: { integrationId: integration.id, platform: integration.platform, runAt: runAt.toISOString() } });
    revalidateContent();
    return { ok: true, runAt: runAt.toISOString() };
  });
}

// ───────────────────────────── Best time to post ─────────────────────────────

const bestTimeSchema = z.object({
  clientId: z.string().min(1).max(40),
  platform: z.enum(Platform).nullish(),
  timezone: z.string().max(64).refine(isValidTimeZone),
  chosenLocal: z.string().regex(localDateTime).nullish(),
});

export async function getBestTime(input: z.input<typeof bestTimeSchema>): Promise<ActionResult<{ result: BestTimeResult }>> {
  return run<{ result: BestTimeResult }>(async () => {
    const user = await assertUser("content:view");
    const data = bestTimeSchema.parse(input);
    await assertClientAccess(user, data.clientId);
    const result = await bestTimeFor({ clientId: data.clientId, platform: data.platform ?? null, timezone: data.timezone, chosen: toUtc(data.chosenLocal ?? null, data.timezone) });
    return { ok: true, result };
  });
}

// ───────────────────────────── File library ─────────────────────────────

export async function deleteFile(id: string): Promise<ActionResult> {
  return run<object>(async () => {
    const user = await assertUser("content:delete");
    const ids = await accessibleClientIds(user);
    const file = await db.fileAsset.findFirst({ where: { id: z.string().min(1).max(40).parse(id), clientId: { in: ids } } });
    if (!file) throw new AuthError("NOT_FOUND");
    await db.fileAsset.delete({ where: { id: file.id } });
    const p = assetPath(file.clientId, file.id, file.mimeType);
    if (p) await unlink(p).catch(() => undefined); // row is the source of truth; a missing file is fine
    await audit(user, { action: "delete", entity: "FileAsset", entityId: file.id, clientId: file.clientId, summary: file.name });
    revalidatePath("/library");
    return { ok: true };
  });
}
