import type { TFunction } from "@/lib/i18n/translate";
import { intlLocale, type Locale } from "@/lib/format";

export const DIMENSIONS = ["platform", "device", "placement", "gender", "ageRange", "country"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export function parseDimension(v: unknown): Dimension {
  return DIMENSIONS.includes(v as Dimension) ? (v as Dimension) : "platform";
}

/** Human label for a breakdown value: platform enum, known device/placement/gender values, ISO country names. */
export function dimensionValueLabel(dim: Dimension, value: string | null, t: TFunction, locale: Locale): string {
  if (!value) return t("analytics.dim_unknown");
  if (dim === "platform") return t(`platform.${value}`);
  if (dim === "country") {
    try {
      return new Intl.DisplayNames([intlLocale(locale)], { type: "region" }).of(value.toUpperCase()) ?? value;
    } catch {
      return value;
    }
  }
  if (dim === "ageRange") return value;
  const key = `analytics.val_${value.toLowerCase()}`;
  const label = t(key);
  return label === key ? value : label;
}
