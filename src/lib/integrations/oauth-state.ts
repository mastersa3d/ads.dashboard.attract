import { createHash, createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "@/lib/crypto";

/**
 * OAuth `state` handling (CSRF protection for /api/oauth/<connector>/callback).
 *
 *  - The URL `state` parameter is a random nonce.
 *  - An httpOnly cookie carries a signed payload {nonce, org, client, integration, user, connector,
 *    PKCE verifier, expiry}. HMAC-SHA256 keyed from ENCRYPTION_KEY (domain-separated).
 *  - The callback accepts the response only if the signature is valid, not expired, the nonce
 *    equals the returned `state`, and the logged-in user/org match the one who started the flow.
 */

export const OAUTH_COOKIE = "oauth_state";
export const OAUTH_TTL_MS = 10 * 60 * 1000;

export type OAuthStatePayload = {
  n: string; // nonce (also sent as ?state=)
  o: string; // organizationId
  c: string | null; // clientId
  i: string; // integrationId
  u: string; // userId
  k: string; // connector id
  v?: string; // PKCE code_verifier (never leaves our cookie)
  e: number; // expiry epoch ms
};

function stateKey(secret = process.env.ENCRYPTION_KEY) {
  if (!secret) throw new Error("ENCRYPTION_KEY is not set");
  return createHash("sha256").update("oauth-state:v1:").update(secret).digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signState(payload: OAuthStatePayload, secret?: string): string {
  const body = b64(JSON.stringify(payload));
  const sig = createHmac("sha256", stateKey(secret)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(signed: string | undefined | null, nonce: string | null, now = Date.now(), secret?: string): OAuthStatePayload | null {
  if (!signed || !nonce) return null;
  const [body, sig] = signed.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateKey(secret)).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.e !== "number" || payload.e < now) return null;
  if (typeof payload.n !== "string" || !safeEqual(payload.n, nonce)) return null;
  return payload;
}

export function newNonce() {
  return randomBytes(24).toString("base64url");
}

/** RFC 7636 S256 pair. */
export function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function redirectUriFor(connectorId: string) {
  return (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "") + `/api/oauth/${connectorId}/callback`;
}

/** Where the browser lands after the flow (success or error) — always Settings → Integrations. */
export function settingsRedirect(origin: string, params: Record<string, string>) {
  const base = (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? origin).replace(/\/$/, "");
  return `${base}/settings/integrations?${new URLSearchParams(params).toString()}`;
}
