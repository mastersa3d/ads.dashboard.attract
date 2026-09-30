import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Locale } from "@/lib/format";
import { makeT } from "./translate";

export const LOCALE_COOKIE = "locale";

export const getLocale = cache(async (): Promise<Locale> => {
  const jar = await cookies();
  const v = jar.get(LOCALE_COOKIE)?.value;
  if (v === "en" || v === "ar") return v;
  return (process.env.DEFAULT_LOCALE as Locale) === "en" ? "en" : "ar";
});

/** Server components: `const { t, locale } = await getI18n();` */
export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: makeT(locale) };
}
