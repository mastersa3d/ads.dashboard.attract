"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession, getCurrentUser, clientIp } from "@/lib/auth/session";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { verifyTotp } from "@/lib/auth/totp";
import { decrypt, randomToken, sha256 } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { appUrl, emailLayout, sendMail } from "@/lib/mailer";

export type FormState = { error?: string; ok?: string } | undefined;

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

function safeNext(next: unknown) {
  const s = typeof next === "string" ? next : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/dashboard";
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ip = clientIp(await headers()) ?? "unknown";
  if (!rateLimit(`login:${ip}`, 20, 15 * 60_000).ok || !rateLimit(`login:${email}`, 8, 15 * 60_000).ok) return { error: "auth.rateLimited" };
  if (!email || !password) return { error: "auth.invalid" };

  const user = await db.user.findUnique({ where: { email } });
  if (user?.lockedUntil && user.lockedUntil > new Date()) return { error: "auth.locked" };
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok || !user.active) {
    if (user) {
      const failed = user.failedLogins + 1;
      await db.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : null } });
      await audit({ id: user.id, email: user.email, organizationId: user.organizationId }, { action: "login_failed", entity: "User", entityId: user.id });
    }
    return { error: user && !user.active ? "auth.disabled" : "auth.invalid" };
  }
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession(user.id, !user.totpEnabled);
  await audit({ id: user.id, email: user.email, organizationId: user.organizationId }, { action: "login", entity: "User", entityId: user.id });
  redirect(user.totpEnabled ? `/two-factor?next=${encodeURIComponent(safeNext(form.get("next")))}` : safeNext(form.get("next")));
}

export async function twoFactorAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!rateLimit(`2fa:${user.id}`, 6, 5 * 60_000).ok) return { error: "auth.rateLimited" };
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!u.totpSecretEnc || !verifyTotp(String(form.get("code") ?? ""), decrypt(u.totpSecretEnc))) {
    await audit(user, { action: "2fa_failed", entity: "User", entityId: user.id });
    return { error: "auth.badCode" };
  }
  await db.session.update({ where: { id: user.sessionId }, data: { twoFactorOk: true } });
  redirect(safeNext(form.get("next")));
}

export async function forgotPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const ip = clientIp(await headers()) ?? "unknown";
  if (!rateLimit(`forgot:${ip}`, 5, 15 * 60_000).ok) return { error: "auth.rateLimited" };
  const user = await db.user.findUnique({ where: { email } });
  if (user?.active) {
    const token = randomToken();
    await db.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
    const link = appUrl(`/reset-password/${token}`);
    await sendMail(user.email, "Reset your password / إعادة تعيين كلمة المرور", emailLayout("Password reset", `<p>Use the link below within 60 minutes:</p><p><a href="${link}">${link}</a></p><p dir="rtl">استخدم الرابط أعلاه خلال 60 دقيقة لإعادة تعيين كلمة المرور.</p>`));
    await audit({ id: user.id, email: user.email, organizationId: user.organizationId }, { action: "password_reset_requested", entity: "User", entityId: user.id });
  }
  // Same response whether or not the account exists (no user enumeration).
  return { ok: "auth.resetSent" };
}

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const pw = String(form.get("password") ?? "");
  if (pw !== String(form.get("confirm") ?? "")) return { error: "auth.mismatch" };
  const parsed = passwordSchema.safeParse(pw);
  if (!parsed.success) return { error: "auth.weakPassword" };
  const reset = await db.passwordReset.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) return { error: "auth.linkExpired" };
  await db.$transaction([
    db.user.update({ where: { id: reset.userId }, data: { passwordHash: await hashPassword(pw), failedLogins: 0, lockedUntil: null } }),
    db.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    db.session.deleteMany({ where: { userId: reset.userId } }), // sign out everywhere
  ]);
  await audit({ id: reset.user.id, email: reset.user.email, organizationId: reset.user.organizationId }, { action: "password_reset", entity: "User", entityId: reset.userId });
  redirect("/login?reset=1");
}

const acceptSchema = z.object({ token: z.string().min(10), name: z.string().trim().min(2).max(120), password: passwordSchema });

export async function acceptInviteAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = acceptSchema.safeParse({ token: form.get("token"), name: form.get("name"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.path[0] === "password" ? "auth.weakPassword" : "auth.invalid" };
  const inv = await db.invitation.findUnique({ where: { tokenHash: sha256(parsed.data.token) } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return { error: "auth.linkExpired" };
  if (await db.user.findUnique({ where: { email: inv.email } })) return { error: "auth.exists" };
  const user = await db.user.create({
    data: {
      organizationId: inv.organizationId,
      email: inv.email,
      name: parsed.data.name,
      role: inv.role,
      passwordHash: await hashPassword(parsed.data.password),
      clientAccess: { create: inv.clientIds.map((clientId) => ({ clientId })) },
    },
  });
  await db.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
  await audit({ id: user.id, email: user.email, organizationId: user.organizationId }, { action: "invite_accepted", entity: "User", entityId: user.id });
  await createSession(user.id, true);
  redirect("/onboarding");
}

export async function signOutEverywhere() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await db.session.deleteMany({ where: { userId: user.id } });
  await destroySession();
  redirect("/login");
}
