import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Read state: personal notifications (userId set) use Notification.readAt; shared ones
 * (org-wide / client-wide, userId null) use a per-user NotificationRead receipt so one user
 * reading an alert never hides it from colleagues.
 */
export function unreadFor(userId: string): Prisma.NotificationWhereInput {
  return { OR: [{ userId, readAt: null }, { userId: null, reads: { none: { userId } } }] };
}

export async function readIds(userId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.notificationRead.findMany({ where: { userId, notificationId: { in: ids } }, select: { notificationId: true } });
  return new Set(rows.map((r) => r.notificationId));
}

export function isRead(n: { id: string; userId: string | null; readAt: Date | null }, shared: Set<string>) {
  return n.userId ? Boolean(n.readAt) : shared.has(n.id);
}

/** Mark notifications (already filtered to what the user may see) read/unread for this user. */
export async function setRead(userId: string, rows: { id: string; userId: string | null }[], read: boolean) {
  const personal = rows.filter((r) => r.userId === userId).map((r) => r.id);
  const shared = rows.filter((r) => r.userId === null).map((r) => r.id);
  await db.$transaction([
    db.notification.updateMany({ where: { id: { in: personal } }, data: { readAt: read ? new Date() : null } }),
    read
      ? db.notificationRead.createMany({ data: shared.map((notificationId) => ({ notificationId, userId })), skipDuplicates: true })
      : db.notificationRead.deleteMany({ where: { userId, notificationId: { in: shared } } }),
  ]);
  return personal.length + shared.length;
}
