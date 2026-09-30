export type Locale = "ar" | "en";

/** Arabic UI with Latin digits — standard for marketing dashboards in the region. */
export function intlLocale(locale: Locale) {
  return locale === "ar" ? "ar-EG-u-nu-latn" : "en-US";
}

export function fmtNumber(n: number | null | undefined, locale: Locale = "en", digits = 0) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}

export function fmtCompact(n: number | null | undefined, locale: Locale = "en") {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(intlLocale(locale), { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtMoney(n: number | null | undefined, currency = "EGP", locale: Locale = "en", digits = 0) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

/** `n` is a ratio (0.0123 → 1.23%). */
export function fmtPct(n: number | null | undefined, locale: Locale = "en", digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: digits }).format(n);
}

export function fmtDate(d: Date | string | null | undefined, locale: Locale = "en", opts?: Intl.DateTimeFormatOptions) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(intlLocale(locale), opts ?? { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function fmtDateTime(d: Date | string | null | undefined, locale: Locale = "en", timeZone?: string) {
  return fmtDate(d, locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone });
}

/** Pass `now` from the server in client components to avoid hydration mismatches. */
export function fmtRelative(d: Date | string | null | undefined, locale: Locale = "en", now: Date = new Date()) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (date.getTime() - now.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

/** yyyy-mm-dd (UTC) for URL params and <input type="date">. */
export function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object" && "toNumber" in (v as object)) return (v as { toNumber(): number }).toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
