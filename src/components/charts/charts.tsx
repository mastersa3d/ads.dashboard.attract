"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n/client";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber, fmtPct } from "@/lib/format";

/** Fixed categorical order — colour follows the series, never its rank (docs/07-design-system.md). */
export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)"];

export type ValueFormat = "number" | "money" | "pct" | "compact" | "ratio";

export type Series = { key: string; label: string; color?: string; dashed?: boolean };

function useFormatter(format: ValueFormat, currency?: string) {
  const { locale } = useI18n();
  return (v: number) => {
    switch (format) {
      case "money":
        return fmtMoney(v, currency ?? "EGP", locale);
      case "pct":
        return fmtPct(v, locale);
      case "compact":
        return fmtCompact(v, locale);
      case "ratio":
        return fmtNumber(v, locale, 2) + "x";
      default:
        return fmtNumber(v, locale);
    }
  };
}

const axisProps = { stroke: "var(--subtle)", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" },
  labelStyle: { color: "var(--muted)", marginBottom: 4 },
  itemStyle: { color: "var(--text)", padding: 0 },
};

/** Line (or area) over time. One y-axis only — never dual axis. */
export function TimeSeriesChart({
  data,
  series,
  format = "number",
  currency,
  height = 260,
  area = false,
  referenceY,
  referenceLabel,
}: {
  data: Record<string, string | number | null>[];
  series: Series[];
  format?: ValueFormat;
  currency?: string;
  height?: number;
  area?: boolean;
  referenceY?: number;
  referenceLabel?: string;
}) {
  const { locale, t } = useI18n();
  const fmt = useFormatter(format, currency);
  const compact = useFormatter(format === "money" || format === "number" ? "compact" : format, currency);
  const Chart = area ? AreaChart : LineChart;
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">{t("ui.noData")}</p>;
  return (
    <div style={{ height }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={(d) => fmtDate(String(d), locale, { month: "short", day: "numeric" })} minTickGap={24} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => compact(Number(v))} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ stroke: "var(--subtle)", strokeDasharray: "3 3" }}
            labelFormatter={(d) => fmtDate(String(d), locale, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            formatter={(v, name) => [fmt(Number(v)), String(name)]}
          />
          {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />}
          {referenceY != null && <ReferenceLine y={referenceY} stroke="var(--warn)" strokeDasharray="4 4" label={{ value: referenceLabel, fill: "var(--warn)", fontSize: 11, position: "insideTopRight" }} />}
          {series.map((s, i) =>
            area ? (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color ?? SERIES_COLORS[i]}
                fill={s.color ?? SERIES_COLORS[i]}
                fillOpacity={0.12}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
              />
            ) : (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color ?? SERIES_COLORS[i]}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={false}
                connectNulls
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
              />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars for ranking categories (platforms, campaigns). */
export function RankBarChart({
  data,
  valueKey,
  labelKey = "label",
  format = "number",
  currency,
  height,
  colorByIndex = false,
}: {
  data: Record<string, string | number>[];
  valueKey: string;
  labelKey?: string;
  format?: ValueFormat;
  currency?: string;
  height?: number;
  colorByIndex?: boolean;
}) {
  const { t } = useI18n();
  const fmt = useFormatter(format, currency);
  const compact = useFormatter(format === "money" || format === "number" ? "compact" : format, currency);
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">{t("ui.noData")}</p>;
  const h = height ?? Math.max(120, data.length * 34 + 30);
  return (
    <div style={{ height: h }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }} barCategoryGap={6}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" {...axisProps} tickFormatter={(v) => compact(Number(v))} />
          <YAxis type="category" dataKey={labelKey} {...axisProps} width={120} tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface-2)" }} formatter={(v) => [fmt(Number(v))]} />
          <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} maxBarSize={22}>
            {data.map((_, i) => (
              <Cell key={i} fill={colorByIndex ? SERIES_COLORS[i % SERIES_COLORS.length] : SERIES_COLORS[0]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Grouped vertical bars — e.g. planned vs actual per platform. */
export function GroupedBarChart({
  data,
  series,
  labelKey = "label",
  format = "number",
  currency,
  height = 260,
}: {
  data: Record<string, string | number>[];
  series: Series[];
  labelKey?: string;
  format?: ValueFormat;
  currency?: string;
  height?: number;
}) {
  const { t } = useI18n();
  const fmt = useFormatter(format, currency);
  const compact = useFormatter(format === "money" || format === "number" ? "compact" : format, currency);
  if (!data.length) return <p className="py-10 text-center text-sm text-muted">{t("ui.noData")}</p>;
  return (
    <div style={{ height }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={labelKey} {...axisProps} interval={0} tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => compact(Number(v))} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface-2)" }} formatter={(v, name) => [fmt(Number(v)), String(name)]} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? SERIES_COLORS[i]} radius={[4, 4, 0, 0]} maxBarSize={28} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Share-of-total donut. Keep to ≤ 6 slices; fold the rest into "Other" before passing. */
export function DonutChart({ data, format = "number", currency, height = 220 }: { data: { label: string; value: number }[]; format?: ValueFormat; currency?: string; height?: number }) {
  const { t } = useI18n();
  const fmt = useFormatter(format, currency);
  if (!data.length || data.every((d) => !d.value)) return <p className="py-10 text-center text-sm text-muted">{t("ui.noData")}</p>;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <div style={{ height, width: height }} className="shrink-0" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="95%" paddingAngle={1} stroke="var(--surface)" strokeWidth={2}>
              {data.map((_, i) => (
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(v, name) => [fmt(Number(v)), String(name)]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-muted">{d.label}</span>
            <span className="num font-medium">{fmt(d.value)}</span>
            <span className="num w-12 text-end text-xs text-subtle">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
