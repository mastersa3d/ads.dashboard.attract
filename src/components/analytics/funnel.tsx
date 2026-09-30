import { fmtCompact, fmtNumber, fmtPct, type Locale } from "@/lib/format";

export type FunnelStep = { key: string; label: string; value: number; rateLabel?: string; rate?: number | null };

/**
 * Horizontal funnel: bar length is the step's share of the first step (log-scaled so small
 * conversion counts stay visible), with the step-to-step conversion rate between rows.
 */
export function FunnelView({ steps, locale, overallLabel }: { steps: FunnelStep[]; locale: Locale; overallLabel: string }) {
  const top = steps[0]?.value ?? 0;
  const width = (v: number) => (top > 0 && v > 0 ? Math.max(4, (Math.log10(v + 1) / Math.log10(top + 1)) * 100) : 0);
  const last = steps.at(-1);
  return (
    <div className="space-y-1">
      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={s.key}>
            {i > 0 && s.rateLabel && (
              <p className="flex items-center gap-1.5 py-1 ps-2 text-[11px] text-subtle">
                <span aria-hidden>↓</span>
                {s.rateLabel}: <span className="num font-medium text-muted">{fmtPct(s.rate, locale, 2)}</span>
              </p>
            )}
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-xs text-muted sm:w-28">{s.label}</span>
              <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-surface-2">
                <div
                  className="h-full rounded-md opacity-85"
                  style={{ width: `${width(s.value)}%`, background: `var(--chart-${(i % 7) + 1})` }}
                  aria-hidden
                />
              </div>
              <span className="num w-16 shrink-0 text-end text-sm font-semibold" title={fmtNumber(s.value, locale)}>
                {fmtCompact(s.value, locale)}
              </span>
            </div>
          </li>
        ))}
      </ol>
      {last && top > 0 && (
        <p className="pt-2 text-xs text-muted">
          {overallLabel}: <span className="num font-medium text-text">{fmtPct(last.value / top, locale, 3)}</span>
        </p>
      )}
    </div>
  );
}
