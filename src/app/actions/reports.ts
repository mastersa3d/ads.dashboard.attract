"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Platform, Priority, ReportType, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, AuthError, type CurrentUser } from "@/lib/auth/session";
import { assertClientAccess } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { enqueue } from "@/lib/jobs/queue";
import { REPORT_CHARTS, REPORT_KPIS, readConfig, readSummary, reportThemeSchema } from "@/lib/reports/schema";
import { MAX_SHARE_DAYS, newShareToken, withoutDeliveryLinks } from "@/lib/reports/share";
import { formatSchedule, WEEKDAYS } from "@/lib/reports/schedule";

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  logger.error("reports.action_failed", { message: (e as Error)?.message });
  return { ok: false, error: "INTERNAL" };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const lines = z.array(z.string().trim().min(1).max(500)).max(30);

const saveSchema = z
  .object({
    id: z.string().max(64).optional(),
    clientId: z.string().min(1).max(64),
    type: z.enum(ReportType),
    title: z.string().trim().min(1).max(200),
    periodStart: day,
    periodEnd: day,
    platforms: z.array(z.enum(Platform)).max(20),
    kpis: z.array(z.enum(REPORT_KPIS)).min(1).max(REPORT_KPIS.length),
    charts: z.array(z.enum(REPORT_CHARTS)).max(REPORT_CHARTS.length),
    compare: z.enum(["prev", "yoy", "none"]),
    theme: reportThemeSchema,
    executive: z.string().max(5000),
    wins: lines,
    challenges: lines,
    learnings: lines,
    recommendations: lines,
    comments: z.string().max(5000),
    nextActions: z
      .array(z.object({ title: z.string().trim().min(1).max(300), assigneeId: z.string().max(64).optional().or(z.literal("")), dueDate: day.optional().or(z.literal("")), priority: z.enum(Priority).default("MEDIUM") }))
      .max(30),
  })
  .refine((d) => d.periodStart <= d.periodEnd, { message: "Start must be before end", path: ["periodEnd"] });

async function loadReport(user: CurrentUser, id: string) {
  const r = await db.report.findFirst({ where: { id, client: { organizationId: user.organizationId } } });
  if (!r) throw new AuthError("NOT_FOUND");
  await assertClientAccess(user, r.clientId);
  return r;
}

/** Only active users of the same organization can own action items. */
async function validAssignee(user: CurrentUser, assigneeId: string | undefined) {
  if (!assigneeId) return null;
  const u = await db.user.findFirst({ where: { id: assigneeId, organizationId: user.organizationId, active: true }, select: { id: true } });
  return u?.id ?? null;
}

/** Create or update a report; each new "next action" becomes a Task (owner + due date) linked to it. */
export async function saveReport(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await assertUser("reports:create");
    const d = saveSchema.parse(input);
    await assertClientAccess(user, d.clientId);
    const existing = d.id ? await loadReport(user, d.id) : null;
    if (existing && existing.clientId !== d.clientId) throw new AuthError("FORBIDDEN");

    const prevConfig = existing ? ((existing.config ?? {}) as Record<string, unknown>) : {};
    const prevCfg = readConfig(existing?.config);
    const config = {
      ...prevConfig, // keeps delivery link hashes
      platforms: d.platforms,
      kpis: d.kpis,
      charts: d.charts,
      compare: d.compare,
      rolling: prevCfg.rolling,
      theme: d.theme,
    };
    const prevSummary = readSummary(existing?.summary);
    const summary = { executive: d.executive, wins: d.wins, challenges: d.challenges, learnings: d.learnings, recommendations: d.recommendations, comments: d.comments, nextActions: prevSummary.nextActions };
    const data = {
      clientId: d.clientId,
      type: d.type,
      title: d.title,
      periodStart: new Date(d.periodStart + "T00:00:00Z"),
      periodEnd: new Date(d.periodEnd + "T00:00:00Z"),
      config: config as Prisma.InputJsonValue,
      summary: summary as Prisma.InputJsonValue,
    };
    const report = existing ? await db.report.update({ where: { id: existing.id }, data }) : await db.report.create({ data: { ...data, createdById: user.id } });

    const created: string[] = [];
    for (const a of d.nextActions) {
      const task = await db.task.create({
        data: {
          clientId: d.clientId,
          reportId: report.id,
          title: a.title,
          assigneeId: await validAssignee(user, a.assigneeId || undefined),
          dueDate: a.dueDate ? new Date(a.dueDate + "T12:00:00Z") : null,
          priority: a.priority,
          createdById: user.id,
        },
      });
      created.push(task.id);
    }
    await audit(user, {
      action: existing ? "update" : "create",
      entity: "Report",
      entityId: report.id,
      clientId: d.clientId,
      summary: `${d.title}${created.length ? ` (+${created.length} action items)` : ""}`,
      diff: { type: d.type, period: [d.periodStart, d.periodEnd], kpis: d.kpis, charts: d.charts, tasks: created },
    });
    revalidatePath("/reports");
    revalidatePath("/tasks");
    return { ok: true, data: { id: report.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteReport(id: unknown): Promise<ActionResult> {
  try {
    const user = await assertUser("reports:create");
    const r = await loadReport(user, z.string().min(1).parse(id));
    await db.report.delete({ where: { id: r.id } }); // tasks keep existing (reportId → null)
    await audit(user, { action: "delete", entity: "Report", entityId: r.id, clientId: r.clientId, summary: r.title });
    revalidatePath("/reports");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Creates (or replaces) the public read-only link. The raw token is returned ONCE and never stored. */
export async function createShareLink(input: unknown): Promise<ActionResult<{ token: string; expiresAt: string }>> {
  try {
    const user = await assertUser("reports:share");
    const d = z.object({ id: z.string().min(1), days: z.number().int().min(1).max(MAX_SHARE_DAYS) }).parse(input);
    const r = await loadReport(user, d.id);
    const { token, hash } = newShareToken();
    const expiresAt = new Date(Date.now() + d.days * 86_400_000);
    await db.report.update({ where: { id: r.id }, data: { shareTokenHash: hash, shareExpiresAt: expiresAt } });
    await audit(user, { action: "share", entity: "Report", entityId: r.id, clientId: r.clientId, summary: `Public link created, expires ${expiresAt.toISOString().slice(0, 10)}` });
    revalidatePath(`/reports/${r.id}`);
    return { ok: true, data: { token, expiresAt: expiresAt.toISOString() } };
  } catch (e) {
    return fail(e);
  }
}

/** Revokes the manual share link and every scheduled-delivery link. */
export async function revokeShareLink(id: unknown): Promise<ActionResult> {
  try {
    const user = await assertUser("reports:share");
    const r = await loadReport(user, z.string().min(1).parse(id));
    await db.report.update({ where: { id: r.id }, data: { shareTokenHash: null, shareExpiresAt: null, config: withoutDeliveryLinks(r.config) } });
    await audit(user, { action: "revoke", entity: "Report", entityId: r.id, clientId: r.clientId, summary: "Public links revoked" });
    revalidatePath(`/reports/${r.id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const scheduleSchema = z.object({
  id: z.string().min(1),
  freq: z.enum(["none", "daily", "weekly", "monthly"]),
  weekday: z.enum(WEEKDAYS).default("mon"),
  monthDay: z.number().int().min(1).max(28).default(1),
  time: time.default("09:00"),
  recipients: z.array(z.email().max(200)).max(20),
  rolling: z.boolean(),
});

export async function saveSchedule(input: unknown): Promise<ActionResult> {
  try {
    const user = await assertUser("reports:share");
    const d = scheduleSchema.parse(input);
    const r = await loadReport(user, d.id);
    const [hour, minute] = d.time.split(":").map(Number);
    const schedule =
      d.freq === "none" ? null : formatSchedule({ freq: d.freq, day: d.freq === "weekly" ? WEEKDAYS.indexOf(d.weekday) : d.freq === "monthly" ? d.monthDay : 0, hour, minute });
    const config = { ...((r.config ?? {}) as Record<string, unknown>), rolling: d.rolling };
    const recipients = [...new Set(d.recipients.map((x) => x.toLowerCase()))];
    await db.report.update({ where: { id: r.id }, data: { schedule, recipients, config: config as Prisma.InputJsonValue } });
    await audit(user, { action: "update", entity: "Report", entityId: r.id, clientId: r.clientId, summary: schedule ? `Scheduled ${schedule} to ${recipients.length} recipient(s)` : "Schedule removed", diff: { schedule, recipients: recipients.length } });
    revalidatePath(`/reports/${r.id}`);
    revalidatePath("/reports");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function sendReportNow(id: unknown): Promise<ActionResult<{ deduped: boolean }>> {
  try {
    const user = await assertUser("reports:share");
    const r = await loadReport(user, z.string().min(1).parse(id));
    if (!r.recipients.length) return { ok: false, error: "NO_RECIPIENTS" };
    const job = await enqueue("report.send", { reportId: r.id, scheduled: false }, { organizationId: user.organizationId, dedupeKey: `report:${r.id}:manual`, maxAttempts: 3 });
    await audit(user, { action: "send", entity: "Report", entityId: r.id, clientId: r.clientId, summary: `Send requested to ${r.recipients.length} recipient(s)` });
    return { ok: true, data: { deduped: job.deduped } };
  } catch (e) {
    return fail(e);
  }
}
