"use client";

import { CartesianGrid, Legend, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { useI18n } from "@/lib/i18n/client";
import { SERIES_COLORS } from "@/components/charts/charts";
import { fmtNumber, type Locale } from "@/lib/format";

type Point = { id: string; title: string; ease: number; impact: number; source: "COMPETITOR" | "TREND" | "ORIGINAL" };
const SOURCES = ["COMPETITOR", "TREND", "ORIGINAL"] as const;

/** Deterministic jitter so ideas sharing a cell stay visible and don't move between renders. */
function jitter(id: string, axis: number) {
  let h = axis * 7919;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000 - 0.5) * 0.4;
}

export function quadrant(p: { ease: number; impact: number }) {
  return p.impact >= 3.5 ? (p.ease >= 3.5 ? "quickWins" : "bigBets") : p.ease >= 3.5 ? "fillIns" : "deprioritize";
}

/** Ease × Impact 2×2 — upper-right = quick wins. One point per idea, coloured by idea source. */
export function EaseImpactMatrix({ ideas, height = 320 }: { ideas: Point[]; height?: number }) {
  const { t, locale } = useI18n();
  const counts = { quickWins: 0, bigBets: 0, fillIns: 0, deprioritize: 0 };
  for (const i of ideas) counts[quadrant(i)]++;
  if (!ideas.length) return <p className="py-10 text-center text-sm text-muted">{t("ui.noData")}</p>;
  return (
    <div className="space-y-3">
      <div style={{ height }} dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, bottom: 18, left: 0 }}>
            <ReferenceArea x1={3.5} x2={5.5} y1={3.5} y2={5.5} fill="var(--good)" fillOpacity={0.06} />
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0.5, 5.5]}
              ticks={[1, 2, 3, 4, 5]}
              stroke="var(--subtle)"
              fontSize={11}
              tickLine={false}
              label={{ value: t("trends.idea.ease") + " →", position: "insideBottom", offset: -8, fill: "var(--muted)", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0.5, 5.5]}
              ticks={[1, 2, 3, 4, 5]}
              stroke="var(--subtle)"
              fontSize={11}
              tickLine={false}
              width={40}
              label={{ value: t("trends.idea.impact") + " →", angle: -90, position: "insideLeft", fill: "var(--muted)", fontSize: 11 }}
            />
            <ZAxis range={[60, 60]} />
            <ReferenceLine x={3.5} stroke="var(--subtle)" />
            <ReferenceLine y={3.5} stroke="var(--subtle)" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as (Point & { x: number; y: number }) | undefined;
                if (!p) return null;
                return (
                  <div className="max-w-60 rounded-lg border border-border bg-surface p-2 text-xs shadow" dir={locale === "ar" ? "rtl" : "ltr"}>
                    <p className="font-medium">{p.title}</p>
                    <p className="num text-muted">
                      {t("trends.idea.ease")} {p.ease}/5 · {t("trends.idea.impact")} {p.impact}/5
                    </p>
                  </div>
                );
              }}
            />
            <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
            {SOURCES.map((s, i) => (
              <Scatter
                key={s}
                name={t(`trends.source.${s}`)}
                fill={SERIES_COLORS[i]}
                fillOpacity={0.85}
                data={ideas.filter((d) => d.source === s).map((d) => ({ ...d, x: d.ease + jitter(d.id, 1), y: d.impact + jitter(d.id, 2) }))}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {(["quickWins", "bigBets", "fillIns", "deprioritize"] as const).map((q) => (
          <li key={q} className="rounded-lg border border-border p-2">
            <p className="font-medium">{t(`trends.matrix.${q}`)}</p>
            <p className="text-subtle">{t(`trends.matrix.${q}Hint`)}</p>
            <p className="num mt-1 text-base font-semibold">{fmtNumber(counts[q], locale as Locale)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
