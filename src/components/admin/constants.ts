import type { AlertSeverity } from "@prisma/client";
import type { Tone } from "@/components/ui/primitives";

/** Alert types raised by the worker (see Notification.type in prisma/schema.prisma). */
export const NOTIFICATION_TYPES = [
  "SPEND_OVER",
  "SPEND_UNDER",
  "CPL_UP",
  "ROAS_DOWN",
  "FREQUENCY",
  "BUDGET_ENDING",
  "SYNC_STOPPED",
  "TOKEN_EXPIRING",
  "PERMISSION_MISSING",
  "CONTENT_DUE",
  "CONTENT_REJECTED",
  "COMPETITOR_AD",
  "TREND",
  "REALLOCATION",
] as const;

/** Types whose alert fires past a numeric threshold (percent variance or frequency value). */
export const THRESHOLD_TYPES: readonly string[] = ["SPEND_OVER", "SPEND_UNDER", "CPL_UP", "ROAS_DOWN", "FREQUENCY", "BUDGET_ENDING"];

export const SEVERITY_TONE: Record<AlertSeverity, Tone> = { SUCCESS: "good", INFO: "info", WARNING: "warning", CRITICAL: "bad" };

export const CURRENCIES = ["EGP", "AED", "SAR", "USD", "EUR", "GBP", "KWD", "QAR", "BHD", "OMR", "JOD", "MAD", "TRY"];

/** ISO-3166 alpha-2 codes offered in country pickers (labels come from Intl.DisplayNames). */
export const COUNTRIES = ["EG", "AE", "SA", "KW", "QA", "BH", "OM", "JO", "LB", "IQ", "MA", "TN", "DZ", "LY", "SD", "TR", "GB", "US", "DE", "FR"];

export const LOCALES = ["ar", "en"] as const;

export function countryName(code: string | null | undefined, locale: string) {
  if (!code) return "—";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function timezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["Africa/Cairo", "Asia/Dubai", "Asia/Riyadh", "Asia/Kuwait", "Asia/Qatar", "Europe/London", "UTC"];
  }
}

export function isTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
