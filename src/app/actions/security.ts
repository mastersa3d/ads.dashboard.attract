"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth/session";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { newTotpSecret, totpQr, verifyTotp } from "@/lib/auth/totp";
import { decrypt, encrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import type { ActionResult } from "@/components/admin/action-result";
import { ActionError, formFields, guarded } from "@/components/admin/server-action";

/**
 * Self-service security for the signed-in user (Settings → Security). Every action acts on the
 * caller only, so no extra permission beyond being signed in is required.
 */

const codeSchema = z.string().trim().regex(/^\d{6}$/);

function limit(key: string) {
  if (!rateLimit(key, 8, 10 * 60_000).ok) throw new ActionError("auth.rateLimited");
}

/** Step 1: generate a secret (stored encrypted, not yet enabled) and return the QR code. */
export async function startTotpSetup(): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    if (user.totpEnabled) throw new ActionError("settings.err2faAlreadyOn");
    limit(`totp-setup:${user.id}`);
    const secret = newTotpSecret();
    await db.user.update({ where: { id: user.id }, data: { totpSecretEnc: encrypt(secret), totpEnabled: false } });
    await audit(user, { action: "2fa_setup_started", entity: "User", entityId: user.id });
    return { data: { qr: await totpQr(user.email, secret), secret } };
  });
}

/** Step 2: prove the authenticator works before 2FA is switched on. */
export async function confirmTotp(_: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    limit(`totp-confirm:${user.id}`);
    const code = codeSchema.parse(formFields(form).code);
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { totpSecretEnc: true } });
    if (!u.totpSecretEnc || !verifyTotp(code, decrypt(u.totpSecretEnc))) throw new ActionError("auth.badCode");
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { totpEnabled: true } }),
      // this session has just proven possession of the second factor
      db.session.update({ where: { id: user.sessionId }, data: { twoFactorOk: true } }),
    ]);
    await audit(user, { action: "2fa_enabled", entity: "User", entityId: user.id });
    revalidatePath("/settings");
    return { ok: "settings.2faEnabled" };
  });
}

export async function disableTotp(_: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    limit(`totp-disable:${user.id}`);
    const code = codeSchema.parse(formFields(form).code);
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { totpSecretEnc: true, totpEnabled: true } });
    if (!u.totpEnabled || !u.totpSecretEnc || !verifyTotp(code, decrypt(u.totpSecretEnc))) throw new ActionError("auth.badCode");
    await db.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecretEnc: null } });
    await audit(user, { action: "2fa_disabled", entity: "User", entityId: user.id });
    revalidatePath("/settings");
    return { ok: "settings.2faDisabled" };
  });
}

export async function changePassword(_: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    limit(`pw-change:${user.id}`);
    const f = formFields(form);
    if (f.password !== f.confirm) throw new ActionError("auth.mismatch");
    if (!passwordSchema.safeParse(f.password).success) throw new ActionError("auth.weakPassword");
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await verifyPassword(f.current ?? "", u.passwordHash))) throw new ActionError("settings.errCurrentPassword");
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(f.password) } }),
      // keep this device signed in, end every other session
      db.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } }),
    ]);
    await audit(user, { action: "password_change", entity: "User", entityId: user.id });
    revalidatePath("/settings");
    return { ok: "settings.passwordChanged" };
  });
}

export async function revokeMySession(sessionId: string): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    if (sessionId === user.sessionId) throw new ActionError("settings.errCurrentSession");
    const { count } = await db.session.deleteMany({ where: { id: sessionId, userId: user.id } });
    if (!count) throw new ActionError("settings.errNotFound");
    await audit(user, { action: "session_revoke", entity: "Session", entityId: sessionId });
    revalidatePath("/settings");
    return { ok: "ui.saved" };
  });
}

export async function signOutOtherSessions(): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    const { count } = await db.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } });
    await audit(user, { action: "session_revoke_others", entity: "User", entityId: user.id, summary: String(count) });
    revalidatePath("/settings");
    return { ok: "settings.otherSessionsEnded" };
  });
}
