import { describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, last4, mask } from "@/lib/crypto";
import { backoffDelay, parseRetryAfter, requestJson } from "@/lib/integrations/http";
import { ConnectorError, statusForError } from "@/lib/integrations/types";
import { canSync, chunkWindow, deriveStatus, expiryState, missingScopes, parseScopes, readCursor, syncWindow } from "@/lib/integrations/status";
import { newNonce, pkcePair, signState, verifyState } from "@/lib/integrations/oauth-state";
import { classifyGraph } from "@/lib/integrations/providers/meta";
import { CONNECTORS, connectorFor } from "@/lib/integrations/registry";

describe("crypto", () => {
  it("round-trips secrets and never leaks plaintext", () => {
    const secret = "EAAB-super-secret-token-1234";
    const enc = encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decrypt(enc)).toBe(secret);
    expect(encrypt(secret)).not.toBe(enc); // random IV
  });
  it("rejects tampered ciphertext", () => {
    const enc = encrypt("hello world");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
  it("masks tokens to the last 4 characters", () => {
    expect(mask(last4("abcdef1234"))).toBe("****1234");
    expect(mask(null)).toBe("—");
  });
});

describe("status machine", () => {
  const base = { current: "CONNECTED" as const, hasCredentials: true, scopesRequired: ["ads_read", "read_insights"], scopesGranted: ["ads_read", "read_insights"] };
  it("detects missing scopes case-insensitively", () => {
    expect(missingScopes(["ads_read", "Read_Insights"], ["ADS_READ"])).toEqual(["Read_Insights"]);
    expect(parseScopes("a b,c  a")).toEqual(["a", "b", "c"]);
  });
  it("derives DISCONNECTED / EXPIRED / PERMISSION_MISSING / CONNECTED", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    expect(deriveStatus({ ...base, hasCredentials: false })).toBe("DISCONNECTED");
    expect(deriveStatus({ ...base, expiresAt: new Date("2026-09-01"), now })).toBe("EXPIRED");
    expect(deriveStatus({ ...base, scopesGranted: ["ads_read"], now })).toBe("PERMISSION_MISSING");
    expect(deriveStatus({ ...base, current: "SYNC_FAILED", now })).toBe("SYNC_FAILED");
    expect(deriveStatus({ ...base, now })).toBe("CONNECTED");
  });
  it("warns 14 days before expiry", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    expect(expiryState(null, now).state).toBe("none");
    expect(expiryState(new Date("2026-10-05T00:00:00Z"), now)).toEqual({ state: "soon", daysLeft: 5 });
    expect(expiryState(new Date("2026-12-30T00:00:00Z"), now).state).toBe("ok");
    expect(expiryState(new Date("2026-09-29T00:00:00Z"), now).state).toBe("expired");
  });
  it("maps connector errors to statuses and gates syncing", () => {
    expect(statusForError("AUTH")).toBe("EXPIRED");
    expect(statusForError("PERMISSION")).toBe("PERMISSION_MISSING");
    expect(statusForError("RATE_LIMIT")).toBe("SYNC_FAILED");
    expect(canSync("EXPIRED", true)).toBe(false);
    expect(canSync("CONNECTED", false)).toBe(false);
    expect(canSync("SYNC_FAILED", true)).toBe(true);
  });
});

describe("incremental sync window", () => {
  const now = new Date("2026-09-30T10:00:00Z");
  it("backfills 90 days on first sync", () => {
    expect(syncWindow(undefined, now)).toEqual({ since: "2026-07-03", until: "2026-09-30" });
  });
  it("re-pulls a 3-day lookback after the cursor", () => {
    expect(syncWindow("2026-09-29", now)).toEqual({ since: "2026-09-26", until: "2026-09-30" });
  });
  it("chunks long windows", () => {
    expect(chunkWindow({ since: "2026-09-01", until: "2026-09-30" }, 14)).toEqual([
      { since: "2026-09-01", until: "2026-09-14" },
      { since: "2026-09-15", until: "2026-09-28" },
      { since: "2026-09-29", until: "2026-09-30" },
    ]);
  });
  it("reads cursors defensively", () => {
    expect(readCursor(null)).toEqual({});
    expect(readCursor({ connector: "outlook-calendar", accounts: { a: { until: "2026-01-01" } } }).connector).toBe("outlook-calendar");
  });
});

describe("OAuth state", () => {
  const payload = { n: newNonce(), o: "org", c: "client", i: "int", u: "user", k: "meta", e: Date.now() + 60_000 };
  it("verifies a signed state bound to the returned nonce", () => {
    const signed = signState(payload);
    expect(verifyState(signed, payload.n)?.i).toBe("int");
  });
  it("rejects wrong nonce, tampering and expiry", () => {
    const signed = signState(payload);
    expect(verifyState(signed, "other")).toBeNull();
    const [body, sig] = signed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, o: "evil" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, payload.n)).toBeNull();
    expect(verifyState(`${body}.${sig}`, payload.n, payload.e + 1)).toBeNull();
    expect(verifyState(undefined, payload.n)).toBeNull();
  });
  it("creates S256 PKCE pairs", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).not.toBe(verifier);
  });
});

describe("HTTP helper", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  it("retries 429 honouring Retry-After, then succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "2" } })).mockResolvedValueOnce(ok({ a: 1 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await requestJson<{ a: number }>("https://api.example.com/x?access_token=SECRET", { fetchImpl, sleep });
    expect(res.a).toBe(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });
  it("does not retry auth errors and never puts the query string in messages", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { message: "bad token" } }), { status: 401 }));
    const err = await requestJson<never>("https://api.example.com/x?access_token=SECRET", { fetchImpl, sleep: async () => {} }).catch((e: ConnectorError) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe("AUTH");
    expect(err.message).not.toContain("SECRET");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("retries 5xx with backoff up to the limit", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response("oops", { status: 503 }));
    const err = await requestJson<never>("https://api.example.com/x", { fetchImpl, retries: 2, sleep: async () => {} }).catch((e: ConnectorError) => e);
    expect(err.code).toBe("API");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("classifies Meta throttling returned as HTTP 400", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 17, message: "User request limit reached" } }), { status: 400 })).mockResolvedValueOnce(ok({ data: [] }));
    const res = await requestJson<{ data: unknown[] }>("https://graph.facebook.com/v23.0/me", { fetchImpl, classify: classifyGraph, sleep: async () => {} });
    expect(res.data).toEqual([]);
    expect(classifyGraph(400, { error: { code: 190 } })?.code).toBe("AUTH");
    expect(classifyGraph(403, { error: { code: 200 } })?.code).toBe("PERMISSION");
  });
  it("computes bounded jittered backoff and parses Retry-After dates", () => {
    expect(backoffDelay(0, 500, 30_000, () => 1)).toBe(500);
    expect(backoffDelay(10, 500, 30_000, () => 0)).toBe(15_000);
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
    expect(parseRetryAfter("nonsense")).toBeUndefined();
  });
});

describe("registry", () => {
  it("covers every platform with a unique connector id", () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(connectorFor("CALENDAR", "outlook-calendar").id).toBe("outlook-calendar");
    expect(connectorFor("CALENDAR", "meta").id).toBe("google-calendar"); // variant must match platform
    expect(connectorFor("X").limitations?.join(" ")).toMatch(/paid/i);
    expect(connectorFor("GOOGLE_TRENDS").authType).toBe("none");
  });
});
