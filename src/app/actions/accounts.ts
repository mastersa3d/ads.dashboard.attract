"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, AuthError } from "@/lib/auth/session";
import { assertClientAccess } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * Ad accounts / pages per client (Settings → Integrations → Accounts). Accounts can be added by
 * hand (e.g. before OAuth apps are configured) or come from a connected integration; both can be
 * renamed, re-assigned to a brand/integration, or removed. Requires clients:edit and client access.
 */

export type AccountResult = { ok: true } | { ok: false; error: string };

const PATHS = ["/settings/integrations", "/clients", "/dashboard"];

function fail(e: unknown): AccountResult {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  if (e instanceof z.ZodError) return { ok: false, error: "integrations.accounts.invalid" };
  if (e instanceof Error && e.message.startsWith("integrations.")) return { ok: false, error: e.message };
  logger.error("accounts.action_failed", { message: (e as Error)?.message });
  return { ok: false, error: "INTERNAL" };
}

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const accountSchema = z.object({
  id: z.string().max(64).optional(),
  clientId: z.string().min(1).max(64),
  platform: z.nativeEnum(Platform),
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(200),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  timezone: z.string().trim().min(1).max(64),
  country: opt(2),
  brandId: opt(64),
  integrationId: opt(64),
  isOrganic: z.boolean(),
});

export async function saveAccount(input: unknown): Promise<AccountResult> {
  try {
    const user = await assertUser("clients:edit");
    const d = accountSchema.parse(input);
    await assertClientAccess(user, d.clientId);

    if (d.brandId) {
      const brand = await db.brand.findFirst({ where: { id: d.brandId, clientId: d.clientId } });
      if (!brand) throw new Error("integrations.accounts.badBrand");
    }
    if (d.integrationId) {
      const integ = await db.integration.findFirst({ where: { id: d.integrationId, organizationId: user.organizationId, clientId: d.clientId } });
      if (!integ) throw new Error("integrations.accounts.badIntegration");
    }
    const dup = await db.adAccount.findFirst({ where: { clientId: d.clientId, platform: d.platform, externalId: d.externalId, ...(d.id ? { id: { not: d.id } } : {}) } });
    if (dup) throw new Error("integrations.accounts.duplicate");

    const data = {
      clientId: d.clientId,
      platform: d.platform,
      name: d.name,
      externalId: d.externalId,
      currency: d.currency,
      timezone: d.timezone,
      country: d.country,
      brandId: d.brandId,
      integrationId: d.integrationId,
      isOrganic: d.isOrganic,
    };

    if (d.id) {
      const before = await db.adAccount.findUnique({ where: { id: d.id } });
      if (!before) throw new AuthError("NOT_FOUND");
      await assertClientAccess(user, before.clientId);
      // Moving an account between clients would move its history too — not allowed.
      if (before.clientId !== d.clientId) throw new Error("integrations.accounts.noMove");
      await db.adAccount.update({ where: { id: d.id }, data });
      await audit(user, { action: "update", entity: "AdAccount", entityId: d.id, clientId: d.clientId, summary: d.name, diff: { before: { name: before.name, externalId: before.externalId, currency: before.currency, brandId: before.brandId, integrationId: before.integrationId }, after: data } });
    } else {
      const row = await db.adAccount.create({ data: { ...data, source: "MANUAL" } });
      await audit(user, { action: "create", entity: "AdAccount", entityId: row.id, clientId: d.clientId, summary: `${d.platform}: ${d.name}` });
    }
    PATHS.forEach((p) => revalidatePath(p));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAccount(accountId: unknown): Promise<AccountResult> {
  try {
    const user = await assertUser("clients:edit");
    const id = z.string().min(1).max(64).parse(accountId);
    const acc = await db.adAccount.findUnique({ where: { id }, include: { _count: { select: { campaigns: true, metrics: true } } } });
    if (!acc) throw new AuthError("NOT_FOUND");
    await assertClientAccess(user, acc.clientId);
    await db.adAccount.delete({ where: { id } });
    await audit(user, { action: "delete", entity: "AdAccount", entityId: id, clientId: acc.clientId, summary: `${acc.platform}: ${acc.name} (${acc._count.campaigns} campaigns, ${acc._count.metrics} metric rows removed)` });
    PATHS.forEach((p) => revalidatePath(p));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const integrationSchema = z.object({
  integrationId: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(120),
  clientId: z.string().min(1).max(64).nullable(),
});

/** Rename an integration or re-assign it to another client (only while no accounts are linked). */
export async function updateIntegration(input: unknown): Promise<AccountResult> {
  try {
    const user = await assertUser("integrations:manage");
    const d = integrationSchema.parse(input);
    const i = await db.integration.findFirst({ where: { id: d.integrationId, organizationId: user.organizationId }, include: { _count: { select: { accounts: true } } } });
    if (!i) throw new AuthError("NOT_FOUND");
    if (i.clientId) await assertClientAccess(user, i.clientId);
    if (d.clientId) await assertClientAccess(user, d.clientId);
    if (d.clientId !== i.clientId && i._count.accounts > 0) throw new Error("integrations.accounts.noMoveIntegration");
    await db.integration.update({ where: { id: i.id }, data: { label: d.label, clientId: d.clientId } });
    await audit(user, { action: "update", entity: "Integration", entityId: i.id, clientId: d.clientId, diff: { before: { label: i.label, clientId: i.clientId }, after: { label: d.label, clientId: d.clientId } } });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
