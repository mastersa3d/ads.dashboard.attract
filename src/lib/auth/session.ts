import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { can, effectivePermissions, type Permission } from "@/lib/rbac";

export const SESSION_COOKIE = "mimd_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days, sliding
const TOUCH_INTERVAL_MS = 1000 * 60 * 5;

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: string[];
  organizationId: string;
  locale: string;
  totpEnabled: boolean;
  sessionId: string;
  twoFactorOk: boolean;
  perms: Set<Permission>;
};

export async function createSession(userId: string, twoFactorOk: boolean) {
  const token = randomToken();
  const h = await headers();
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      ip: clientIp(h),
      twoFactorOk,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.APP_URL ? process.env.APP_URL.startsWith("https://") : process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return session;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export function clientIp(h: Headers): string | null {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

/** Resolves the logged-in user once per request. Returns null when not authenticated. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;

  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  const u = session.user;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    permissions: u.permissions,
    organizationId: u.organizationId,
    locale: u.locale,
    totpEnabled: u.totpEnabled,
    sessionId: session.id,
    twoFactorOk: session.twoFactorOk,
    perms: effectivePermissions(u.role, u.permissions),
  };
});

/** Use at the top of every protected page / server action. */
export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.totpEnabled && !user.twoFactorOk) redirect("/two-factor");
  if (permission && !can(user, permission)) redirect("/dashboard?denied=" + encodeURIComponent(permission));
  return user;
}

/** Variant for server actions / route handlers: throws instead of redirecting. */
export async function assertUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || (user.totpEnabled && !user.twoFactorOk)) throw new AuthError("UNAUTHENTICATED");
  if (permission && !can(user, permission)) throw new AuthError("FORBIDDEN");
  return user;
}

export class AuthError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND") {
    super(code);
  }
}
