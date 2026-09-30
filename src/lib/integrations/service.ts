import type { Integration, Prisma, JobStatus, Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt, last4 } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { connectorFor } from "./registry";
import { ConnectorError, statusForError, type Connector, type NormalizedMetric, type NormalizedOrganic, type RemoteAccount, type TokenSet } from "./types";
import { canSync, deriveStatus, missingScopes, readCursor, syncWindow, type SyncCursor } from "./status";

/**
 * Database side of the integration framework — shared by server actions, OAuth routes and the
 * worker (so no "server-only" import). Every connect / test / sync / refresh writes a SyncRun row.
 * Tokens are decrypted only in memory, right before an API call, and never logged or returned.
 */

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const SYNC_LOCK_MS = 30 * 60 * 1000;

export function connectorOf(i: Pick<Integration, "platform" | "syncCursor">): Connector {
  return connectorFor(i.platform, readCursor(i.syncCursor).connector);
}

export function tokenOf(i: Pick<Integration, "accessTokenEnc" | "refreshTokenEnc" | "tokenExpiresAt" | "scopesGranted">): TokenSet | null {
  if (!i.accessTokenEnc) return null;
  return {
    accessToken: decrypt(i.accessTokenEnc),
    refreshToken: i.refreshTokenEnc ? decrypt(i.refreshTokenEnc) : null,
    expiresAt: i.tokenExpiresAt,
    scopes: i.scopesGranted,
  };
}

async function startRun(integrationId: string, kind: "sync" | "test" | "connect" | "refresh") {
  return db.syncRun.create({ data: { integrationId, kind, status: "RUNNING" } });
}

async function finishRun(id: string, status: JobStatus, message?: string | null, rowsUpserted = 0) {
  await db.syncRun.update({ where: { id }, data: { status, finishedAt: new Date(), message: message?.slice(0, 500) ?? null, rowsUpserted } });
}

/** Stores a new token set (OAuth callback, manual entry or refresh) and recomputes the status. */
export async function saveTokens(integrationId: string, token: TokenSet, opts: { kind: "connect" | "refresh"; identity?: string | null } = { kind: "connect" }) {
  const current = await db.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const connector = connectorOf(current);
  const run = await startRun(integrationId, opts.kind);
  const scopesGranted = token.scopes?.length ? token.scopes : opts.kind === "refresh" ? current.scopesGranted : [];
  const status = deriveStatus({
    current: "CONNECTED",
    hasCredentials: true,
    expiresAt: token.expiresAt,
    scopesRequired: connector.requiredScopes,
    // Some platforms (TikTok, manual tokens) do not report scopes — only enforce when we know them.
    scopesGranted: scopesGranted.length ? scopesGranted : connector.requiredScopes,
  });
  const updated = await db.integration.update({
    where: { id: integrationId },
    data: {
      accessTokenEnc: encrypt(token.accessToken),
      refreshTokenEnc: token.refreshToken ? encrypt(token.refreshToken) : opts.kind === "refresh" ? current.refreshTokenEnc : null,
      tokenLast4: last4(token.accessToken),
      tokenExpiresAt: token.expiresAt ?? null,
      scopesGranted,
      scopesRequired: connector.requiredScopes,
      status,
      lastError: status === "PERMISSION_MISSING" ? `Missing permissions: ${missingScopes(connector.requiredScopes, scopesGranted).join(", ")}` : null,
    },
  });
  await finishRun(run.id, "SUCCEEDED", opts.kind === "refresh" ? "Token refreshed" : `Connected${opts.identity ? ` as ${opts.identity}` : ""}`);
  return updated;
}

/** Refreshes the access token when it expires within 5 minutes (or `force`). Returns the usable token. */
export async function ensureFreshToken(i: Integration, force = false): Promise<TokenSet | null> {
  const token = tokenOf(i);
  if (!token) return null;
  const connector = connectorOf(i);
  const due = token.expiresAt && token.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
  if ((!due && !force) || !connector.refreshToken) return token;
  const run = await startRun(i.id, "refresh");
  try {
    const next = await connector.refreshToken(token);
    if (!next) {
      await finishRun(run.id, "SUCCEEDED", "Platform has no refresh mechanism — reconnect before expiry");
      return token;
    }
    await finishRun(run.id, "SUCCEEDED", "Token refreshed");
    await saveTokensQuiet(i.id, next, token);
    return next;
  } catch (e) {
    const err = asConnectorError(e);
    await finishRun(run.id, "FAILED", err.message);
    if (err.code === "AUTH") await db.integration.update({ where: { id: i.id }, data: { status: "EXPIRED", lastError: err.message } });
    throw err;
  }
}

/** Token update without an extra SyncRun (the caller already recorded a "refresh" run). */
async function saveTokensQuiet(id: string, next: TokenSet, prev: TokenSet) {
  await db.integration.update({
    where: { id },
    data: {
      accessTokenEnc: encrypt(next.accessToken),
      refreshTokenEnc: next.refreshToken ? encrypt(next.refreshToken) : prev.refreshToken ? encrypt(prev.refreshToken) : null,
      tokenLast4: last4(next.accessToken),
      tokenExpiresAt: next.expiresAt ?? null,
      scopesGranted: next.scopes?.length ? next.scopes : prev.scopes ?? [],
    },
  });
}

export function asConnectorError(e: unknown): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const msg = (e as Error)?.message ?? "Unknown error";
  // Crypto failures mean ENCRYPTION_KEY changed — the stored token can't be used any more.
  if (/Unsupported state|auth tag|ENCRYPTION_KEY|Unsupported ciphertext/i.test(msg)) return new ConnectorError("AUTH", "Stored credentials cannot be decrypted — reconnect required");
  return new ConnectorError("API", msg.slice(0, 300));
}

/** Test Connection: authenticated call + scope comparison. */
export async function testIntegration(id: string) {
  const i = await db.integration.findUniqueOrThrow({ where: { id }, include: { client: { select: { isDemo: true } } } });
  const connector = connectorOf(i);
  const run = await startRun(id, "test");
  if (connector.authType !== "none" && !i.accessTokenEnc && i.client?.isDemo) {
    // Demo integrations have no live credentials; keep their illustrative status untouched.
    await finishRun(run.id, "SUCCEEDED", "Demo integration — no live credentials to test");
    return { ok: false as const, code: "AUTH" as const, message: "Demo integration — connect a real account to test" };
  }
  try {
    const token = connector.authType === "none" ? null : await ensureFreshToken(i);
    if (connector.authType !== "none" && !token) throw new ConnectorError("AUTH", "No credentials stored — connect first");
    const res = await connector.testConnection(token);
    const granted = res.scopes?.length ? res.scopes : i.scopesGranted.length ? i.scopesGranted : connector.requiredScopes;
    const status = deriveStatus({
      current: i.status === "SYNCING" ? "SYNCING" : "CONNECTED",
      hasCredentials: connector.authType === "none" || Boolean(token),
      expiresAt: token?.expiresAt ?? null,
      scopesRequired: connector.requiredScopes,
      scopesGranted: granted,
    });
    const missing = missingScopes(connector.requiredScopes, granted);
    await db.integration.update({
      where: { id },
      data: { status, scopesGranted: res.scopes?.length ? res.scopes : i.scopesGranted, scopesRequired: connector.requiredScopes, lastError: missing.length ? `Missing permissions: ${missing.join(", ")}` : null },
    });
    await finishRun(run.id, "SUCCEEDED", `OK${res.identity ? ` — ${res.identity}` : ""}${missing.length ? ` · missing: ${missing.join(", ")}` : ""}`);
    return { ok: true as const, status, missing };
  } catch (e) {
    const err = asConnectorError(e);
    await db.integration.update({ where: { id }, data: { status: statusForError(err.code), lastError: err.message } });
    await finishRun(run.id, "FAILED", err.message);
    return { ok: false as const, code: err.code, message: err.message };
  }
}

export async function listRemoteAccounts(id: string): Promise<RemoteAccount[]> {
  const i = await db.integration.findUniqueOrThrow({ where: { id } });
  const connector = connectorOf(i);
  if (!connector.listAccounts) return [];
  const token = await ensureFreshToken(i);
  if (!token) throw new ConnectorError("AUTH", "No credentials stored — connect first");
  return connector.listAccounts(token);
}

/** Links remote accounts to the integration's client (creates/updates AdAccount rows). */
export async function linkAccounts(id: string, accounts: RemoteAccount[]) {
  const i = await db.integration.findUniqueOrThrow({ where: { id }, include: { client: true } });
  if (!i.clientId || !i.client) throw new ConnectorError("API", "Integration is not assigned to a client");
  const brand = await db.brand.findFirst({ where: { clientId: i.clientId }, orderBy: { createdAt: "asc" } });
  const connector = connectorOf(i);
  const organic = !connector.capabilities.includes("ads");
  for (const a of accounts) {
    await db.adAccount.upsert({
      where: { platform_externalId_clientId: { platform: i.platform, externalId: a.externalId, clientId: i.clientId } },
      create: {
        clientId: i.clientId,
        brandId: brand?.id ?? null,
        integrationId: i.id,
        platform: i.platform,
        externalId: a.externalId,
        name: a.name.slice(0, 200),
        currency: a.currency ?? i.client.currency,
        timezone: a.timezone ?? i.client.timezone,
        isOrganic: a.isOrganic ?? organic,
        source: "API",
      },
      update: { integrationId: i.id, name: a.name.slice(0, 200), ...(a.currency ? { currency: a.currency } : {}) },
    });
  }
  // Unlink accounts no longer selected (history is kept — only the link is removed).
  await db.adAccount.updateMany({
    where: { integrationId: i.id, externalId: { notIn: accounts.map((a) => a.externalId) } },
    data: { integrationId: null },
  });
  await db.integration.update({ where: { id }, data: { externalAccountId: accounts[0]?.externalId ?? null } });
}

// ───────────────────────── sync ─────────────────────────

export type SyncResult = { status: "SUCCEEDED" | "SKIPPED" | "FAILED"; rows: number; message: string; code?: ConnectorError["code"] };

export async function syncIntegration(id: string, now = new Date()): Promise<SyncResult> {
  const i = await db.integration.findUnique({ where: { id }, include: { client: { select: { isDemo: true, currency: true } }, accounts: true } });
  if (!i) return { status: "SKIPPED", rows: 0, message: "Integration no longer exists" };
  const connector = connectorOf(i);

  if (!i.enabled) return { status: "SKIPPED", rows: 0, message: "Integration is disabled" };
  if (!connector.syncInsights || connector.placeholder) {
    const run = await startRun(id, "sync");
    await finishRun(run.id, "SUCCEEDED", `${connector.displayName}: no data sync for this integration type`);
    return { status: "SKIPPED", rows: 0, message: "No data sync for this integration type" };
  }
  if (!i.accessTokenEnc && i.client?.isDemo) {
    const run = await startRun(id, "sync");
    await finishRun(run.id, "SUCCEEDED", "Demo integration — no live credentials, nothing synced");
    return { status: "SKIPPED", rows: 0, message: "Demo integration" };
  }
  if (!canSync(i.status, i.enabled) && i.status !== "SYNCING") {
    return { status: "SKIPPED", rows: 0, message: `Status ${i.status} — reconnect required` };
  }

  // Optimistic lock: only one sync per integration at a time (stale locks expire after 30 min).
  const lock = await db.integration.updateMany({
    where: { id, OR: [{ status: { not: "SYNCING" } }, { lastSyncAt: { lt: new Date(now.getTime() - SYNC_LOCK_MS) } }, { lastSyncAt: null }] },
    data: { status: "SYNCING", lastSyncAt: now },
  });
  if (lock.count === 0) return { status: "SKIPPED", rows: 0, message: "A sync is already running" };

  const run = await startRun(id, "sync");
  try {
    const token = await ensureFreshToken(i);
    if (!token) throw new ConnectorError("AUTH", "No credentials stored — connect first");
    const linked = i.accounts;
    if (!linked.length) throw new ConnectorError("API", "No accounts linked — choose accounts on the integration card");

    const cursor = readCursor(i.syncCursor);
    const accounts = linked.map((a) => ({ externalId: a.externalId, currency: a.currency, window: syncWindow(cursor.accounts?.[a.externalId]?.until, now) }));
    const out = await connector.syncInsights({ token, accounts });
    const rows = await writeRows(i.clientId!, linked, accounts, out.metrics, out.organic, connector.capabilities.includes("ads"));

    const nextCursor: SyncCursor = { ...cursor, accounts: { ...cursor.accounts } };
    for (const a of accounts) nextCursor.accounts![a.externalId] = { until: a.window.until };
    const status = deriveStatus({ current: "CONNECTED", hasCredentials: true, expiresAt: i.tokenExpiresAt, scopesRequired: i.scopesRequired, scopesGranted: i.scopesGranted.length ? i.scopesGranted : i.scopesRequired });
    await db.integration.update({
      where: { id },
      data: { status, lastSuccessAt: new Date(), lastError: null, syncCursor: nextCursor as Prisma.InputJsonValue },
    });
    const message = [`${rows} rows`, ...(out.notes ?? [])].join(" · ");
    await finishRun(run.id, "SUCCEEDED", message, rows);
    logger.info("integration.sync.ok", { integrationId: id, platform: i.platform, rows });
    return { status: "SUCCEEDED", rows, message };
  } catch (e) {
    const err = asConnectorError(e);
    await db.integration.update({ where: { id }, data: { status: statusForError(err.code), lastError: err.message } });
    await finishRun(run.id, "FAILED", err.message);
    logger.warn("integration.sync.failed", { integrationId: id, platform: i.platform, code: err.code, message: err.message });
    return { status: "FAILED", rows: 0, message: err.message, code: err.code };
  }
}

/**
 * Idempotent write: per account, API rows in the synced window are replaced in one transaction
 * (delete + insert). Demo / manual / imported rows are never touched.
 */
async function writeRows(
  clientId: string,
  linked: { id: string; externalId: string; brandId: string | null; currency: string; platform: Platform }[],
  windows: { externalId: string; window: { since: string; until: string } }[],
  metrics: NormalizedMetric[],
  organic: NormalizedOrganic[],
  paid: boolean,
) {
  let total = 0;
  const day = (s: string) => new Date(s + "T00:00:00.000Z");
  for (const acc of linked) {
    const w = windows.find((x) => x.externalId === acc.externalId)!.window;
    const inWindow = (d: string) => d >= w.since && d <= w.until;
    const m = metrics.filter((r) => r.accountExternalId === acc.externalId && inWindow(r.date));
    const o = organic.filter((r) => r.accountExternalId === acc.externalId && inWindow(r.date));

    // Campaigns (created or renamed) outside the transaction — they are reused across syncs.
    const campaignIds = new Map<string, string>();
    const specs = new Map(m.filter((r) => r.campaign).map((r) => [r.campaign!.externalId, r.campaign!]));
    if (specs.size) {
      const existing = await db.campaign.findMany({ where: { accountId: acc.id, externalId: { in: [...specs.keys()] } }, select: { id: true, externalId: true, name: true } });
      for (const c of existing) campaignIds.set(c.externalId!, c.id);
      for (const [ext, spec] of specs) {
        const id = campaignIds.get(ext);
        if (id) {
          await db.campaign.update({ where: { id }, data: { name: spec.name.slice(0, 250), ...(spec.status ? { status: spec.status } : {}), ...(spec.objective ? { objective: spec.objective } : {}) } });
        } else {
          const created = await db.campaign.create({
            data: {
              clientId,
              brandId: acc.brandId,
              accountId: acc.id,
              externalId: ext,
              name: spec.name.slice(0, 250),
              platform: acc.platform,
              // Platforms that don't report an objective default to TRAFFIC (editable on the Campaigns page).
              objective: spec.objective ?? "TRAFFIC",
              status: spec.status ?? "ACTIVE",
              source: "API",
            },
          });
          campaignIds.set(ext, created.id);
        }
      }
    }

    const platform = acc.platform;
    const syncedAt = new Date();
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (paid) {
      ops.push(db.metricDaily.deleteMany({ where: { accountId: acc.id, source: "API", date: { gte: day(w.since), lte: day(w.until) } } }));
      if (m.length)
        ops.push(
          db.metricDaily.createMany({
            data: m.map((r) => ({
              clientId,
              accountId: acc.id,
              campaignId: r.campaign ? campaignIds.get(r.campaign.externalId) ?? null : null,
              date: day(r.date),
              platform,
              spend: r.spend,
              impressions: r.impressions,
              reach: r.reach,
              clicks: r.clicks,
              leads: r.leads,
              purchases: r.purchases,
              revenue: r.revenue,
              videoViews: r.videoViews,
              videoCompletions: r.videoCompletions,
              engagements: r.engagements,
              currency: r.currency || acc.currency,
              source: "API" as const,
              syncedAt,
            })),
          }),
        );
    }
    // Organic: upsert per day so follower snapshots from earlier syncs are preserved when the API has no history.
    for (const r of o) {
      const base = { reach: r.reach, impressions: r.impressions, engagements: r.engagements, videoViews: r.videoViews, posts: r.posts, source: "API" as const };
      ops.push(
        db.organicMetricDaily.upsert({
          where: { accountId_date: { accountId: acc.id, date: day(r.date) } },
          create: { clientId, accountId: acc.id, date: day(r.date), platform, followers: r.followers ?? 0, ...base },
          update: { ...base, ...(r.followers != null ? { followers: r.followers } : {}) },
        }),
      );
    }
    await db.$transaction(ops);
    total += m.length + o.length;
  }
  return total;
}

// ───────────────────────── token expiry check (daily job) ─────────────────────────

/** Refreshes tokens expiring within 7 days where possible and marks expired ones. */
export async function checkTokens(now = new Date()) {
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const rows = await db.integration.findMany({ where: { enabled: true, accessTokenEnc: { not: null }, tokenExpiresAt: { not: null, lte: soon } } });
  let refreshed = 0;
  let expired = 0;
  for (const i of rows) {
    try {
      if (i.tokenExpiresAt! <= now) throw new ConnectorError("AUTH", "Access token expired — reconnect required");
      const before = i.tokenExpiresAt!.getTime();
      const t = await ensureFreshToken(i, true);
      if (t?.expiresAt && t.expiresAt.getTime() > before) refreshed++;
    } catch (e) {
      const err = asConnectorError(e);
      if (err.code === "AUTH") {
        expired++;
        await db.integration.update({ where: { id: i.id }, data: { status: "EXPIRED", lastError: err.message } });
      }
    }
  }
  return { checked: rows.length, refreshed, expired };
}
