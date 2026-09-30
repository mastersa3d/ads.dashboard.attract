import { ExternalLink, Lightbulb } from "lucide-react";
import { Badge, cx, EstimateBadge, type Tone } from "@/components/ui/primitives";
import type { Rating } from "./model";

export type BenchmarkCardData = {
  metric: string;
  label: string;
  definition: string;
  higherIsBetter: boolean;
  /** Numeric values in display units (already currency-converted). */
  value: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  fmt: (n: number | null) => string;
  diff: { abs: string; pct: string; tone: Tone } | null;
  percentile: number | null;
  rating: Rating;
  recommendation: string;
  bench: { source: string; sourceUrl: string | null; asOf: string; sampleSize: string | null; period: string | null; scope: string; estimate: boolean; manual: boolean; match: string } | null;
};

const RATING_TONE: Record<Rating, Tone> = { good: "good", average: "warning", bad: "bad", none: "neutral" };

type Labels = {
  yours: string;
  median: string;
  range: string;
  difference: string;
  percentile: string;
  percentileHint: string;
  rating: Record<Rating, string>;
  source: string;
  asOf: string;
  sample: string;
  period: string;
  estimate: string;
  estimateHint: string;
  manual: string;
  noBenchmark: string;
  noValue: string;
  higher: string;
  lower: string;
  matched: string;
};

/** Where a value sits on a P25–P75 track (with margin), as a 0..100 position. */
function position(v: number, lo: number, hi: number) {
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100));
}

export function BenchmarkCard({ d, labels }: { d: BenchmarkCardData; labels: Labels }) {
  const hasRange = d.p25 != null && d.p75 != null && d.median != null;
  let track: { lo: number; hi: number } | null = null;
  if (hasRange) {
    const vals = [d.p25!, d.p75!, ...(d.value != null ? [d.value] : [])];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.15 || Math.abs(max) * 0.1 || 1;
    track = { lo: min - pad, hi: max + pad };
  }
  return (
    <article className="card flex flex-col rounded-card border border-border bg-surface shadow-card">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{d.label}</h3>
          <p className="mt-0.5 text-[11px] text-subtle">
            {d.definition} · {d.higherIsBetter ? labels.higher : labels.lower}
          </p>
        </div>
        <Badge tone={RATING_TONE[d.rating]}>{labels.rating[d.rating]}</Badge>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-muted">{labels.yours}</dt>
            <dd className="num mt-0.5 text-xl font-bold">{d.value == null ? "—" : d.fmt(d.value)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{labels.median}</dt>
            <dd className="num mt-0.5 text-xl font-semibold text-muted">{d.median == null ? "—" : d.fmt(d.median)}</dd>
          </div>
        </dl>

        {track && (
          <div aria-hidden className="pt-1">
            <div className="relative h-2 rounded-full bg-surface-2">
              <div
                className="absolute inset-y-0 rounded-full bg-info-soft"
                style={{ insetInlineStart: `${position(d.p25!, track.lo, track.hi)}%`, width: `${position(d.p75!, track.lo, track.hi) - position(d.p25!, track.lo, track.hi)}%` }}
              />
              <div className="absolute inset-y-[-3px] w-0.5 bg-muted" style={{ insetInlineStart: `${position(d.median!, track.lo, track.hi)}%` }} />
              {d.value != null && (
                <div
                  className={cx("absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-surface rtl:translate-x-1/2 ltr:-translate-x-1/2", d.rating === "good" ? "bg-good" : d.rating === "bad" ? "bg-bad" : "bg-warn")}
                  style={{ insetInlineStart: `${position(d.value, track.lo, track.hi)}%` }}
                />
              )}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-subtle">
              <span className="num">P25 {d.fmt(d.p25)}</span>
              <span className="num">P75 {d.fmt(d.p75)}</span>
            </div>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">{labels.difference}</dt>
          <dd className="num text-end">{d.diff ? <span className={d.diff.tone === "good" ? "text-good" : d.diff.tone === "bad" ? "text-bad" : "text-muted"}>{d.diff.abs} ({d.diff.pct})</span> : "—"}</dd>
          <dt className="text-muted" title={labels.percentileHint}>
            {labels.percentile}
          </dt>
          <dd className="num text-end" title={labels.percentileHint}>
            {d.percentile == null ? "—" : `P${d.percentile}`}
          </dd>
          {!hasRange && d.median != null && (
            <>
              <dt className="text-muted">{labels.range}</dt>
              <dd className="text-end text-subtle">—</dd>
            </>
          )}
        </dl>

        <p className="flex gap-2 rounded-lg bg-surface-2 p-2.5 text-xs leading-relaxed">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
          <span>{d.value == null ? labels.noValue : d.recommendation}</span>
        </p>
      </div>

      <footer className="space-y-1 border-t border-border px-4 py-2.5 text-[11px] text-subtle">
        {d.bench ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {d.bench.estimate && <EstimateBadge label={labels.estimate} hint={labels.estimateHint} />}
              {d.bench.manual && <Badge tone="brand">{labels.manual}</Badge>}
              <span className="text-muted">{d.bench.scope}</span>
            </div>
            <p>
              {labels.source}:{" "}
              {d.bench.sourceUrl ? (
                <a href={d.bench.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                  {d.bench.source} <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : (
                <span className="text-muted">{d.bench.source}</span>
              )}
            </p>
            <p>
              {labels.asOf}: <span className="text-muted">{d.bench.asOf}</span>
              {d.bench.period && (
                <>
                  {" "}· {labels.period}: <span className="text-muted">{d.bench.period}</span>
                </>
              )}
              {d.bench.sampleSize && (
                <>
                  {" "}· {labels.sample}: <span className="num text-muted">{d.bench.sampleSize}</span>
                </>
              )}
            </p>
            <p>
              {labels.matched}: <span className="text-muted">{d.bench.match}</span>
            </p>
          </>
        ) : (
          <p>{labels.noBenchmark}</p>
        )}
      </footer>
    </article>
  );
}
