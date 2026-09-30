import { Clock, Sparkles } from "lucide-react";
import type { BestTimeResult } from "@/lib/content/best-time";
import { clockLabel, weekdayName } from "@/lib/content/tz";
import { fmtNumber, fmtPct, type Locale } from "@/lib/format";
import { Badge, cx, EstimateBadge, Progress } from "@/components/ui/primitives";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Presentational Best-Time-to-Post summary. No hooks and no directive, so it renders both in
 * the server-side calendar sidebar and inside the client-side editor drawer.
 */
export function BestTimeView({ result: r, t, locale, compact = false, action }: { result: BestTimeResult; t: T; locale: Locale; compact?: boolean; action?: React.ReactNode }) {
  const estimated = r.method === "benchmark";
  const day = (w: number) => weekdayName(w, locale);
  const scopeLabel = r.basis === "platform" && r.platform ? t(`platform.${r.platform}`) : t("content.bt.allPlatforms");
  const confTone = r.confidenceLevel === "high" ? "good" : r.confidenceLevel === "medium" ? "warning" : "bad";

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">{t("content.bt.suggested")}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-base font-semibold">
            <Clock className="size-4 text-brand" aria-hidden />
            {day(r.weekday)} · <span className="num">{clockLabel(r.hour, locale)}</span>
          </p>
          <p className="text-[11px] text-subtle">{t("content.bt.timezoneNote", { tz: r.timezone })}</p>
        </div>
        {estimated ? (
          <EstimateBadge label={t("content.bt.estimatedBadge")} hint={t("content.bt.estimatedHint")} />
        ) : (
          <Badge tone="good">
            <Sparkles className="size-3" aria-hidden /> {t("content.bt.fromData")}
          </Badge>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-muted">{t("ui.confidence")}</span>
          <span className="num font-medium">
            {r.confidence}/100 · {t(`content.bt.level.${r.confidenceLevel}`)}
          </span>
        </div>
        <Progress value={r.confidence / 100} tone={confTone} label={t("ui.confidence")} />
      </div>

      <p className="text-xs leading-relaxed text-muted">
        {estimated
          ? t("content.bt.reasonBenchmark", { n: r.sampleSize, min: r.minSample, platform: r.platform ? t(`platform.${r.platform}`) : t("content.bt.allPlatforms") })
          : t("content.bt.reasonHistory", { n: r.sampleSize, scope: scopeLabel, lift: fmtPct(r.lift ?? 0, locale), rate: fmtPct(r.avgRate ?? 0, locale, 2) })}
        {r.organic && (
          <>
            {" "}
            {t("content.bt.organic", { day: day(r.organic.weekday), lift: fmtPct(r.organic.lift, locale), days: r.organic.days })}
          </>
        )}
      </p>

      {r.chosen && (
        <div
          className={cx(
            "rounded-lg px-3 py-2 text-xs",
            r.chosen.verdict === "best" || r.chosen.verdict === "matches" ? "bg-good-soft text-good" : r.chosen.verdict === "good" ? "bg-info-soft text-info" : r.chosen.verdict === "unknown" ? "bg-surface-2 text-muted" : "bg-warn-soft text-warn",
          )}
        >
          {t(`content.bt.chosen.${r.chosen.verdict}`, {
            slot: `${day(r.chosen.weekday)} ${clockLabel(r.chosen.hour, locale)}`,
            rel: r.chosen.relative == null ? "—" : fmtPct(Math.abs(r.chosen.relative), locale),
          })}
        </div>
      )}

      {r.alternatives.length > 0 && (
        <div>
          <p className="text-xs text-muted">{t("content.bt.alternatives")}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {r.alternatives.map((a) => (
              <li key={`${a.weekday}-${a.hour}`}>
                <Badge tone="neutral">
                  {day(a.weekday)} · <span className="num">{clockLabel(a.hour, locale)}</span>
                  {a.lift != null && <span className="num text-subtle">({a.lift >= 0 ? "+" : "−"}{fmtPct(Math.abs(a.lift), locale)})</span>}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && r.heatmap && <Heatmap result={r} locale={locale} t={t} />}
      {action}
      <p className="text-[11px] text-subtle">{t("content.bt.advisory")}</p>
    </div>
  );
}

function Heatmap({ result: r, locale, t }: { result: BestTimeResult; locale: Locale; t: T }) {
  const cells = r.heatmap ?? [];
  const rates = cells.map((c) => c.rate).filter((x): x is number => x != null);
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const blocks = 24 / r.blockHours;
  return (
    <figure>
      <figcaption className="mb-1 text-xs text-muted">{t("content.bt.heatmap")}</figcaption>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-[10px]">
          <thead>
            <tr>
              <th />
              {Array.from({ length: blocks }, (_, b) => (
                <th key={b} className="num font-normal text-subtle">
                  {fmtNumber(b * r.blockHours, locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 7 }, (_, w) => (
              <tr key={w}>
                <th className="pe-1 text-start font-normal whitespace-nowrap text-muted">{weekdayName(w, locale, "short")}</th>
                {Array.from({ length: blocks }, (_, b) => {
                  const c = cells.find((x) => x.weekday === w && x.block === b);
                  const k = c?.rate == null || hi === lo ? 0 : (c.rate - lo) / (hi - lo);
                  const best = w === r.weekday && Math.floor(r.hour / r.blockHours) === b;
                  return (
                    <td
                      key={b}
                      title={c?.rate == null ? "—" : `${weekdayName(w, locale)} ${clockLabel(b * r.blockHours, locale)} · ${fmtPct(c.rate, locale, 2)} · n=${c.n}`}
                      className={cx("h-4 min-w-4 rounded-sm", c?.rate == null && "bg-surface-2", best && "ring-2 ring-brand")}
                      style={c?.rate == null ? undefined : { backgroundColor: `color-mix(in oklab, var(--brand) ${Math.round(15 + k * 75)}%, transparent)` }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-subtle">{t("content.bt.heatmapHint", { hours: r.blockHours })}</p>
    </figure>
  );
}
