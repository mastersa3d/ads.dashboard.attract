import { describe, expect, it } from "vitest";
import { can, effectivePermissions, ROLE_PERMISSIONS, PERMISSIONS } from "@/lib/rbac";

describe("RBAC", () => {
  it("super admin has every permission", () => {
    expect(effectivePermissions("SUPER_ADMIN").size).toBe(PERMISSIONS.length);
  });

  it("only super admins can ever manage integrations or system settings, even with overrides", () => {
    for (const role of ["COMPANY_MANAGER", "MARKETING_TEAM", "CLIENT", "VIEWER"] as const) {
      const perms = effectivePermissions(role, ["integrations:manage", "settings:manage"]);
      expect(perms.has("integrations:manage")).toBe(false);
      expect(perms.has("settings:manage")).toBe(false);
    }
  });

  it("clients can never see internal comments, approve internally or read the audit log", () => {
    const perms = effectivePermissions("CLIENT", ["content:comment_internal", "content:approve_internal", "audit:view", "users:manage"]);
    expect(perms.has("content:comment_internal")).toBe(false);
    expect(perms.has("content:approve_internal")).toBe(false);
    expect(perms.has("audit:view")).toBe(false);
    expect(perms.has("users:manage")).toBe(false);
  });

  it("client can approve client-stage content; viewer is read-only", () => {
    expect(can({ role: "CLIENT" }, "content:approve_client")).toBe(true);
    const viewer = ROLE_PERMISSIONS.VIEWER;
    expect(viewer.every((p) => p.endsWith(":view"))).toBe(true);
  });

  it("per-user overrides grant and revoke", () => {
    expect(can({ role: "MARKETING_TEAM", permissions: ["budget:approve"] }, "budget:approve")).toBe(true);
    expect(can({ role: "MARKETING_TEAM", permissions: ["-content:edit"] }, "content:edit")).toBe(false);
    expect(can({ role: "MARKETING_TEAM", permissions: ["not:a-permission"] }, "users:manage")).toBe(false);
  });
});
