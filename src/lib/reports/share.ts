import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { readConfig } from "./schema";

/**
 * Public read-only report links (/r/<token>).
 *  - The raw token is shown once; only sha256(token) is stored (Report.shareTokenHash).
 *  - Scheduled e-mails get their own rotating tokens (last 3 kept in config.delivery) so sending a
 *    scheduled report never revokes a link someone shared manually.
 *  - Expiry is always enforced; revoking clears both kinds of links.
 */

export const MAX_SHARE_DAYS = 90;
export const DELIVERY_LINK_DAYS = 30;
const KEEP_DELIVERY = 3;

export function newShareToken() {
  const token = randomToken(24);
  return { token, hash: sha256(token) };
}

export function isLinkValid(expiresAt: Date | null | undefined, now = new Date()) {
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

/** Resolves a public token to a report id, honouring expiry. */
export async function findReportByToken(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const hash = sha256(token);
  const direct = await db.report.findUnique({ where: { shareTokenHash: hash }, select: { id: true, shareExpiresAt: true } });
  if (direct) return isLinkValid(direct.shareExpiresAt, now) ? direct.id : null;
  const viaDelivery = await db.report.findFirst({ where: { config: { path: ["deliveryHashes"], array_contains: [hash] } }, select: { id: true, config: true } });
  if (!viaDelivery) return null;
  const entry = readConfig(viaDelivery.config).delivery.find((d) => d.h === hash);
  return entry && isLinkValid(new Date(entry.exp), now) ? viaDelivery.id : null;
}

/** Creates a delivery link for a scheduled e-mail and returns the raw token (never stored). */
export async function createDeliveryLink(reportId: string, now = new Date()) {
  const report = await db.report.findUniqueOrThrow({ where: { id: reportId }, select: { config: true } });
  const cfg = readConfig(report.config);
  const { token, hash } = newShareToken();
  const exp = new Date(now.getTime() + DELIVERY_LINK_DAYS * 86_400_000).toISOString();
  const delivery = [{ h: hash, exp }, ...cfg.delivery.filter((d) => new Date(d.exp) > now)].slice(0, KEEP_DELIVERY);
  const raw = (report.config ?? {}) as Record<string, unknown>;
  await db.report.update({
    where: { id: reportId },
    data: { config: { ...raw, delivery, deliveryHashes: delivery.map((d) => d.h) } as Prisma.InputJsonValue },
  });
  return token;
}

/** Config JSON with all delivery links removed (used by "revoke"). */
export function withoutDeliveryLinks(config: unknown): Prisma.InputJsonValue {
  const raw = (config ?? {}) as Record<string, unknown>;
  return { ...raw, delivery: [], deliveryHashes: [] } as Prisma.InputJsonValue;
}
