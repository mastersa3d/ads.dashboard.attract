"use client";

import { Info } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmtNumber, fmtPct } from "@/lib/format";
import { Badge, EstimateBadge, Progress } from "@/components/ui/primitives";
import { INTENSITY_CAPS, INTENSITY_WEIGHTS, type Intensity } from "@/lib/competitors/intensity";

/** Plain-text formula — used as the native tooltip and repeated in the expandable explanation. */
export function useIntensityFormula() {
  const { t } = useI18n();
  const W = INTENSITY_WEIGHTS;
  const C = INTENSITY_CAPS;
  return t("competitors.intensity.formula", {
    wa: W.active,
    ca: C.active,
    wd: W.duration,
    cd: C.durationDays,
    wv: W.variants,
    cv: C.variants,
    wr: W.relaunch,
    wn: W.recency,
    cn: C.recentNew,
  });
}

/** "Estimated Advertising Intensity" — a 0–100 index, never money. */
export function IntensityMeter({ intensity, compact = false }: { intensity: Intensity | null; compact?: boolean }) {
  const { t, locale } = useI18n();
  const formula = useIntensityFormula();
  if (!intensity) return <p className="text-xs text-subtle">{t("competitors.intensity.noAds")}</p>;
  const tone = intensity.level === "HIGH" ? "bad" : intensity.level === "MEDIUM" ? "warning" : "good";
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted" title={formula}>
          {t("competitors.intensity.label")}
        </span>
        <span className="num text-sm font-semibold">
          {intensity.score}
          <span className="text-subtle">/100</span>
        </span>
        <Badge tone={tone}>{t(`competitors.intensity.level.${intensity.level}`)}</Badge>
        {!compact && <EstimateBadge label={t("ui.estimate")} hint={formula} />}
      </div>
      <Progress value={intensity.score / 100} tone={tone} label={t("competitors.intensity.label")} />
      {!compact && (
        <details className="group text-xs text-muted">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-brand hover:underline">
            <Info className="size-3.5" aria-hidden /> {t("competitors.intensity.how")}
          </summary>
          <div className="mt-2 space-y-2 rounded-lg bg-surface-2 p-3">
            <p>{formula}</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              <li>
                {t("competitors.intensity.part.active")}: <span className="num">{fmtNumber(intensity.inputs.active, locale)}</span> →{" "}
                <span className="num">{fmtNumber(intensity.parts.active, locale, 1)}</span>
              </li>
              <li>
                {t("competitors.intensity.part.duration")}: <span className="num">{fmtNumber(intensity.inputs.avgRunningDays, locale)}</span> →{" "}
                <span className="num">{fmtNumber(intensity.parts.duration, locale, 1)}</span>
              </li>
              <li>
                {t("competitors.intensity.part.variants")}: <span className="num">{fmtNumber(intensity.inputs.activeVariants, locale)}</span> →{" "}
                <span className="num">{fmtNumber(intensity.parts.variants, locale, 1)}</span>
              </li>
              <li>
                {t("competitors.intensity.part.relaunch")}: <span className="num">{fmtPct(intensity.inputs.relaunchShare, locale, 0)}</span> →{" "}
                <span className="num">{fmtNumber(intensity.parts.relaunch, locale, 1)}</span>
              </li>
              <li>
                {t("competitors.intensity.part.recency")}: <span className="num">{fmtNumber(intensity.inputs.newAds, locale)}</span> →{" "}
                <span className="num">{fmtNumber(intensity.parts.recency, locale, 1)}</span>
              </li>
            </ul>
            <p className="text-subtle">{t("competitors.intensity.disclaimer")}</p>
          </div>
        </details>
      )}
    </div>
  );
}
