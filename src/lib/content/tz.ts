/**
 * Timezone helpers for the content calendar. Posts are stored in UTC and displayed / edited
 * in the client's IANA timezone (Client.timezone, e.g. "Africa/Cairo", "Asia/Dubai").
 * Pure Intl-based maths — safe on server and client, DST-aware.
 */

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `d` in `timeZone`. `weekday` is 0 = Sunday … 6 = Saturday. */
export function zonedParts(d: Date, timeZone: string): ZonedParts {
  const p: Record<string, string> = {};
  for (const x of formatterFor(timeZone).formatToParts(d)) p[x.type] = x.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of `d` as seen in `timeZone`. */
export function zonedDayKey(d: Date, timeZone: string) {
  const p = zonedParts(d, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:mm" of `d` as seen in `timeZone`. */
export function zonedTime(d: Date, timeZone: string) {
  const p = zonedParts(d, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Offset (ms) of `timeZone` from UTC at instant `d`. */
function offsetAt(d: Date, timeZone: string) {
  const p = zonedParts(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(d.getTime() / 60000) * 60000;
}

/**
 * Convert a wall-clock date + time in `timeZone` to the UTC instant.
 * `day` = "YYYY-MM-DD", `time` = "HH:mm". Handles DST by re-checking the offset.
 */
export function zonedToUtc(day: string, time: string, timeZone: string): Date {
  const [y, m, dd] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, dd, hh, mm);
  let ts = guess - offsetAt(new Date(guess), timeZone);
  const second = guess - offsetAt(new Date(ts), timeZone);
  if (second !== ts) ts = second;
  return new Date(ts);
}

/** Pure calendar arithmetic on "YYYY-MM-DD" keys (no timezone involved). */
export function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

export function addMonthsClamped(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const x = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  return x.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a "YYYY-MM-DD" key. */
export function weekdayOf(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isDayKey(s: string | undefined | null): s is string {
  return Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")));
}

/** Timezones offered in the editor — region-first, then the full IANA list when available. */
export const COMMON_TIMEZONES = [
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Muscat",
  "Asia/Amman",
  "Asia/Beirut",
  "Asia/Baghdad",
  "Africa/Casablanca",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "UTC",
];
