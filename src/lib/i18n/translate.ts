import type { Locale } from "@/lib/format";
import { MESSAGES } from "./messages";

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

/** Lookup order: requested locale → English → the key itself (so missing keys are visible, never blank). */
export function makeT(locale: Locale): TFunction {
  const dict = MESSAGES[locale];
  const fallback = MESSAGES.en;
  return (key, vars) => {
    let s = dict[key] ?? fallback[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export function dirOf(locale: Locale) {
  return locale === "ar" ? "rtl" : "ltr";
}
