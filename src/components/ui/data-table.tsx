"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmtDate, fmtMoney, fmtNumber, fmtPct } from "@/lib/format";
import { cx, EmptyState, inputClass } from "./primitives";

type Primitive = string | number | null | undefined | boolean;
/** A cell is a raw value, or a raw value (for sort/search/CSV) plus pre-rendered JSX from the server. */
export type Cell = Primitive | { v: Primitive; d?: React.ReactNode };

export type Column = {
  key: string;
  label: string;
  type?: "text" | "number" | "money" | "pct" | "date";
  currency?: string;
  digits?: number;
  align?: "start" | "end";
  sortable?: boolean;
  hideOnMobile?: boolean;
};

export type Row = Record<string, Cell> & { _id?: string };

function raw(c: Cell): Primitive {
  return c !== null && typeof c === "object" ? c.v : c;
}

/**
 * Client-side search / sort / pagination for tables up to a few thousand rows.
 * For larger datasets pages paginate on the server and pass one page here.
 */
export function DataTable({
  columns,
  rows,
  pageSize = 20,
  searchable = true,
  exportName,
  empty,
  initialSort,
}: {
  columns: Column[];
  rows: Row[];
  pageSize?: number;
  searchable?: boolean;
  exportName?: string;
  empty?: React.ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
}) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = needle
      ? rows.filter((row) => columns.some((c) => String(raw(row[c.key]) ?? "").toLowerCase().includes(needle)))
      : rows;
    if (sort) {
      r = [...r].sort((a, b) => {
        const av = raw(a[sort.key]);
        const bv = raw(b[sort.key]);
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), locale);
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return r;
  }, [rows, columns, q, sort, locale]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = filtered.slice(current * pageSize, current * pageSize + pageSize);

  function format(c: Column, cell: Cell): React.ReactNode {
    if (cell !== null && typeof cell === "object" && cell.d !== undefined) return cell.d;
    const v = raw(cell);
    if (v == null || v === "") return <span className="text-subtle">—</span>;
    switch (c.type) {
      case "number":
        return fmtNumber(Number(v), locale, c.digits ?? 0);
      case "money":
        return fmtMoney(Number(v), c.currency ?? "EGP", locale, c.digits ?? 0);
      case "pct":
        return fmtPct(Number(v), locale, c.digits ?? 1);
      case "date":
        return fmtDate(String(v), locale);
      default:
        return typeof v === "boolean" ? (v ? t("ui.yes") : t("ui.no")) : String(v);
    }
  }

  function exportCsv() {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
    const lines = [columns.map((c) => esc(c.label)).join(",")];
    for (const r of filtered) lines.push(columns.map((c) => esc(String(raw(r[c.key]) ?? ""))).join(","));
    // BOM so Excel opens Arabic text correctly
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const isNumeric = (c: Column) => c.align === "end" || (c.type && c.type !== "text" && c.type !== "date");

  return (
    <div>
      {(searchable || exportName) && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 no-print">
          {searchable && (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-subtle" aria-hidden />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
                placeholder={t("ui.search")}
                aria-label={t("ui.search")}
                className={cx(inputClass, "ps-8")}
              />
            </div>
          )}
          <span className="text-xs text-subtle">
            <span className="num">{fmtNumber(filtered.length, locale)}</span> {t("ui.rows")}
          </span>
          {exportName && (
            <button onClick={exportCsv} className="ms-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2">
              <Download className="size-3.5" aria-hidden /> CSV
            </button>
          )}
        </div>
      )}
      {filtered.length === 0 ? (
        empty ?? <EmptyState title={t("ui.noData")} hint={t("ui.noDataHint")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                {columns.map((c) => (
                  <th key={c.key} className={cx("px-3 py-2 font-medium whitespace-nowrap", isNumeric(c) ? "text-end" : "text-start", c.hideOnMobile && "hidden md:table-cell")}>
                    {c.sortable === false ? (
                      c.label
                    ) : (
                      <button
                        className="inline-flex items-center gap-1 hover:text-text"
                        onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: "desc" }))}
                      >
                        {c.label}
                        <ArrowDownUp className={cx("size-3", sort?.key === c.key ? "text-brand" : "opacity-40")} aria-hidden />
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slice.map((r, i) => (
                <tr key={(r._id as string) ?? i} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                  {columns.map((c) => (
                    <td key={c.key} className={cx("px-3 py-2 align-top", isNumeric(c) ? "num text-end whitespace-nowrap" : "text-start", c.hideOnMobile && "hidden md:table-cell")}>
                      {format(c, r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-4 py-2 text-xs text-muted no-print">
          <button disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded p-1 hover:bg-surface-2 disabled:opacity-40" aria-label={t("ui.previous")}>
            <ChevronLeft className="size-4 flip-rtl" />
          </button>
          <span>
            {t("ui.page")} <span className="num">{current + 1}</span> {t("ui.of")} <span className="num">{pages}</span>
          </span>
          <button disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="rounded p-1 hover:bg-surface-2 disabled:opacity-40" aria-label={t("ui.next")}>
            <ChevronRight className="size-4 flip-rtl" />
          </button>
        </div>
      )}
    </div>
  );
}
