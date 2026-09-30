import type { Role } from "@prisma/client";

/**
 * Permission catalogue. Format: "<resource>:<action>".
 * Role defaults live in ROLE_PERMISSIONS; per-user overrides are stored in User.permissions
 * as "resource:action" (grant) or "-resource:action" (revoke).
 */
export const PERMISSIONS = [
  "dashboard:view",
  "clients:view",
  "clients:create",
  "clients:edit",
  "clients:delete",
  "strategy:view",
  "strategy:edit",
  "strategy:approve",
  "analytics:view",
  "campaigns:view",
  "budget:view",
  "budget:edit",
  "budget:approve",
  "expenses:edit",
  "content:view",
  "content:create",
  "content:edit",
  "content:delete",
  "content:submit",
  "content:approve_internal",
  "content:approve_client",
  "content:comment",
  "content:comment_internal",
  "competitors:view",
  "competitors:edit",
  "trends:view",
  "trends:edit",
  "benchmarks:view",
  "benchmarks:edit",
  "reports:view",
  "reports:create",
  "reports:share",
  "reports:export",
  "tasks:view",
  "tasks:edit",
  "users:view",
  "users:manage",
  "integrations:view",
  "integrations:manage",
  "settings:view",
  "settings:manage",
  "audit:view",
  "ai:use",
  "team:performance",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
  COMPANY_MANAGER: ALL.filter(
    (p) => !["integrations:manage", "settings:manage", "users:manage"].includes(p),
  ).concat(["users:view"]),
  MARKETING_TEAM: [
    "dashboard:view",
    "clients:view",
    "strategy:view",
    "strategy:edit",
    "analytics:view",
    "campaigns:view",
    "budget:view",
    "budget:edit",
    "expenses:edit",
    "content:view",
    "content:create",
    "content:edit",
    "content:submit",
    "content:comment",
    "content:comment_internal",
    "competitors:view",
    "competitors:edit",
    "trends:view",
    "trends:edit",
    "benchmarks:view",
    "reports:view",
    "reports:create",
    "reports:export",
    "tasks:view",
    "tasks:edit",
    "integrations:view",
    "ai:use",
  ],
  CLIENT: [
    "dashboard:view",
    "clients:view",
    "strategy:view",
    "analytics:view",
    "campaigns:view",
    "budget:view",
    "content:view",
    "content:approve_client",
    "content:comment",
    "competitors:view",
    "trends:view",
    "benchmarks:view",
    "reports:view",
    "reports:export",
    "tasks:view",
  ],
  VIEWER: [
    "dashboard:view",
    "clients:view",
    "strategy:view",
    "analytics:view",
    "campaigns:view",
    "budget:view",
    "content:view",
    "competitors:view",
    "trends:view",
    "benchmarks:view",
    "reports:view",
    "tasks:view",
  ],
};

export function effectivePermissions(role: Role, overrides: string[] = []): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const o of overrides) {
    if (o.startsWith("-")) set.delete(o.slice(1) as Permission);
    else if ((PERMISSIONS as readonly string[]).includes(o)) set.add(o as Permission);
  }
  // Hard guard: only SUPER_ADMIN can ever manage integrations/secrets or system settings.
  if (role !== "SUPER_ADMIN") {
    set.delete("integrations:manage");
    set.delete("settings:manage");
  }
  // Clients can never see internal comments or approve internally.
  if (role === "CLIENT") {
    set.delete("content:comment_internal");
    set.delete("content:approve_internal");
    set.delete("users:manage");
    set.delete("audit:view");
  }
  return set;
}

export function can(
  user: { role: Role; permissions?: string[] },
  permission: Permission,
): boolean {
  return effectivePermissions(user.role, user.permissions ?? []).has(permission);
}

/** Roles whose client visibility is restricted to explicit ClientAccess rows. */
export const CLIENT_SCOPED_ROLES: Role[] = ["CLIENT", "VIEWER"];

export const ROLES: Role[] = ["SUPER_ADMIN", "COMPANY_MANAGER", "MARKETING_TEAM", "CLIENT", "VIEWER"];

/** Which nav route requires which permission. Used by the sidebar and by middleware-like guards. */
export const ROUTE_PERMISSIONS: Record<string, Permission> = {
  "/dashboard": "dashboard:view",
  "/clients": "clients:view",
  "/strategy": "strategy:view",
  "/analytics": "analytics:view",
  "/campaigns": "campaigns:view",
  "/budget": "budget:view",
  "/plan-vs-actual": "budget:view",
  "/calendar": "content:view",
  "/library": "content:view",
  "/approvals": "content:view",
  "/competitors": "competitors:view",
  "/trends": "trends:view",
  "/benchmarks": "benchmarks:view",
  "/reports": "reports:view",
  "/tasks": "tasks:view",
  "/users": "users:view",
  "/settings": "settings:view",
  "/audit": "audit:view",
};
