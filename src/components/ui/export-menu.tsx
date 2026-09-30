"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Image as ImageIcon, Printer } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { buttonClass } from "./primitives";

/**
 * Export menu used on every page.
 *  - CSV / Excel: server route /api/export/<dataset>?<current filters>&format=csv|xlsx (RBAC + tenant enforced there)
 *  - PDF: browser print with the print stylesheet (keeps Arabic shaping & RTL perfect)
 *  - PNG: snapshot of the element with id `targetId`
 */
export function ExportMenu({ dataset, query, targetId, fileName = "report" }: { dataset?: string; query?: string; targetId?: string; fileName?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  async function png() {
    setOpen(false);
    const el = targetId ? document.getElementById(targetId) : document.querySelector("main");
    if (!el) return;
    const { toPng } = await import("html-to-image");
    const bg = getComputedStyle(document.body).backgroundColor;
    const url = await toPng(el as HTMLElement, { backgroundColor: bg, pixelRatio: 2, filter: (n) => !(n instanceof HTMLElement && n.classList.contains("no-print")) });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.png`;
    a.click();
  }

  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-2 text-start";
  const href = (format: string) => `/api/export/${dataset}?${query ? query + "&" : ""}format=${format}`;

  return (
    <div className="relative no-print" ref={ref}>
      <button type="button" className={buttonClass("secondary")} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <Download className="size-4" aria-hidden /> {t("ui.export")}
      </button>
      {open && (
        <div role="menu" className="absolute end-0 z-30 mt-1 w-44 rounded-lg border border-border bg-surface p-1 shadow-lg">
          {dataset && (
            <>
              <a role="menuitem" className={item} href={href("csv")}>
                <FileText className="size-4 text-muted" aria-hidden /> {t("ui.exportCsv")}
              </a>
              <a role="menuitem" className={item} href={href("xlsx")}>
                <FileSpreadsheet className="size-4 text-muted" aria-hidden /> {t("ui.exportExcel")}
              </a>
            </>
          )}
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              setTimeout(() => window.print(), 50);
            }}
          >
            <Printer className="size-4 text-muted" aria-hidden /> {t("ui.exportPdf")}
          </button>
          <button role="menuitem" className={item} onClick={png}>
            <ImageIcon className="size-4 text-muted" aria-hidden /> {t("ui.exportImage")}
          </button>
        </div>
      )}
    </div>
  );
}
