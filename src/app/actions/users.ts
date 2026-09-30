"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, type CurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/crypto";
import { appUrl, emailLayout, sendMail } from "@/lib/mailer";
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, type Permission } from "@/lib/rbac";
import type { ActionResult } from "@/components/admin/action-result";
import { ActionError, formFields, formList, guarded } from "@/components/admin/server-action";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const roleSchema = z.enum(ROLES as [Role, ...Role[]]);

/** Target user in the caller's organization. */
async function orgUser(actor: CurrentUser, userId: string) {
  const u = await db.user.findFirst({ where: { id: userId, organizationId: actor.organizationId } });
  if (!u) throw new ActionError("settings.errNotFound");
  return u;
}

/** Only a Super Admin may create or edit Super Admins. */
function assertCanAssign(actor: CurrentUser, role: Role) {
  if (role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") throw new ActionError("users.errSuperAdminOnly");
}

/** Guard against locking the organization out: never remove the last active Super Admin. */
async function assertNotLastAdmin(target: { id: string; role: Role; active: boolean; organizationId: string }) {
  if (target.role !== "SUPER_ADMIN" || !target.active) return;
  const admins = await db.user.count({ where: { organizationId: target.organizationId, role: "SUPER_ADMIN", active: true } });
  if (admins <= 1) throw new ActionError("users.errLastAdmin");
}

async function orgClientIds(actor: CurrentUser, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.client.findMany({ where: { id: { in: ids }, organizationId: actor.organizationId }, select: { id: true } });
  if (rows.length !== new Set(ids).size) throw new ActionError("settings.errNotFound");
  return rows.map((r) => r.id);
}

function revalidateUsers(userId?: string) {
  revalidatePath("/users");
  if (userId) revalidatePath(`/users/${userId}`);
}

// ───────────── invitations ─────────────

async function issueInvitation(actor: CurrentUser, email: string, role: Role, clientIds: string[]) {
  const token = randomToken();
  const org = await db.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { name: true } });
  // One pending invitation per email: replace older ones (their links stop working).
  await db.invitation.deleteMany({ where: { organizationId: actor.organizationId, email, acceptedAt: null } });
  const inv = await db.invitation.create({
    data: { organizationId: actor.organizationId, email, role, clientIds, tokenHash: sha256(token), invitedById: actor.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  const link = appUrl(`/invite/${token}`);
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const mail = await sendMail(
    email,
    `You're invited to ${org.name} / دعوة للانضمام إلى ${org.name}`,
    emailLayout(
      `Invitation — ${esc(org.name)}`,
      `<p>${esc(actor.name)} invited you to join <b>${esc(org.name)}</b>. The link is valid for 7 days:</p><p><a href="${link}">${link}</a></p><p dir="rtl">دعاك ${esc(actor.name)} للانضمام إلى <b>${esc(org.name)}</b>. الرابط صالح لمدة 7 أيام.</p>`,
    ),
  );
  return { inv, link, emailed: !mail.skipped };
}

const inviteSchema = z.object({ email: z.email().max(200).transform((e) => e.toLowerCase()), role: roleSchema });

export async function inviteUser(_: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await assertUser("users:manage");
    const d = inviteSchema.parse(formFields(form));
    assertCanAssign(actor, d.role);
    if (await db.user.findUnique({ where: { email: d.email } })) throw new ActionError("users.errExists");
    const clientIds = await orgClientIds(actor, formList(form, "clientIds"));
    if ((d.role === "CLIENT" || d.role === "VIEWER") && !clientIds.length) throw new ActionError("users.errClientRequired");
    const { inv, link, emailed } = await issueInvitation(actor, d.email, d.role, clientIds);
    await audit(actor, { action: "invite", entity: "Invitation", entityId: inv.id, summary: `${d.email} as ${d.role}`, diff: { email: d.email, role: d.role, clientIds } });
    revalidateUsers();
    return emailed ? { ok: "users.inviteSent" } : { ok: "users.inviteNoSmtp", data: { link, linkLabel: null } };
  });
}

export async function resendInvitation(invitationId: string): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await assertUser("users:manage");
    const old = await db.invitation.findFirst({ where: { id: invitationId, organizationId: actor.organizationId, acceptedAt: null } });
    if (!old) throw new ActionError("settings.errNotFound");
    assertCanAssign(actor, old.role);
    const { inv, link, emailed } = await issueInvitation(actor, old.email, old.role, old.clientIds);
    await audit(actor, { action: "invite_resend", entity: "Invitation", entityId: inv.id, summary: old.email });
    revalidateUsers();
    return emailed ? { ok: "users.inviteSent" } : { ok: "users.inviteNoSmtp", data: { link, linkLabel: null } };
  });
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await assertUser("users:manage");
    const inv = await db.invitation.findFirst({ where: { id: invitationId, organizationId: actor.organizationId, acceptedAt: null } });
    if (!inv) throw new ActionError("settings.errNotFound");
    await db.invitation.delete({ where: { id: inv.id } });
    await audit(actor, { action: "invite_revoke", entity: "Invitation", entityId: inv.id, summary: inv.email });
    revalidateUsers();
    return { ok: "ui.saved" };
  });
}

// ───────────── role, status, overrides, clients ─────────────

export async function changeUserRole(userId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await assertUser("users:manage");
    const role = roleSchema.parse(formFields(form).role);
    const target = await orgUser(actor, userId);
    if (target.role === role) return { ok: "ui.saved" };
    if (target.id === actor.id) throw new ActionError("users.errSelf");
    assertCanAssign(actor, role);
    assertCanAssign(actor, target.role);
    await assertNotLastAdmin(target);
    await db.user.update({ where: { id: userId }, data: { role } });
    await audit(actor, { action: "role_change", entity: "User", entityId: userId, summary: `${target.email}: ${target.role} → ${role}`, diff: { role: { from: target.role, to: role } } });
    revalidateUsers(userId);
    return { ok: "ui.saved" };
  });
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await assertUser("users:manage");
    const target = await orgUser(actor, userId);
    if (target.id === actor.id) throw new ActionError("users.errSelf");
    assertCanAssign(actor, target.role);
    if (!active) await assertNotLastAdmin(target);
    await db.$transaction([
      db.user.update({ where: { id: userId }, data: { active, ...(active ? { failedLogins: 0, lockedUntil: null } : {}) } }),
      // Deactivation signs the user out everywhere immediately.
      ...(active ? [] : [db.session.deleteMany({ where: { userId } })]),
    ]);
    await audit(actor, { action: active ? "activate" : "deactivate", entity: "User", entityId: userId, summary: target.email });
    revalidateUsers(userId);
    return { ok: "ui.saved" };
  });
}

/**
 * Per-user permission overrides. Each permission is submitted as `perm:<name>` =
 * "default" | "grant" | "revoke" and stored in User.permissions as "perm" / "-perm"
 * only where it differs from the role default.
 */
export async function updateUserPermissions(userId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await assertUser("users:manage");
    const target = await orgUser(actor, userId);
    if (target.id === actor.id) throw new ActionError("users.errSelf");
    assertCanAssign(actor, target.role);
    const roleDefaults = new Set<Permission>(ROLE_PERMISSIONS[target.role]);
    const overrides: string[] = [];
    for (const p of PERMISSIONS) {
      const v = form.get(`perm:${p}`);
      if (v === "grant" && !roleDefaults.has(p)) {
        // No privilege escalation: you can only grant what you hold yourself.
        if (!actor.perms.has(p)) throw new ActionError("users.errGrantOwn");
        overrides.push(p);
      } else if (v === "revoke" && roleDefaults.has(p)) overrides.push(`-${p}`);
      else if (v !== "default" && v !== "grant" && v !== "revoke" && v !== null) throw new ActionError("settings.errInvalid");
    }
    await db.user.update({ where: { id: userId }, data: { permissions: overrides } });
    await audit(actor, { action: "permissions_change", entity: "User", entityId: userId, summary: target.email, diff: { from: target.permissions, to: overrides } });
    revalidateUsers(userId);
    return { ok: "ui.saved" };
  });
}

export async function setUserClients(userId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await assertUser("users:manage");
    const target = await orgUser(actor, userId);
    const clientIds = await orgClientIds(actor, formList(form, "clientIds"));
    const before = (await db.clientAccess.findMany({ where: { userId }, select: { clientId: true } })).map((a) => a.clientId);
    await db.$transaction([
      db.clientAccess.deleteMany({ where: { userId, clientId: { notIn: clientIds } } }),
      db.clientAccess.createMany({ data: clientIds.map((clientId) => ({ userId, clientId })), skipDuplicates: true }),
    ]);
    await audit(actor, { action: "client_access_change", entity: "User", entityId: userId, summary: target.email, diff: { from: before, to: clientIds } });
    revalidateUsers(userId);
    return { ok: "ui.saved" };
  });
}

// ───────────── sessions ─────────────

export async function revokeUserSession(sessionId: string): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await assertUser("users:manage");
    const s = await db.session.findFirst({ where: { id: sessionId, user: { organizationId: actor.organizationId } }, include: { user: { select: { email: true } } } });
    if (!s) throw new ActionError("settings.errNotFound");
    await db.session.delete({ where: { id: s.id } });
    await audit(actor, { action: "session_revoke", entity: "Session", entityId: s.id, summary: s.user.email });
    revalidateUsers(s.userId);
    return { ok: "ui.saved" };
  });
}

export async function revokeAllUserSessions(userId: string): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await assertUser("users:manage");
    const target = await orgUser(actor, userId);
    if (target.id === actor.id) throw new ActionError("users.errSelf");
    const { count } = await db.session.deleteMany({ where: { userId } });
    await audit(actor, { action: "session_revoke_all", entity: "User", entityId: userId, summary: `${target.email} (${count})` });
    revalidateUsers(userId);
    return { ok: "ui.saved" };
  });
}
