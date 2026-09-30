import "server-only";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * File uploads are stored on local disk under UPLOAD_DIR (default ./uploads — outside
 * public/, so nothing is reachable without going through the authenticated
 * /api/uploads/[id] route). Layout: <UPLOAD_DIR>/<clientId>/<assetId>.<ext>, where assetId
 * is a random 24-char token that doubles as the FileAsset id.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type Kind = { mime: string; ext: string; family: "image" | "video" | "pdf" };

/** Allowed types, identified by magic bytes (the browser-declared MIME is not trusted). SVG is excluded (script risk). */
export function sniffMime(buf: Uint8Array): Kind | null {
  const at = (i: number, bytes: number[]) => bytes.every((b, k) => buf[i + k] === b);
  const ascii = (i: number, s: string) => at(i, [...s].map((c) => c.charCodeAt(0)));
  if (buf.length < 12) return null;
  if (at(0, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", family: "image" };
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png", family: "image" };
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return { mime: "image/gif", ext: "gif", family: "image" };
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { mime: "image/webp", ext: "webp", family: "image" };
  if (ascii(0, "%PDF-")) return { mime: "application/pdf", ext: "pdf", family: "pdf" };
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: "video/webm", ext: "webm", family: "video" };
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(...buf.slice(8, 12));
    if (brand === "qt  ") return { mime: "video/quicktime", ext: "mov", family: "video" };
    if (["heic", "heix", "mif1", "msf1"].includes(brand)) return { mime: "image/heic", ext: "heic", family: "image" };
    return { mime: "video/mp4", ext: "mp4", family: "video" };
  }
  return null;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/mp4": "mp4",
};

export function uploadRoot() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));
}

export function newAssetId() {
  return randomBytes(12).toString("hex");
}

export const ASSET_ID_RE = /^[a-f0-9]{24}$/;
const CUID_RE = /^[a-z0-9]{20,32}$/;

/** Absolute path for an asset; refuses anything that could escape the upload root. */
export function assetPath(clientId: string, assetId: string, mime: string) {
  const ext = EXT_BY_MIME[mime];
  if (!ext || !ASSET_ID_RE.test(assetId) || !CUID_RE.test(clientId)) return null;
  const root = uploadRoot();
  const p = path.join(root, clientId, `${assetId}.${ext}`);
  return p.startsWith(root + path.sep) ? p : null;
}

export const assetUrl = (assetId: string) => `/api/uploads/${assetId}`;

/** Keep a readable, header-safe original name for display / Content-Disposition. */
export function cleanFileName(name: string) {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f"\\/]/g, "").trim();
  return (base || "file").slice(0, 160);
}
