import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cx, type Tone } from "./primitives";
import { fmtPct, type Locale } from "@/lib/format";

/**
 * KPI tile. `delta` is a ratio vs comparison period; `tone` decides colour
 * (a CPL increase is red, a ROAS increase is green — computed by metrics.trendTone()).
 */
export function KpiCard({
  label,
  value,
  delta,
  tone = "neutral",
  hint,
  locale,
  target,
  market,
  footer,
  estimate,
}: {
  label: string;
  value: string;
  delta?: number | null;
  tone?: "good" | "bad" | "neutral";
  hint?: string;
  locale: Locale;
  target?: { label: string; value: string; tone?: Tone };
  market?: { label: string; value: string; tone?: Tone };
  footer?: React.ReactNode;
  estimate?: string;
}) {
  const Icon = delta == null || Math.abs(delta) < 0.0005 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const toneCls = tone === "good" ? "text-good bg-good-soft" : tone === "bad" ? "text-bad bg-bad-soft" : "text-muted bg-surface-2";
  return (
    <div className="card flex min-w-0 flex-col gap-1 rounded-card border border-border bg-surface p-4 shadow-card" title={hint}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted">{label}</p>
        {estimate && <span className="rounded bg-warn-soft px-1.5 text-[10px] font-medium text-warn">{estimate}</span>}
      </div>
      <p className={cx("num font-bold tracking-tight break-words", value.length > 11 ? "text-lg" : "text-2xl")}>{value}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {delta !== undefined && (
          <span className={cx("num inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium", toneCls)}>
            <Icon className="size-3" aria-hidden />
            {delta == null ? "—" : fmtPct(Math.abs(delta), locale)}
          </span>
        )}
        {target && (
          <span className="text-subtle">
            {target.label}: <span className={cx("num", target.tone === "bad" ? "text-bad" : target.tone === "good" ? "text-good" : "text-muted")}>{target.value}</span>
          </span>
        )}
        {market && (
          <span className="text-subtle">
            {market.label}: <span className={cx("num", market.tone === "bad" ? "text-bad" : market.tone === "good" ? "text-good" : "text-muted")}>{market.value}</span>
          </span>
        )}
      </div>
      {footer}
    </div>
  );
}
