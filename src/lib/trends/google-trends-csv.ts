/**
 * Parser for files exported from trends.google.com (the "download CSV" button). Supported exports:
 *  - Related queries / related topics  → TOP rows (volumeIndex) and RISING rows (+x% / Breakout)
 *  - Interest over time (multiTimeline) → one signal per term; growth = mean of the last 4 points vs
 *    the 4 before (an estimate, labelled as such in the UI via source = IMPORT + growth method).
 * Anything else is rejected with a clear error — we never guess.
 */

export type ParsedSignal = { keyword: string; kind: "SEARCH" | "RISING" | "TOPIC"; growthPct: number | null; volumeIndex: number | null; breakout?: boolean };
export type TrendsCsvResult = { ok: true; format: "RELATED" | "TIMELINE"; signals: ParsedSignal[]; region: string | null } | { ok: false; error: "EMPTY" | "UNSUPPORTED" };

/** Google labels "Breakout" when growth exceeds +5000%. */
const BREAKOUT_GROWTH = 50;

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.replace(/[<>,%+\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseGoogleTrendsCsv(text: string, topKind: "SEARCH" | "TOPIC" = "SEARCH"): TrendsCsvResult {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  if (!nonEmpty.length) return { ok: false, error: "EMPTY" };

  // Related queries / topics: sections introduced by a bare "TOP" or "RISING" line
  if (nonEmpty.some((l) => /^(TOP|RISING)$/i.test(parseLine(l)[0]) && parseLine(l).filter(Boolean).length === 1)) {
    const signals: ParsedSignal[] = [];
    let section: "TOP" | "RISING" | null = null;
    for (const l of nonEmpty) {
      const cells = parseLine(l);
      const head = cells[0].toUpperCase();
      if ((head === "TOP" || head === "RISING") && cells.filter(Boolean).length === 1) {
        section = head;
        continue;
      }
      if (!section || cells.length < 2 || !cells[0]) continue;
      const [keyword, value] = cells;
      if (section === "TOP") signals.push({ keyword, kind: topKind, growthPct: null, volumeIndex: num(value) });
      else if (/breakout/i.test(value)) signals.push({ keyword, kind: "RISING", growthPct: BREAKOUT_GROWTH, volumeIndex: null, breakout: true });
      else {
        const g = num(value);
        if (g != null) signals.push({ keyword, kind: "RISING", growthPct: g / 100, volumeIndex: null });
      }
    }
    return signals.length ? { ok: true, format: "RELATED", signals, region: null } : { ok: false, error: "EMPTY" };
  }

  // Interest over time: header "Week|Day|Month|Time,<term>: (<region>),..."
  const headerIdx = lines.findIndex((l) => /^(week|day|month|time|الأسبوع|اليوم|الشهر)\s*,/i.test(l));
  if (headerIdx >= 0) {
    const header = parseLine(lines[headerIdx]);
    const rows = lines
      .slice(headerIdx + 1)
      .filter(Boolean)
      .map(parseLine)
      .filter((r) => /^\d{4}-\d{2}/.test(r[0]));
    if (rows.length < 2) return { ok: false, error: "EMPTY" };
    let region: string | null = null;
    const signals: ParsedSignal[] = [];
    for (let c = 1; c < header.length; c++) {
      const m = header[c].match(/^(.*?)(?::\s*\((.*)\))?$/);
      const keyword = (m?.[1] ?? header[c]).trim();
      region ??= m?.[2]?.trim() ?? null;
      if (!keyword) continue;
      const values = rows.map((r) => num(r[c]) ?? 0);
      const n = Math.min(4, Math.floor(values.length / 2));
      const recent = values.slice(-n);
      const before = values.slice(-2 * n, -n);
      const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
      const growth = avg(before) > 0 ? avg(recent) / avg(before) - 1 : null;
      signals.push({ keyword, kind: growth != null && growth >= 0.2 ? "RISING" : "SEARCH", growthPct: growth == null ? null : Math.round(growth * 1000) / 1000, volumeIndex: values.at(-1) ?? null });
    }
    return signals.length ? { ok: true, format: "TIMELINE", signals, region } : { ok: false, error: "EMPTY" };
  }
  return { ok: false, error: "UNSUPPORTED" };
}
