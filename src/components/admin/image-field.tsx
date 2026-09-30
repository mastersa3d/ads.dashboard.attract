"use client";

import { useRef, useState } from "react";
import { ImageIcon, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, cx, inputClass } from "@/components/ui/primitives";

/**
 * Image URL field with optional upload. Upload posts multipart {file, clientId} to /api/uploads
 * (→ {id, url}); when that endpoint is unavailable the user can still paste a public URL.
 */
export function ImageField({ name, defaultValue, clientId, label, id }: { name: string; defaultValue?: string | null; clientId?: string; label: string; id?: string }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function upload(f: File) {
    if (!clientId) return;
    if (!f.type.startsWith("image/")) return setError(t("clients.uploadNotImage"));
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", f);
      body.set("clientId", clientId);
      const res = await fetch("/api/uploads", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!res.ok || !json?.url) throw new Error(String(res.status));
      setUrl(json.url);
    } catch {
      setError(t("clients.uploadUnavailable"));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-surface-2">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-supplied hosts
          <img src={url} alt="" className="size-full object-contain" />
        ) : (
          <ImageIcon className="size-5 text-subtle" aria-hidden />
        )}
      </div>
      <input id={id} name={name} value={url} onChange={(e) => setUrl(e.target.value)} type="url" dir="ltr" placeholder="https://…" aria-label={label} className={cx(inputClass, "min-w-0 flex-1")} />
      {clientId && (
        <>
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button type="button" size="sm" disabled={busy} onClick={() => file.current?.click()}>
            <Upload className="size-3.5" aria-hidden /> {busy ? t("ui.loading") : t("clients.upload")}
          </Button>
        </>
      )}
      {error && <p className="text-[11px] text-warn sm:basis-full">{error}</p>}
    </div>
  );
}
