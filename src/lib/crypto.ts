import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM envelope for secrets at rest (OAuth access/refresh tokens, TOTP secrets).
 * Key: ENCRYPTION_KEY env var, 32 bytes base64 (openssl rand -base64 32).
 * Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 32) return buf;
  // Platform-generated secrets (e.g. Render generateValue) may not decode to exactly 32 bytes:
  // accept any high-entropy string of 32+ chars by hashing it to a 256-bit key.
  if (raw.length >= 32) return createHash("sha256").update(raw).digest();
  throw new Error("ENCRYPTION_KEY must be 32 bytes base64 (openssl rand -base64 32) or a random string of 32+ characters");
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, ct] = payload.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

/** "****1234" — the only representation of a token that may reach the browser. */
export function mask(last4?: string | null): string {
  return last4 ? `****${last4}` : "—";
}

export function last4(secret: string): string {
  return secret.slice(-4);
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
