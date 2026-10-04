import nodemailer from "nodemailer";
import { ConnectorError, type Connector, type TokenSet } from "../types";
import { requestJson, withQuery } from "../http";
import { hasEnv, requireEnv } from "../env";
import { parseScopes } from "../status";

// ───────────────────────── Microsoft (Outlook Calendar / OneDrive) — optional placeholders ─────────────────────────

const MS_TENANT = () => process.env.MS_TENANT_ID || "common";

function msConnector(opts: { id: string; platform: "CALENDAR" | "CLOUD_STORAGE"; displayName: string; scopes: string[]; docsUrl: string; mapping: string }): Connector {
  type MsToken = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  const toSet = (r: MsToken, prev?: string | null): TokenSet => ({
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? prev ?? null,
    expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null,
    scopes: parseScopes(r.scope),
  });
  const tokenUrl = () => `https://login.microsoftonline.com/${MS_TENANT()}/oauth2/v2.0/token`;
  return {
    id: opts.id,
    platform: opts.platform,
    displayName: opts.displayName,
    authType: "oauth2",
    capabilities: [opts.platform === "CALENDAR" ? "calendar" : "storage"],
    requiredScopes: opts.scopes.filter((s) => s !== "offline_access"),
    envVars: ["MS_CLIENT_ID", "MS_CLIENT_SECRET"],
    docsUrl: opts.docsUrl,
    rateLimit: { policy: "Microsoft Graph service-specific throttling (429 + Retry-After).", maxConcurrency: 2, minIntervalMs: 200 },
    placeholder: true,
    limitations: ["Optional: stores the connection only; no data is synced yet."],
    authorizeUrl(state, redirectUri) {
      return withQuery(`https://login.microsoftonline.com/${MS_TENANT()}/oauth2/v2.0/authorize`, {
        client_id: requireEnv("MS_CLIENT_ID"),
        response_type: "code",
        redirect_uri: redirectUri,
        response_mode: "query",
        scope: opts.scopes.join(" "),
        state,
      });
    },
    async exchangeCode(code, redirectUri) {
      const r = await requestJson<MsToken>(tokenUrl(), {
        method: "POST",
        body: new URLSearchParams({ client_id: requireEnv("MS_CLIENT_ID"), client_secret: requireEnv("MS_CLIENT_SECRET"), code, redirect_uri: redirectUri, grant_type: "authorization_code", scope: opts.scopes.join(" ") }),
      });
      return toSet(r);
    },
    async refreshToken(token) {
      if (!token.refreshToken) return null;
      const r = await requestJson<MsToken>(tokenUrl(), {
        method: "POST",
        body: new URLSearchParams({ client_id: requireEnv("MS_CLIENT_ID"), client_secret: requireEnv("MS_CLIENT_SECRET"), refresh_token: token.refreshToken, grant_type: "refresh_token", scope: opts.scopes.join(" ") }),
      });
      return toSet(r, token.refreshToken);
    },
    async testConnection(token) {
      if (!token) throw new ConnectorError("AUTH", "No credentials stored");
      const me = await requestJson<{ userPrincipalName?: string }>("https://graph.microsoft.com/v1.0/me?$select=userPrincipalName", { headers: { Authorization: `Bearer ${token.accessToken}` }, retries: 1 });
      return { ok: true as const, identity: me.userPrincipalName, scopes: token.scopes };
    },
    mapping: opts.mapping,
  };
}

export const outlookCalendar = msConnector({
  id: "outlook-calendar",
  platform: "CALENDAR",
  displayName: "Outlook Calendar (Microsoft 365)",
  scopes: ["offline_access", "User.Read", "Calendars.Read"],
  docsUrl: "https://learn.microsoft.com/en-us/graph/outlook-calendar-concept-overview",
  mapping: "Placeholder — connection only. Planned: ContentItem.publishAt ↔ Outlook events (read-only).",
});

export const oneDrive = msConnector({
  id: "onedrive",
  platform: "CLOUD_STORAGE",
  displayName: "OneDrive / SharePoint",
  scopes: ["offline_access", "User.Read", "Files.Read"],
  docsUrl: "https://learn.microsoft.com/en-us/graph/onedrive-concept-overview",
  mapping: "Placeholder — connection only. Planned: attach OneDrive files to FileAsset.",
});

// ───────────────────────── Google Trends — no official API ─────────────────────────

export const googleTrends: Connector = {
  id: "google-trends",
  platform: "GOOGLE_TRENDS",
  displayName: "Google Trends",
  authType: "none",
  capabilities: ["search"],
  requiredScopes: [],
  envVars: [],
  docsUrl: "https://trends.google.com/trends/",
  rateLimit: { policy: "Not applicable — manual / CSV import only.", maxConcurrency: 0, minIntervalMs: 0 },
  limitations: [
    "Google Trends has no official public API. Data is entered manually or imported from the CSV you download from trends.google.com (Trends & Opportunities → Import).",
    "We never scrape Google Trends.",
  ],
  async testConnection() {
    return { ok: true as const, identity: "Manual / CSV import" };
  },
  mapping: "CSV export (Interest over time / Related queries) → TrendSignal rows with source IMPORT (handled on the Trends page).",
};

// ───────────────────────── Email (SMTP) ─────────────────────────

export const email: Connector = {
  id: "email",
  platform: "EMAIL",
  displayName: "Email (SMTP)",
  authType: "none",
  capabilities: ["email"],
  requiredScopes: [],
  envVars: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"],
  docsUrl: "https://support.hostinger.com/en/articles/1583218-how-to-set-up-an-email-account-in-an-email-client",
  rateLimit: { policy: "Depends on the SMTP provider (Hostinger: sending limits per mailbox/day).", maxConcurrency: 1, minIntervalMs: 0 },
  limitations: ["Configured with server environment variables (SMTP_*); used for alerts, invitations and scheduled reports."],
  async testConnection() {
    if (!hasEnv("SMTP_HOST")) throw new ConnectorError("NOT_CONFIGURED", "SMTP_HOST is not configured — e-mails are only logged");
    const port = (Number(process.env.SMTP_PORT) || 465);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10_000,
    });
    try {
      await transport.verify();
    } catch (e) {
      const code = (e as { code?: string }).code;
      throw new ConnectorError(code === "EAUTH" ? "AUTH" : "NETWORK", `SMTP verification failed${code ? ` (${code})` : ""}`);
    }
    return { ok: true as const, identity: process.env.SMTP_HOST };
  },
  mapping: "No data sync — status only (SMTP connection verified with the configured credentials).",
};
