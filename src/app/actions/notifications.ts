"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import type { ActionResult } from "@/components/admin/action-result";
import { ActionError, guarded } from "@/components/admin/server-action";
import { notificationWhere } from "@/components/admin/notification-scope";
import { setRead, unreadFor } from "@/lib/notifications";

function refresh() {
  revalidatePath("/notifications");
  revalidatePath("/", "layout"); // unread badge in the header
}

export async function markNotificationRead(id: string, read = true): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    const where = await notificationWhere(user);
    const rows = await db.notification.findMany({ where: { AND: [where, { id }] }, select: { id: true, userId: true } });
    const count = await setRead(user.id, rows, read);
    if (!count) throw new ActionError("settings.errNotFound");
    await audit(user, { action: read ? "read" : "unread", entity: "Notification", entityId: id });
    refresh();
    return { ok: "ui.saved" };
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    const where = await notificationWhere(user);
    const rows = await db.notification.findMany({ where: { AND: [where, unreadFor(user.id)] }, select: { id: true, userId: true } });
    const count = await setRead(user.id, rows, true);
    await audit(user, { action: "read_all", entity: "Notification", summary: String(count) });
    refresh();
    return { ok: "notifications.allRead" };
  });
}
