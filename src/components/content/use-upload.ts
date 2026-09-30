"use client";

import { useState } from "react";

export type UploadedAsset = { id: string; url: string; name: string; mimeType: string; sizeBytes: number };

export const ACCEPT_UPLOADS = "image/jpeg,image/png,image/gif,image/webp,image/heic,video/mp4,video/quicktime,video/webm,application/pdf";
export const MAX_UPLOAD_MB = 25;

/** Upload files to /api/uploads (auth + tenant checked server-side). Errors are i18n keys. */
export function useUpload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | File[], clientId: string, tags: string[] = []): Promise<UploadedAsset[]> {
    setBusy(true);
    setError(null);
    const out: UploadedAsset[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
          setError("content.upload.TOO_LARGE");
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        fd.append("clientId", clientId);
        if (tags.length) fd.append("tags", tags.join(","));
        const res = await fetch("/api/uploads", { method: "POST", body: fd });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(`content.upload.${body.error ?? "FAILED"}`);
          continue;
        }
        out.push((await res.json()) as UploadedAsset);
      }
    } catch {
      setError("content.upload.FAILED");
    } finally {
      setBusy(false);
    }
    return out;
  }

  return { upload, busy, error, clearError: () => setError(null) };
}
