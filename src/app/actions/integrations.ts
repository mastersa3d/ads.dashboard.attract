"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, AuthError, type CurrentUser } from "@/lib/auth/session";
import { assertClientAccess } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getConnector } from "@/lib/integrations/registry";
import { ConnectorError } from "@/lib/integrations/types";
import { asConnectorError, connectorOf, linkAccounts, listRemoteAccounts, saveTokens, testIntegration } from "@/lib/integrations/service";
import { enqueue } from "@/lib/jobs/queue";

/**
 * Settings → Integrations actions. All require `integrations:manage` (Super Admin only — see rbac.ts)
 * and are scoped to the user's organization + accessible clients. Tokens are accepted here, encrypted
 * by lib/integrations/service.ts and never returned.
 */

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

const PATH = "/settings/integrations";
const id = z.string().min(1).max(64);

async function load(user: CurrentUser, integrationId: string) {
  const i = await db.integration.findFirst({ where: { id: integrationId, organizationId: user.organizationId } });
  if (!i) throw new AuthError("NOT_FOUND");
  if (i.clientId) await assertClientAccess(user, i.clientId);
  return i;
}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues.map((i) => i.message).join("; ") };
  if (e instanceof ConnectorError) return { ok: false, error: e.message };
  logger.error("integrations.action_failed", { message: (e as Error)?.message });
  return { ok: false, error: "INTERNAL" };
}

const createSchema = z.object({
  connectorId: z.string().min(1).max(40),
  clientId: z.string().min(1).max(64).nullable(),
  label: z.string().trim().min(1).max(120),
});

export async function createIntegration(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await assertUser("integrations:manage");
    const data = createSchema.parse(input);
    const connector = getConnector(data.connectorId);
    if (!connector) throw new z.ZodError([{ code: "custom", message: "Unknown platform", path: ["connectorId"], input: data.connectorId }]);
    // Data integrations belong to a client; only e-mail/storage/calendar may be organization-wide.
    const orgWideOk = connector.capabilities.some((c) => c === "email" || c === "storage" || c === "calendar");
    if (!data.clientId && !orgWideOk) throw new z.ZodError([{ code: "custom", message: "Client required", path: ["clientId"], input: null }]);
    if (data.clientId) await assertClientAccess(user, data.clientId);

    const row = await db.integration.create({
      data: {
        organizationId: user.organizationId,
        clientId: data.clientId,
        platform: connector.platform,
        label: data.label,
        status: connector.authType === "none" ? "CONNECTED" : "DISCONNECTED",
        scopesRequired: connector.requiredScopes,
        syncCursor: { connector: connector.id } as Prisma.InputJsonValue,
      },
    });
    await audit(user, { action: "create", entity: "Integration", entityId: row.id, clientId: data.clientId, summary: `${connector.displayName}: ${data.label}` });
    revalidatePath(PATH);
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    return fail(e);
  }
}

const tokenSchema = z.object({
  integrationId: id,
  accessToken: z.string().trim().min(10).max(4096),
  refreshToken: z.string().trim().max(4096).optional().or(z.literal("")),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

/** Manual long-lived token entry (fallback when OAuth isn't possible). Never echoes the token back. */
export async function saveManualToken(input: unknown): Promise<ActionResult> {
  try {
    const user = await assertUser("integrations:manage");
    const data = tokenSchema.parse(input);
    const i = await load(user, data.integrationId);
    const connector = connectorOf(i);
    if (!connector.manualToken) throw new ConnectorError("UNSUPPORTED", "This platform only supports the OAuth connection");
    await saveTokens(i.id, {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt + "T23:59:59Z") : null,
    });
    await audit(user, { action: "connect", entity: "Integration", entityId: i.id, clientId: i.clientId, summary: `Manual token saved (${connector.displayName})` });
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function testConnection(integrationId: unknown): Promise<ActionResult<{ missing?: string[] }>> {
  try {
    const user = await assertUser("integrations:manage");
    const i = await load(user, id.parse(integrationId));
    const res = await testIntegration(i.id);
    await audit(user, { action: "test", entity: "Integration", entityId: i.id, clientId: i.clientId, summary: res.ok ? "Connection test OK" : `Connection test failed: ${res.message}` });
    revalidatePath(PATH);
    return res.ok ? { ok: true, data: { missing: res.missing } } : { ok: false, error: res.message };
  } catch (e) {
    return fail(e);
  }
}

export async function syncNow(integrationId: unknown): Promise<ActionResult<{ deduped: boolean }>> {
  try {
    const user = await assertUser("integrations:manage");
    const i = await load(user, id.parse(integrationId));
    const r = await enqueue("sync.integration", { integrationId: i.id, requestedBy: user.id }, { organizationId: user.organizationId, dedupeKey: `sync:${i.id}:manual`, maxAttempts: 3 });
    await audit(user, { action: "sync", entity: "Integration", entityId: i.id, clientId: i.clientId, summary: "Manual sync requested" });
    revalidatePath(PATH);
    return { ok: true, data: { deduped: r.deduped } };
  } catch (e) {
    return fail(e);
  }
}

export async function setEnabled(input: unknown): Promise<ActionResult> {
  try {
    const user = await assertUser("integrations:manage");
    const data = z.object({ integrationId: id, enabled: z.boolean() }).parse(input);
    const i = await load(user, data.integrationId);
    await db.integration.update({ where: { id: i.id }, data: { enabled: data.enabled } });
    await audit(user, { action: data.enabled ? "enable" : "disable", entity: "Integration", entityId: i.id, clientId: i.clientId });
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Removes stored tokens (status → DISCONNECTED). Synced data and linked accounts are kept. */
export async function disconnectIntegration(integrationId: unknown): Promise<ActionResult> {
  try {
    const user = await assertUser("integrations:manage");
    const i = await load(user, id.parse(integrationId));
    await db.integration.update({
      where: { id: i.id },
      data: { accessTokenEnc: null, refreshTokenEnc: null, tokenLast4: null, tokenExpiresAt: null, scopesGranted: [], status: "DISCONNECTED", lastError: null },
    });
    await audit(user, { action: "disconnect", entity: "Integration", entityId: i.id, clientId: i.clientId, summary: "Stored token removed" });
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteIntegration(integrationId: unknown): Promise<ActionResult> {
  try {
    const user = await assertUser("integrations:manage");
    const i = await load(user, id.parse(integrationId));
    await db.integration.delete({ where: { id: i.id } }); // AdAccount.integrationId → SET NULL; metrics are kept
    await audit(user, { action: "delete", entity: "Integration", entityId: i.id, clientId: i.clientId, summary: i.label });
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function fetchRemoteAccounts(integrationId: unknown): Promise<ActionResult<{ accounts: { externalId: string; name: string; currency?: string | null; linked: boolean }[] }>> {
  try {
    const user = await assertUser("integrations:manage");
    const i = await load(user, id.parse(integrationId));
    const [remote, linked] = await Promise.all([listRemoteAccounts(i.id), db.adAccount.findMany({ where: { integrationId: i.id }, select: { externalId: true } })]);
    const set = new Set(linked.map((a) => a.externalId));
    return { ok: true, data: { accounts: remote.map((a) => ({ externalId: a.externalId, name: a.name, currency: a.currency, linked: set.has(a.externalId) })) } };
  } catch (e) {
    const err = e instanceof AuthError || e instanceof z.ZodError ? e : asConnectorError(e);
    return fail(err);
  }
}

const linkSchema = z.object({ integrationId: id, externalIds: z.array(z.string().min(1).max(200)).max(200) });

export async function saveLinkedAccounts(input: unknown): Promise<ActionResult> {
  try {
    const user = await assertUser("integrations:manage");
    const data = linkSchema.parse(input);
    const i = await load(user, data.integrationId);
    // Re-fetch from the platform so names/currencies can't be spoofed by the browser.
    const remote = await listRemoteAccounts(i.id);
    const chosen = remote.filter((a) => data.externalIds.includes(a.externalId));
    await linkAccounts(i.id, chosen);
    await audit(user, { action: "update", entity: "Integration", entityId: i.id, clientId: i.clientId, summary: `Linked accounts: ${chosen.map((a) => a.name).join(", ") || "none"}` });
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return fail(e instanceof AuthError || e instanceof z.ZodError ? e : asConnectorError(e));
  }
}
