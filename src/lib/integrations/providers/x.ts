import { ConnectorError, type Connector, type TokenSet } from "../types";
import { requestJson, withQuery } from "../http";
import { requireEnv } from "../env";
import { parseScopes } from "../status";

/**
 * X API v2 (docs.x.com). OAuth 2.0 Authorization Code with PKCE; access tokens last 2 hours and
 * are refreshed with the `offline.access` refresh token.
 *
 * IMPORTANT: reading account data requires a PAID X API tier (Basic or higher). The free tier is
 * write-only. X Ads API access is a separate application and is not covered here.
 */

const SCOPES = ["tweet.read", "users.read", "offline.access"];

function basic() {
  return "Basic " + Buffer.from(`${requireEnv("X_CLIENT_ID")}:${requireEnv("X_CLIENT_SECRET")}`).toString("base64");
}

type XToken = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
const toSet = (r: XToken, prev?: string | null): TokenSet => ({
  accessToken: r.access_token,
  refreshToken: r.refresh_token ?? prev ?? null,
  expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null,
  scopes: parseScopes(r.scope),
});

export const xConnector: Connector = {
  id: "x",
  platform: "X",
  displayName: "X (Twitter)",
  authType: "oauth2",
  capabilities: ["organic"],
  requiredScopes: SCOPES,
  envVars: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  docsUrl: "https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code",
  rateLimit: { policy: "Per-endpoint 15-minute windows; monthly read caps depend on the paid tier. 429 responses carry x-rate-limit-reset.", maxConcurrency: 1, minIntervalMs: 1000 },
  pkce: true,
  limitations: ["Requires a paid X API tier (Basic or higher) — the free tier cannot read account data.", "Only a daily followers/posts snapshot is synced; post-level analytics need Pro/Enterprise."],
  authorizeUrl(state, redirectUri, challenge) {
    if (!challenge) throw new ConnectorError("API", "PKCE challenge missing");
    return withQuery("https://x.com/i/oauth2/authorize", {
      response_type: "code",
      client_id: requireEnv("X_CLIENT_ID"),
      redirect_uri: redirectUri,
      scope: SCOPES.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
  },
  async exchangeCode(code, redirectUri, verifier) {
    if (!verifier) throw new ConnectorError("API", "PKCE verifier missing");
    const r = await requestJson<XToken>("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: { Authorization: basic() },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }),
    });
    return toSet(r);
  },
  async refreshToken(token) {
    if (!token.refreshToken) return null;
    const r = await requestJson<XToken>("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: { Authorization: basic() },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken }),
    });
    return toSet(r, token.refreshToken);
  },
  async testConnection(token) {
    if (!token) throw new ConnectorError("AUTH", "No credentials stored");
    const me = await requestJson<{ data?: { username?: string } }>("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${token.accessToken}` }, retries: 1 });
    return { ok: true as const, identity: me.data?.username ? `@${me.data.username}` : undefined, scopes: token.scopes };
  },
  async listAccounts(token) {
    const me = await requestJson<{ data: { id: string; username: string } }>("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${token.accessToken}` } });
    return [{ externalId: me.data.id, name: `@${me.data.username}`, isOrganic: true }];
  },
  async syncInsights({ token, accounts }) {
    const me = await requestJson<{ data: { id: string; public_metrics?: { followers_count?: number; tweet_count?: number } } }>(
      "https://api.x.com/2/users/me?user.fields=public_metrics",
      { headers: { Authorization: `Bearer ${token.accessToken}` } },
    );
    const organic = accounts
      .filter((a) => a.externalId === me.data.id)
      .map((a) => ({
        accountExternalId: a.externalId,
        date: a.window.until,
        followers: me.data.public_metrics?.followers_count ?? null,
        posts: 0,
        reach: 0,
        impressions: 0,
        engagements: 0,
        videoViews: 0,
      }));
    return { metrics: [], organic, notes: ["X: daily followers snapshot only (paid API tier required)."] };
  },
  mapping: "GET /2/users/me?user.fields=public_metrics → today's followers snapshot (followers_count). Impressions/engagements require Pro/Enterprise post analytics (not synced).",
};
