/**
 * Report schedules (pure, unit-tested). Stored in Report.schedule as:
 *   "daily:HH:MM" | "weekly:<mon|tue|wed|thu|fri|sat|sun>:HH:MM" | "monthly:<1-28>:HH:MM"
 * Times are wall-clock in the client's timezone (DST-safe conversion via Intl).
 */

export type Frequency = "daily" | "weekly" | "monthly";
export type Schedule = { freq: Frequency; day: number; hour: number; minute: number };

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY = 86_400_000;

export function parseSchedule(raw: string | null | undefined): Schedule | null {
  if (!raw) return null;
  const parts = raw.trim().toLowerCase().split(":");
  const freq = parts[0] as Frequency;
  const time = (h?: string, m?: string) => {
    const hour = Number(h);
    const minute = Number(m);
    return Number.isInteger(hour) && hour >= 0 && hour < 24 && Number.isInteger(minute) && minute >= 0 && minute < 60 ? { hour, minute } : null;
  };
  if (freq === "daily" && parts.length === 3) {
    const t = time(parts[1], parts[2]);
    return t ? { freq, day: 0, ...t } : null;
  }
  if (freq === "weekly" && parts.length === 4) {
    const day = WEEKDAYS.indexOf(parts[1] as (typeof WEEKDAYS)[number]);
    const t = time(parts[2], parts[3]);
    return day >= 0 && t ? { freq, day, ...t } : null;
  }
  if (freq === "monthly" && parts.length === 4) {
    const day = Number(parts[1]);
    const t = time(parts[2], parts[3]);
    return Number.isInteger(day) && day >= 1 && day <= 28 && t ? { freq, day, ...t } : null;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatSchedule(s: Schedule): string {
  const hm = `${pad(s.hour)}:${pad(s.minute)}`;
  if (s.freq === "daily") return `daily:${hm}`;
  if (s.freq === "weekly") return `weekly:${WEEKDAYS[s.day]}:${hm}`;
  return `monthly:${s.day}:${hm}`;
}

// ───────────────────────── timezone helpers ─────────────────────────

type Parts = { y: number; m: number; d: number; h: number; min: number; dow: number };

export function zonedParts(date: Date, timeZone: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, dow: WEEKDAYS.indexOf(p.weekday.toLowerCase().slice(0, 3) as (typeof WEEKDAYS)[number]) };
}

function offsetMs(ts: number, timeZone: string) {
  const p = zonedParts(new Date(ts), timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ts / 60_000) * 60_000;
}

/** Wall-clock time in `timeZone` → UTC instant. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - offsetMs(guess, timeZone);
  return new Date(guess - offsetMs(first, timeZone));
}

/** Calendar arithmetic on local dates (represented as UTC midnights). */
const localDate = (p: Pick<Parts, "y" | "m" | "d">) => Date.UTC(p.y, p.m - 1, p.d);
const partsOf = (utcMidnight: number) => {
  const d = new Date(utcMidnight);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay() };
};

function occurrenceOnOrBefore(s: Schedule, now: Date, tz: string): Date {
  const local = zonedParts(now, tz);
  let base = localDate(local);
  if (s.freq === "weekly") base -= ((local.dow - s.day + 7) % 7) * DAY;
  if (s.freq === "monthly") base = Date.UTC(local.y, local.m - 1, s.day);
  const at = (b: number) => {
    const p = partsOf(b);
    return zonedToUtc(p.y, p.m, p.d, s.hour, s.minute, tz);
  };
  let occ = at(base);
  if (occ.getTime() > now.getTime()) {
    if (s.freq === "daily") base -= DAY;
    else if (s.freq === "weekly") base -= 7 * DAY;
    else base = Date.UTC(local.y, local.m - 2, s.day);
    occ = at(base);
  }
  return occ;
}

/** Most recent scheduled instant at or before `now`. */
export function lastOccurrence(schedule: string | Schedule, now: Date, tz: string): Date | null {
  const s = typeof schedule === "string" ? parseSchedule(schedule) : schedule;
  return s ? occurrenceOnOrBefore(s, now, tz) : null;
}

/** Next scheduled instant strictly after `now`. */
export function nextOccurrence(schedule: string | Schedule, now: Date, tz: string): Date | null {
  const s = typeof schedule === "string" ? parseSchedule(schedule) : schedule;
  if (!s) return null;
  const horizon = s.freq === "daily" ? 2 * DAY : s.freq === "weekly" ? 8 * DAY : 32 * DAY;
  const ahead = occurrenceOnOrBefore(s, new Date(now.getTime() + horizon), tz);
  // Walk back to the first occurrence after now.
  let cur = ahead;
  for (let i = 0; i < 3; i++) {
    const prev = occurrenceOnOrBefore(s, new Date(cur.getTime() - 60_000), tz);
    if (prev.getTime() <= now.getTime()) break;
    cur = prev;
  }
  return cur;
}

/**
 * Due when the latest occurrence is after both the last send and the report's creation
 * (a report created at 10:00 with a 09:00 daily schedule first goes out tomorrow).
 */
export function isDue(schedule: string | null | undefined, lastSentAt: Date | null, createdAt: Date, now: Date, tz: string): Date | null {
  const occ = lastOccurrence(schedule ?? "", now, tz);
  if (!occ) return null;
  if (occ.getTime() < createdAt.getTime()) return null;
  if (lastSentAt && lastSentAt.getTime() >= occ.getTime()) return null;
  return occ;
}

/**
 * Reporting period for a scheduled send (local calendar days, returned as UTC-midnight dates for @db.Date):
 * daily → yesterday; weekly → the 7 days ending yesterday; monthly → the previous calendar month.
 */
export function rollingPeriod(freq: Frequency, now: Date, tz: string): { start: Date; end: Date } {
  const local = zonedParts(now, tz);
  const today = localDate(local);
  if (freq === "daily") return { start: new Date(today - DAY), end: new Date(today - DAY) };
  if (freq === "weekly") return { start: new Date(today - 7 * DAY), end: new Date(today - DAY) };
  return { start: new Date(Date.UTC(local.y, local.m - 2, 1)), end: new Date(Date.UTC(local.y, local.m - 1, 0)) };
}
