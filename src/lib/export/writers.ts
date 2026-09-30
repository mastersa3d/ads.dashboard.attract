import "server-only";
import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import type { ExportColumn, ExportRow, ExportValue } from "./datasets";
import type { Locale } from "@/lib/format";

type Labels = { yes: string; no: string };

/** Spreadsheet apps execute cells starting with these characters as formulas (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

function round(n: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function textValue(v: ExportValue, labels: Labels): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join("; ");
  if (typeof v === "boolean") return v ? labels.yes : labels.no;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** CSV cell: raw machine-readable numbers (no locale grouping), ISO dates, quoted text. */
function csvCell(c: ExportColumn, v: ExportValue, labels: Labels): string {
  let s: string;
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) s = "";
  else if (typeof v === "number") {
    switch (c.type) {
      case "pct":
        s = `${round(v * 100, 2)}%`;
        break;
      case "money":
      case "ratio":
        s = String(round(v, 2));
        break;
      default:
        s = String(round(v, 4));
    }
  } else if (v instanceof Date) s = c.type === "date" ? v.toISOString().slice(0, 10) : v.toISOString();
  else {
    s = textValue(v, labels);
    if (FORMULA_START.test(s)) s = `'${s}`;
  }
  return /[",\n\r;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** UTF-8 CSV with BOM (so Excel renders Arabic correctly), streamed batch by batch. */
export function csvStream(columns: ExportColumn[], batches: AsyncGenerator<ExportRow[]>, labels: Labels): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(enc.encode("﻿" + columns.map((c) => csvCell({ ...c, type: "text" }, c.label, labels)).join(",") + "\r\n"));
          return;
        }
        const { value, done } = await batches.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(enc.encode(value.map((r) => columns.map((c) => csvCell(c, r[c.key], labels)).join(",") + "\r\n").join("")));
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await batches.return(undefined);
    },
  });
}

const NUM_FMT: Partial<Record<NonNullable<ExportColumn["type"]>, string>> = {
  number: "#,##0.##",
  money: "#,##0.00",
  ratio: "0.00",
  pct: "0.00%",
  date: "yyyy-mm-dd",
  datetime: "yyyy-mm-dd hh:mm",
};

function xlsxValue(c: ExportColumn, v: ExportValue, labels: Labels): ExcelJS.CellValue {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v;
  const s = textValue(v, labels);
  return FORMULA_START.test(s) && c.type !== "number" ? `'${s}` : s;
}

/** Display width of a value (in characters) for auto-sized columns. */
function widthOf(c: ExportColumn, v: ExportValue, labels: Labels) {
  if (v == null) return 0;
  if (c.type === "date") return 10;
  if (c.type === "datetime") return 16;
  if (typeof v === "number") return Math.min(18, String(round(v, 2)).length + 3);
  return textValue(v, labels).length;
}

/**
 * Streaming XLSX (exceljs WorkbookWriter): rows are committed as they arrive so memory stays flat.
 * Column widths are sized from the header and the first batch; RTL sheet view for Arabic.
 */
export async function xlsxStream(opts: {
  sheetName: string;
  columns: ExportColumn[];
  batches: AsyncGenerator<ExportRow[]>;
  locale: Locale;
  labels: Labels;
  title?: string;
}): Promise<ReadableStream<Uint8Array>> {
  const { columns, batches, labels } = opts;
  const first = await batches.next();
  const firstRows = first.done ? [] : first.value;

  const pass = new PassThrough();
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: true, useSharedStrings: false });
  wb.creator = "Marketing Intelligence Dashboard";
  wb.created = new Date();
  const ws = wb.addWorksheet(opts.sheetName.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: opts.locale === "ar" }],
  });
  ws.columns = columns.map((c) => {
    const sample = firstRows.slice(0, 500).reduce((m, r) => Math.max(m, widthOf(c, r[c.key], labels)), 0);
    return {
      header: c.label,
      key: c.key,
      width: Math.min(60, Math.max(10, c.label.length + 2, sample + 2)),
      style: NUM_FMT[c.type ?? "text"] ? { numFmt: NUM_FMT[c.type ?? "text"] } : {},
    };
  });
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
  header.alignment = { vertical: "middle", horizontal: opts.locale === "ar" ? "right" : "left", wrapText: true };
  header.height = 22;
  header.commit();

  const write = (rows: ExportRow[]) => {
    for (const r of rows) {
      const out: Record<string, ExcelJS.CellValue> = {};
      for (const c of columns) out[c.key] = xlsxValue(c, r[c.key], labels);
      ws.addRow(out).commit();
    }
  };

  // Produce in the background; the response body consumes `pass` as it fills.
  void (async () => {
    try {
      write(firstRows);
      if (!first.done) for await (const rows of batches) write(rows);
      ws.commit();
      await wb.commit();
    } catch (e) {
      pass.destroy(e as Error);
    }
  })();

  return Readable.toWeb(pass) as unknown as ReadableStream<Uint8Array>;
}
