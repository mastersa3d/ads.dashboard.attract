"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, FileText, Film, Trash2, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { deleteFile } from "@/app/actions/content";
import { fmtDate, fmtNumber } from "@/lib/format";
import { Badge, Button, Callout, cx, EmptyState, Select } from "@/components/ui/primitives";
import { AssetThumb } from "./asset-thumb";
import { ACCEPT_UPLOADS, MAX_UPLOAD_MB, useUpload } from "./use-upload";

export type FileDTO = { id: string; clientId: string; name: string; url: string; mimeType: string; sizeBytes: number; tags: string[]; createdAt: string; uploadedBy: string | null };

const size = (b: number, locale: "ar" | "en") => (b >= 1048576 ? `${fmtNumber(b / 1048576, locale, 1)} MB` : `${fmtNumber(Math.max(1, Math.round(b / 1024)), locale)} KB`);

/** Per-client file library: drag-and-drop / picker uploads, previews, copy link, delete. */
export function FileLibrary({
  files,
  clients,
  defaultClientId,
  canUpload,
  canDelete,
}: {
  files: FileDTO[];
  clients: { id: string; name: string }[];
  defaultClientId: string | null;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const up = useUpload();
  const [clientId, setClientId] = useState(defaultClientId ?? (clients.length === 1 ? clients[0].id : ""));
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  async function onFiles(list: FileList | null) {
    if (!list?.length || !clientId) return;
    const done = await up.upload(list, clientId, ["library"]);
    if (done.length) {
      setMessage({ tone: "good", text: t("content.uploaded", { n: done.length }) });
      router.refresh();
    }
  }

  function remove(id: string, name: string) {
    if (!confirm(t("content.confirmDeleteFile", { name }))) return;
    start(async () => {
      const res = await deleteFile(id);
      setMessage(res.ok ? { tone: "good", text: t("content.fileDeleted") } : { tone: "bad", text: t(`content.err.${res.error}`) });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {canUpload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            onFiles(e.dataTransfer.files);
          }}
          className={cx("flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-border bg-surface p-5 text-center sm:flex-row sm:text-start", over && "border-brand bg-brand-soft")}
        >
          <Upload className={cx("size-8 shrink-0 text-subtle", up.busy && "animate-pulse text-brand")} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{up.busy ? t("content.uploading") : t("content.dropFiles")}</p>
            <p className="text-xs text-muted">{t("content.uploadRules", { mb: MAX_UPLOAD_MB })}</p>
          </div>
          {clients.length > 1 && (
            <Select aria-label={t("filter.client")} className="w-full sm:w-52" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={t("content.chooseClient")} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
          )}
          <label className={cx("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-brand-fg hover:opacity-90", (!clientId || up.busy) && "pointer-events-none opacity-50")}>
            {t("content.chooseFiles")}
            <input type="file" multiple accept={ACCEPT_UPLOADS} className="sr-only" onChange={(e) => onFiles(e.target.files)} disabled={!clientId || up.busy} />
          </label>
        </div>
      )}
      {up.error && <Callout tone="bad">{t(up.error, { mb: MAX_UPLOAD_MB })}</Callout>}
      {message && <Callout tone={message.tone}>{message.text}</Callout>}

      {files.length === 0 ? (
        <EmptyState title={t("content.noFiles")} hint={t("content.noFilesHint")} />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {files.map((f) => {
            const kind = f.mimeType.startsWith("image/") ? "image" : f.mimeType.startsWith("video/") ? "video" : "pdf";
            return (
              <li key={f.id} className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="block aspect-square bg-surface-2">
                  {kind === "image" ? (
                    <AssetThumb url={f.url} alt={f.name} className="size-full object-cover" label={f.name} />
                  ) : (
                    <span className="grid size-full place-items-center text-subtle">{kind === "video" ? <Film className="size-10" aria-hidden /> : <FileText className="size-10" aria-hidden />}</span>
                  )}
                </a>
                <div className="flex flex-1 flex-col gap-1 p-2">
                  <p className="truncate text-xs font-medium" title={f.name}>
                    {f.name}
                  </p>
                  <p className="num text-[10px] text-subtle">
                    {size(f.sizeBytes, locale)} · {fmtDate(f.createdAt, locale)}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="neutral">{t(`content.kind.${kind}`)}</Badge>
                    {clients.length > 1 && <Badge tone="info">{clientName.get(f.clientId)}</Badge>}
                  </div>
                  <div className="mt-auto flex items-center gap-1 pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t("ui.copyLink")}
                      aria-label={t("ui.copyLink")}
                      onClick={() => {
                        navigator.clipboard?.writeText(new URL(f.url, window.location.origin).toString());
                        setMessage({ tone: "good", text: t("ui.copied") });
                      }}
                    >
                      <Copy className="size-3.5" aria-hidden />
                    </Button>
                    <a href={`${f.url}?download=1`} className="rounded-lg p-2 text-muted hover:bg-surface-2" title={t("content.download")} aria-label={t("content.download")}>
                      <Download className="size-3.5" aria-hidden />
                    </a>
                    {canDelete && (
                      <Button size="sm" variant="ghost" className="ms-auto text-bad" disabled={pending} onClick={() => remove(f.id, f.name)} aria-label={t("ui.delete")}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
