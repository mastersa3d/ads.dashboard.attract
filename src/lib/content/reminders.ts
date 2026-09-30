import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PENDING_APPROVAL_STATUSES } from "./workflow";
import { DUE_SOON_HOURS, NOT_DUE_STATUSES } from "./due";

export { DUE_SOON_HOURS, isApprovalOverdue, isDueSoon } from "./due";

/**
 * "Due soon" queries shared by the calendar UI and the notifications worker.
 * Deliberately free of `server-only` so `worker/` can import it. Callers pass the tenant
 * scope (`{ clientId }` / `{ clientId: { in } }`) — never call without one.
 */

type Scope = { clientId: string | { in: string[] } };

/** Upcoming posts inside the next `hours` (not yet published). `notReady` = not approved yet. */
export async function contentDueSoon(scope: Scope, opts: { now?: Date; hours?: number; where?: Prisma.ContentItemWhereInput; take?: number } = {}) {
  const now = opts.now ?? new Date();
  const until = new Date(now.getTime() + (opts.hours ?? DUE_SOON_HOURS) * 3600000);
  const rows = await db.contentItem.findMany({
    where: { ...opts.where, ...scope, publishAt: { gte: now, lte: until }, status: { notIn: NOT_DUE_STATUSES } },
    select: { id: true, clientId: true, title: true, platform: true, publishAt: true, status: true, assigneeId: true, timezone: true },
    orderBy: { publishAt: "asc" },
    take: opts.take ?? 50,
  });
  return rows.map((r) => ({ ...r, publishAt: r.publishAt as Date, notReady: !["APPROVED", "SCHEDULED"].includes(r.status) }));
}

/** Items whose approvalDeadline has passed while still awaiting a decision. */
export async function overdueApprovals(scope: Scope, opts: { now?: Date; where?: Prisma.ContentItemWhereInput; take?: number } = {}) {
  const now = opts.now ?? new Date();
  return db.contentItem.findMany({
    where: { ...opts.where, ...scope, approvalDeadline: { lt: now }, status: { in: PENDING_APPROVAL_STATUSES } },
    select: { id: true, clientId: true, title: true, platform: true, publishAt: true, approvalDeadline: true, status: true, assigneeId: true },
    orderBy: { approvalDeadline: "asc" },
    take: opts.take ?? 50,
  });
}
