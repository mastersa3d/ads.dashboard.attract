import type { IntegrationStatus } from "@prisma/client";

/**
 * Pure helpers for the integration status machine (unit-tested in tests/integrations.test.ts).
 *
 *   DISCONNECTED ──connect──▶ CONNECTED ──sync start──▶ SYNCING ──ok──▶ CONNECTED
 *        ▲                      │   ▲                      │
 *        │ delete tokens        │   └──── reconnect ───────┤ error
 *        │                      ▼                          ▼
 *        └──────────── EXPIRED / PERMISSION_MISSING / SYNC_FAILED
 */

export const EXPIRY_WARNING_DAYS = 14;
const DAY = 86_400_000;

/** Scopes required but not granted. Comparison is case-insensitive and ignores URL prefixes order. */
export function missingScopes(required: string[], granted: string[]): string[] {
  const have = new Set(granted.map((s) => s.trim().toLowerCase()));
  return required.filter((s) => !have.has(s.trim().toLowerCase()));
}

/** Split a provider scope string ("a b", "a,b") into a clean list. */
export function parseScopes(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw.split(/[\s,]+/);
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

export type ExpiryState = { state: "none" | "ok" | "soon" | "expired"; daysLeft: number | null };

export function expiryState(expiresAt: Date | null | undefined, now = new Date(), warnDays = EXPIRY_WARNING_DAYS): ExpiryState {
  if (!expiresAt) return { state: "none", daysLeft: null };
  const daysLeft = Math.floor((expiresAt.getTime() - now.getTime()) / DAY);
  if (expiresAt.getTime() <= now.getTime()) return { state: "expired", daysLeft };
  return { state: daysLeft < warnDays ? "soon" : "ok", daysLeft };
}

/**
 * Status derived from what we know at rest (credentials, expiry, scopes).
 * Transient states (SYNCING / SYNC_FAILED) are preserved unless something more severe applies.
 */
export function deriveStatus(i: {
  current: IntegrationStatus;
  hasCredentials: boolean;
  expiresAt?: Date | null;
  scopesRequired: string[];
  scopesGranted: string[];
  now?: Date;
}): IntegrationStatus {
  if (!i.hasCredentials) return "DISCONNECTED";
  if (expiryState(i.expiresAt, i.now).state === "expired") return "EXPIRED";
  if (missingScopes(i.scopesRequired, i.scopesGranted).length) return "PERMISSION_MISSING";
  if (i.current === "SYNCING" || i.current === "SYNC_FAILED") return i.current;
  return "CONNECTED";
}

/** Only these states may be synced; EXPIRED / DISCONNECTED need the user to reconnect first. */
export function canSync(status: IntegrationStatus, enabled: boolean) {
  return enabled && (status === "CONNECTED" || status === "SYNC_FAILED" || status === "PERMISSION_MISSING");
}

export const STATUS_TONE: Record<IntegrationStatus, "good" | "bad" | "warning" | "info" | "neutral"> = {
  CONNECTED: "good",
  SYNCING: "info",
  DISCONNECTED: "neutral",
  EXPIRED: "bad",
  SYNC_FAILED: "bad",
  PERMISSION_MISSING: "warning",
};

// ───────────────────────── incremental sync window ─────────────────────────

export type SyncCursor = {
  /** Connector variant for platforms with several providers (e.g. CALENDAR → google | outlook). */
  connector?: string;
  /** Last day fully synced per account external id (yyyy-mm-dd). */
  accounts?: Record<string, { until: string }>;
};

export function readCursor(raw: unknown): SyncCursor {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const c = raw as SyncCursor;
  return { connector: typeof c.connector === "string" ? c.connector : undefined, accounts: c.accounts && typeof c.accounts === "object" ? c.accounts : {} };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Days to request for one account. First sync backfills `initialDays`; later syncs start
 * `lookbackDays` before the last synced day because platforms restate recent days
 * (attribution windows, late conversions). Always ends today (partial day is re-pulled next run).
 */
export function syncWindow(lastUntil: string | undefined, now = new Date(), opts: { initialDays?: number; lookbackDays?: number; maxDays?: number } = {}) {
  const initialDays = opts.initialDays ?? 90;
  const lookbackDays = opts.lookbackDays ?? 3;
  const maxDays = opts.maxDays ?? 400;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let since: Date;
  if (lastUntil && /^\d{4}-\d{2}-\d{2}$/.test(lastUntil)) {
    since = new Date(Date.parse(lastUntil + "T00:00:00Z") - lookbackDays * DAY);
  } else {
    since = new Date(today.getTime() - (initialDays - 1) * DAY);
  }
  const earliest = new Date(today.getTime() - (maxDays - 1) * DAY);
  if (since < earliest) since = earliest;
  if (since > today) since = today;
  return { since: iso(since), until: iso(today) };
}

/** Split a window into chunks (APIs cap the range per request, e.g. TikTok 30 days). */
export function chunkWindow(w: { since: string; until: string }, maxDays: number) {
  const out: { since: string; until: string }[] = [];
  let start = Date.parse(w.since + "T00:00:00Z");
  const end = Date.parse(w.until + "T00:00:00Z");
  while (start <= end) {
    const stop = Math.min(end, start + (maxDays - 1) * DAY);
    out.push({ since: iso(new Date(start)), until: iso(new Date(stop)) });
    start = stop + DAY;
  }
  return out;
}
