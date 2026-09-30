import "server-only";
import type { Prisma } from "@prisma/client";
import type { CurrentUser } from "@/lib/auth/session";
import { accessibleClientIds } from "@/lib/tenant";
import { CLIENT_SCOPED_ROLES } from "@/lib/rbac";

/**
 * Notifications visible to a user: their own, client alerts for clients they can access, and
 * organisation-wide alerts (no client) — the latter only for internal roles, since they may
 * mention other clients or internal operations.
 */
export async function notificationWhere(user: CurrentUser): Promise<Prisma.NotificationWhereInput> {
  const ids = await accessibleClientIds(user);
  const or: Prisma.NotificationWhereInput[] = [{ userId: user.id }, { userId: null, clientId: { in: ids } }];
  if (!CLIENT_SCOPED_ROLES.includes(user.role)) or.push({ userId: null, clientId: null });
  return { organizationId: user.organizationId, OR: or };
}
