"use client";

import { createContext, useContext, useMemo } from "react";
import type { Locale } from "@/lib/format";
import { makeT, type TFunction } from "./translate";

const I18nContext = createContext<{ locale: Locale; t: TFunction }>({ locale: "ar", t: makeT("ar") });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Client components: `const { t, locale } = useI18n();` */
export function useI18n() {
  return useContext(I18nContext);
}
