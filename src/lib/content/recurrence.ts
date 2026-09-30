import { addDays, addMonthsClamped, zonedDayKey, zonedTime, zonedToUtc } from "./tz";

/**
 * Recurring posts. Stored on ContentItem.recurrence as a small RRULE subset
 * ("FREQ=WEEKLY;COUNT=4"); every occurrence is its own ContentItem sharing a seriesId, so
 * each can be edited, approved and published independently.
 */

export const RECURRENCE_FREQS = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];
export type Recurrence = { freq: RecurrenceFreq; count: number };

export const MAX_OCCURRENCES = 52;

export function formatRecurrence(r: Recurrence) {
  return `FREQ=${r.freq};COUNT=${r.count}`;
}

export function parseRecurrence(s: string | null | undefined): Recurrence | null {
  if (!s) return null;
  const parts = Object.fromEntries(
    s
      .split(";")
      .map((p) => p.split("="))
      .filter((kv) => kv.length === 2)
      .map(([k, v]) => [k.trim().toUpperCase(), v.trim().toUpperCase()]),
  );
  const freq = parts.FREQ as RecurrenceFreq;
  const count = Number(parts.COUNT);
  if (!RECURRENCE_FREQS.includes(freq) || !Number.isInteger(count) || count < 1) return null;
  return { freq, count: Math.min(count, MAX_OCCURRENCES) };
}

/**
 * Occurrence instants for a series starting at `start`. The wall-clock time is kept in the
 * item's timezone, so a 19:00 Cairo post stays at 19:00 across DST changes.
 */
export function expandOccurrences(start: Date, r: Recurrence, timeZone: string): Date[] {
  const day = zonedDayKey(start, timeZone);
  const time = zonedTime(start, timeZone);
  const out: Date[] = [];
  for (let i = 0; i < Math.min(r.count, MAX_OCCURRENCES); i++) {
    const d = r.freq === "DAILY" ? addDays(day, i) : r.freq === "WEEKLY" ? addDays(day, i * 7) : addMonthsClamped(day, i);
    out.push(i === 0 ? start : zonedToUtc(d, time, timeZone));
  }
  return out;
}
