"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Priority, TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, AuthError, type CurrentUser } from "@/lib/auth/session";
import { assertClientAccess } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  logger.error("tasks.action_failed", { message: (e as Error)?.message });
  return { ok: false, error: "INTERNAL" };
}

const saveSchema = z.object({
  id: z.string().max(64).optional(),
  clientId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).optional().or(z.literal("")),
  assigneeId: z.string().max(64).optional().or(z.literal("")),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  priority: z.enum(Priority),
  status: z.enum(TaskStatus),
  reportId: z.string().max(64).optional().or(z.literal("")),
});

async function loadTask(user: CurrentUser, id: string) {
  const task = await db.task.findFirst({ where: { id, client: { organizationId: user.organizationId } } });
  if (!task) throw new AuthError("NOT_FOUND");
  await assertClientAccess(user, task.clientId);
  return task;
}

/** Assignee must be an active user of the org who can see the task's client (CLIENT/VIEWER need ClientAccess). */
async function checkAssignee(user: CurrentUser, assigneeId: string | undefined, clientId: string) {
  if (!assigneeId) return null;
  const u = await db.user.findFirst({ where: { id: assigneeId, organizationId: user.organizationId, active: true }, select: { id: true, role: true, clientAccess: { select: { clientId: true } } } });
  if (!u) throw new z.ZodError([{ code: "custom", message: "Unknown owner", path: ["assigneeId"], input: assigneeId }]);
  if ((u.role === "CLIENT" || u.role === "VIEWER") && !u.clientAccess.some((a) => a.clientId === clientId)) {
    throw new z.ZodError([{ code: "custom", message: "Owner has no access to this client", path: ["assigneeId"], input: assigneeId }]);
  }
  return u.id;
}

export async function saveTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await assertUser("tasks:edit");
    const d = saveSchema.parse(input);
    await assertClientAccess(user, d.clientId);
    const existing = d.id ? await loadTask(user, d.id) : null;
    let reportId: string | null = null;
    if (d.reportId) {
      const r = await db.report.findFirst({ where: { id: d.reportId, clientId: d.clientId }, select: { id: true } });
      reportId = r?.id ?? null;
    }
    const data = {
      clientId: d.clientId,
      title: d.title,
      description: d.description || null,
      assigneeId: await checkAssignee(user, d.assigneeId || undefined, d.clientId),
      dueDate: d.dueDate ? new Date(d.dueDate + "T12:00:00Z") : null,
      priority: d.priority,
      status: d.status,
      reportId,
    };
    const task = existing ? await db.task.update({ where: { id: existing.id }, data }) : await db.task.create({ data: { ...data, createdById: user.id } });
    await audit(user, { action: existing ? "update" : "create", entity: "Task", entityId: task.id, clientId: d.clientId, summary: d.title, diff: { ...data, description: undefined } });
    revalidatePath("/tasks");
    return { ok: true, data: { id: task.id } };
  } catch (e) {
    return fail(e);
  }
}

/** Status change: team members with tasks:edit, or the task's own assignee (e.g. a CLIENT user). */
export async function setTaskStatus(input: unknown): Promise<ActionResult> {
  try {
    const user = await assertUser("tasks:view");
    const d = z.object({ id: z.string().min(1).max(64), status: z.enum(TaskStatus) }).parse(input);
    const task = await loadTask(user, d.id);
    if (!user.perms.has("tasks:edit") && task.assigneeId !== user.id) throw new AuthError("FORBIDDEN");
    if (task.status === d.status) return { ok: true };
    await db.task.update({ where: { id: task.id }, data: { status: d.status } });
    await audit(user, { action: "update", entity: "Task", entityId: task.id, clientId: task.clientId, summary: `${task.title}: ${task.status} → ${d.status}`, diff: { status: [task.status, d.status] } });
    revalidatePath("/tasks");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTask(id: unknown): Promise<ActionResult> {
  try {
    const user = await assertUser("tasks:edit");
    const task = await loadTask(user, z.string().min(1).max(64).parse(id));
    await db.task.delete({ where: { id: task.id } });
    await audit(user, { action: "delete", entity: "Task", entityId: task.id, clientId: task.clientId, summary: task.title });
    revalidatePath("/tasks");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
