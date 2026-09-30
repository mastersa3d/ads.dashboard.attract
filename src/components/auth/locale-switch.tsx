"use client";

import { Languages } from "lucide-react";
import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { setLocale } from "@/app/actions/preferences";

export function LocaleSwitch() {
  const { locale } = useI18n();
  const [, start] = useTransition();
  return (
    <button className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2" onClick={() => start(() => setLocale(locale === "ar" ? "en" : "ar"))}>
      <Languages className="size-4" /> {locale === "ar" ? "English" : "العربية"}
    </button>
  );
}
