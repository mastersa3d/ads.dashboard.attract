import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { AuthError, type CurrentUser } from "@/lib/auth/session";
import { CLIENT_SCOPED_ROLES } from "@/lib/rbac";

/**
 * Multi-tenant isolation. EVERY query for client-owned data must be constrained with
 * `clientWhere(user)` / `assertClientAccess(user, clientId)`.
 *
 *  - SUPER_ADMIN / COMPANY_MANAGER: all clients of their organization.
 *  - MARKETING_TEAM: clients listed in ClientAccess, or all org clients if none are listed.
 *  - CLIENT / VIEWER: only clients listed in ClientAccess (none listed → nothing visible).
 */
export const accessibleClientIds = cache(async (user: CurrentUser): Promise<string[]> => {
  const orgClients = await db.client.findMany({
    where: { organizationId: user.organizationId, archived: false },
    select: { id: true },
  });
  const all = orgClients.map((c) => c.id);
  if (user.role === "SUPER_ADMIN" || user.role === "COMPANY_MANAGER") return all;

  const access = await db.clientAccess.findMany({ where: { userId: user.id }, select: { clientId: true } });
  const allowed = new Set(access.map((a) => a.clientId));
  if (user.role === "MARKETING_TEAM" && allowed.size === 0) return all;
  if (CLIENT_SCOPED_ROLES.includes(user.role) || allowed.size > 0) return all.filter((id) => allowed.has(id));
  return [];
});

/** Prisma `where` fragment for models that have `clientId`. */
export async function clientWhere(user: CurrentUser, requested?: string | null) {
  const ids = await accessibleClientIds(user);
  if (requested) {
    if (!ids.includes(requested)) return { clientId: { in: [] as string[] } };
    return { clientId: requested };
  }
  return { clientId: { in: ids } };
}

export async function assertClientAccess(user: CurrentUser, clientId: string) {
  const ids = await accessibleClientIds(user);
  if (!ids.includes(clientId)) throw new AuthError("NOT_FOUND");
}

export async function accessibleClients(user: CurrentUser) {
  const ids = await accessibleClientIds(user);
  return db.client.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      brandColors: true,
      currency: true,
      timezone: true,
      isDemo: true,
      hiddenSections: true,
      brands: { select: { id: true, name: true } },
      accounts: { select: { id: true, name: true, platform: true, brandId: true } },
    },
    orderBy: { name: "asc" },
  });
}
