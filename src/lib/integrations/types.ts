import type { CampaignStatus, IntegrationStatus, Objective, Platform } from "@prisma/client";

/**
 * Integration framework contracts.
 *
 * A Connector knows how to authorize against ONE official platform API, test the credentials,
 * list the accounts/properties/pages the credentials can see, and pull daily insights that are
 * normalized into MetricDaily (paid) / OrganicMetricDaily (organic) rows. Connectors are pure
 * API clients: they never touch the database — lib/integrations/service.ts does that.
 *
 * NOTE: this folder is imported by the background worker (plain Node via tsx), so nothing here
 * may `import "server-only"`.
 */

export type AuthType = "oauth2" | "token" | "none";

export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  /** Absolute expiry of the access token; null = long-lived / does not expire. */
  expiresAt?: Date | null;
  /** Scopes the platform reports as granted (normalized, de-duplicated). */
  scopes?: string[];
};

export type RemoteAccount = {
  externalId: string;
  name: string;
  currency?: string | null;
  timezone?: string | null;
  /** Page / profile / property rather than an ad account. */
  isOrganic?: boolean;
};

/** One paid-media row per account × campaign × day, in the account currency. */
export type NormalizedMetric = {
  accountExternalId: string;
  date: string; // yyyy-mm-dd (account timezone, as reported by the platform)
  campaign?: { externalId: string; name: string; objective?: Objective; status?: CampaignStatus } | null;
  currency: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  purchases: number;
  revenue: number;
  videoViews: number;
  videoCompletions: number;
  engagements: number;
};

/** One organic row per account (page / profile / property) × day. */
export type NormalizedOrganic = {
  accountExternalId: string;
  date: string; // yyyy-mm-dd
  followers: number;
  posts: number;
  reach: number;
  impressions: number;
  engagements: number;
  videoViews: number;
};

export type SyncWindow = { since: string; until: string };

export type SyncInput = {
  token: TokenSet;
  /** Linked accounts to sync, each with its own incremental window. */
  accounts: { externalId: string; currency: string; window: SyncWindow }[];
};

export type SyncOutput = {
  metrics: NormalizedMetric[];
  organic: NormalizedOrganic[];
  /** Human-readable notes (e.g. "reach not available at campaign×day level"). Never contains secrets. */
  notes?: string[];
};

export type RateLimitInfo = {
  /** Short description of the platform's published limits. */
  policy: string;
  /** Max concurrent requests we allow ourselves against this API. */
  maxConcurrency: number;
  /** Minimum pause between paginated calls (ms). */
  minIntervalMs: number;
};

export type ConnectorCapability = "ads" | "organic" | "analytics" | "search" | "calendar" | "storage" | "email";

export type Connector = {
  /** URL-safe id, used in /api/oauth/<id>/start|callback. */
  id: string;
  platform: Platform;
  displayName: string;
  authType: AuthType;
  capabilities: ConnectorCapability[];
  /** Official scopes/permissions required for read-only reporting. */
  requiredScopes: string[];
  /** Env vars that must be set for the OAuth app (names only — values are never exposed). */
  envVars: string[];
  /** Official developer documentation for setting up the app. */
  docsUrl: string;
  rateLimit: RateLimitInfo;
  /** Displayed on the card (e.g. "requires paid API tier", "no official API — CSV import only"). */
  limitations?: string[];
  /** Whether a long-lived token may be pasted manually instead of the OAuth flow. */
  manualToken?: boolean;
  /** OAuth 2.0 PKCE (RFC 7636) required by the provider. */
  pkce?: boolean;
  /** Placeholder integrations only store configuration; they never sync. */
  placeholder?: boolean;

  authorizeUrl?(state: string, redirectUri: string, pkceChallenge?: string): string;
  exchangeCode?(code: string, redirectUri: string, pkceVerifier?: string): Promise<TokenSet>;
  /** Returns a fresh token set, or null when the platform has no refresh mechanism. */
  refreshToken?(token: TokenSet): Promise<TokenSet | null>;
  /** Cheap authenticated call. Returns the scopes actually granted when the API exposes them. */
  testConnection(token: TokenSet | null): Promise<{ ok: true; scopes?: string[]; identity?: string }>;
  listAccounts?(token: TokenSet): Promise<RemoteAccount[]>;
  syncInsights?(input: SyncInput): Promise<SyncOutput>;
  /** Documentation of how API fields map to our columns (shown in the Data Sync tab). */
  mapping: string;
};

export type ConnectorErrorCode = "AUTH" | "PERMISSION" | "RATE_LIMIT" | "NOT_CONFIGURED" | "UNSUPPORTED" | "NETWORK" | "API";

/** Errors raised by connectors and the HTTP helper. Messages must never contain secrets or URLs with tokens. */
export class ConnectorError extends Error {
  constructor(
    public code: ConnectorErrorCode,
    message: string,
    public meta: { status?: number; retryAfterMs?: number; missingScopes?: string[] } = {},
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** Status an integration should move to after an error of the given kind. */
export function statusForError(code: ConnectorErrorCode): IntegrationStatus {
  switch (code) {
    case "AUTH":
      return "EXPIRED";
    case "PERMISSION":
      return "PERMISSION_MISSING";
    case "NOT_CONFIGURED":
      return "DISCONNECTED";
    default:
      return "SYNC_FAILED";
  }
}
