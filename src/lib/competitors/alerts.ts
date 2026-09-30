import "server-only";
import { db } from "@/lib/db";
import { effectivePermissions, CLIENT_SCOPED_ROLES } from "@/lib/rbac";

/**
 * Org users who may see competitor data of `clientId`. Mirrors lib/tenant.ts accessibleClientIds()
 * (which works per request user) for fan-out to every recipient at once.
 */
export async function competitorAlertRecipients(organizationId: string, clientId: string) {
  const users = await db.user.findMany({
    where: { organizationId, active: true },
    select: { id: true, role: true, permissions: true, clientAccess: { select: { clientId: true } } },
  });
  return users
    .filter((u) => effectivePermissions(u.role, u.permissions).has("competitors:view"))
    .filter((u) => {
      if (u.role === "SUPER_ADMIN" || u.role === "COMPANY_MANAGER") return true;
      const allowed = u.clientAccess.map((a) => a.clientId);
      if (u.role === "MARKETING_TEAM" && allowed.length === 0) return true;
      return (CLIENT_SCOPED_ROLES.includes(u.role) || allowed.length > 0) && allowed.includes(clientId);
    })
    .map((u) => u.id);
}
