"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmtDate, fmtNumber } from "@/lib/format";
import { Badge, Button, Callout, cx, EmptyState, EstimateBadge, Field, Input, Select } from "@/components/ui/primitives";
import { createBenchmark, deleteBenchmark, updateBenchmark, type BenchmarkActionResult } from "@/app/actions/benchmarks";
import { BENCHMARK_METRICS, METRIC_DEFS, type BenchmarkMetric } from "./model";

/** A company benchmark as sent to the browser — numbers already in entry units (percent metrics × 100). */
export type ManualBenchmark = {
  id: string;
  metric: BenchmarkMetric;
  platform: string | null;
  country: string | null;
  industry: string | null;
  businessSize: string | null;
  productType: string | null;
  isB2B: boolean | null;
  objective: string | null;
  audienceType: string | null;
  p25: number | null;
  median: number;
  p75: number | null;
  higherIsBetter: boolean;
  sourceName: string;
  sourceUrl: string | null;
  sampleSize: number | null;
  periodLabel: string | null;
  asOf: string;
  isEstimate: boolean;
};

type Draft = Omit<ManualBenchmark, "id" | "p25" | "median" | "p75" | "sampleSize"> & { p25: string; median: string; p75: string; sampleSize: string };

const emptyDraft = (): Draft => ({
  metric: "CPL",
  platform: "META",
  country: "",
  industry: "",
  businessSize: "",
  productType: "",
  isB2B: null,
  objective: null,
  audienceType: "",
  p25: "",
  median: "",
  p75: "",
  higherIsBetter: METRIC_DEFS.CPL.higherIsBetter,
  sourceName: "",
  sourceUrl: "",
  sampleSize: "",
  periodLabel: "",
  asOf: new Date().toISOString().slice(0, 10),
  isEstimate: false,
});

const toDraft = (b: ManualBenchmark): Draft => ({
  ...b,
  p25: b.p25 == null ? "" : String(b.p25),
  median: String(b.median),
  p75: b.p75 == null ? "" : String(b.p75),
  sampleSize: b.sampleSize == null ? "" : String(b.sampleSize),
  asOf: b.asOf.slice(0, 10),
});

export function ManualBenchmarks({
  rows,
  canEdit,
  platforms,
  objectives,
  orgCurrency,
}: {
  rows: ManualBenchmark[];
  canEdit: boolean;
  platforms: string[];
  objectives: string[];
  orgCurrency: string;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [result, setResult] = useState<BenchmarkActionResult | null>(null);
  const [pending, start] = useTransition();

  const unitHint = (m: BenchmarkMetric) => {
    const u = METRIC_DEFS[m].unit;
    return u === "pct" ? t("benchmarks.unitPct") : u === "money" ? t("benchmarks.unitMoney", { currency: orgCurrency }) : u === "perMoney" ? t("benchmarks.unitPerMoney", { currency: orgCurrency }) : t("benchmarks.unitRatio");
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const bad = (k: string) => (result && !result.ok && result.fields?.includes(k) ? t("benchmarks.invalidField") : undefined);

  function open(id: string | "new") {
    setResult(null);
    setDraft(id === "new" ? emptyDraft() : toDraft(rows.find((r) => r.id === id)!));
    setEditing(id);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      ...draft,
      platform: draft.platform || null,
      objective: draft.objective || null,
      p25: draft.p25 === "" ? null : Number(draft.p25),
      median: draft.median === "" ? null : Number(draft.median),
      p75: draft.p75 === "" ? null : Number(draft.p75),
      sampleSize: draft.sampleSize === "" ? null : Number(draft.sampleSize),
    };
    start(async () => {
      const r = editing && editing !== "new" ? await updateBenchmark(editing, payload) : await createBenchmark(payload);
      setResult(r);
      if (r.ok) setEditing(null);
    });
  }

  function remove(id: string) {
    if (!window.confirm(t("benchmarks.confirmDelete"))) return;
    start(async () => setResult(await deleteBenchmark(id)));
  }

  const b2bValue = draft.isB2B == null ? "" : draft.isB2B ? "b2b" : "b2c";

  return (
    <div className="space-y-4">
      {result && !result.ok && <Callout tone="bad">{t(`benchmarks.error_${result.error}`)}</Callout>}
      {result?.ok && !editing && <Callout tone="good">{t("ui.saved")}</Callout>}

      {canEdit && editing === null && (
        <Button variant="primary" size="sm" onClick={() => open("new")}>
          <Plus className="size-4" aria-hidden /> {t("benchmarks.addManual")}
        </Button>
      )}

      {canEdit && editing !== null && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-surface-2/50 p-4" aria-label={t("benchmarks.addManual")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("benchmarks.metric")} htmlFor="bm-metric">
              <Select
                id="bm-metric"
                value={draft.metric}
                onChange={(e) => {
                  const m = e.target.value as BenchmarkMetric;
                  setDraft((d) => ({ ...d, metric: m, higherIsBetter: METRIC_DEFS[m].higherIsBetter }));
                }}
                options={BENCHMARK_METRICS.map((m) => ({ value: m, label: t(`benchmarks.m_${m}`) }))}
              />
            </Field>
            <Field label={t("filter.platform")} htmlFor="bm-platform">
              <Select id="bm-platform" value={draft.platform ?? ""} onChange={(e) => set("platform", e.target.value || null)} placeholder={t("benchmarks.any")} options={platforms.map((p) => ({ value: p, label: t(`platform.${p}`) }))} />
            </Field>
            <Field label={t("filter.country")} htmlFor="bm-country" hint={t("benchmarks.countryHint")} error={bad("country")}>
              <Input id="bm-country" value={draft.country ?? ""} maxLength={2} onChange={(e) => set("country", e.target.value.toUpperCase())} placeholder="EG" />
            </Field>
            <Field label={t("benchmarks.industry")} htmlFor="bm-industry">
              <Input id="bm-industry" value={draft.industry ?? ""} maxLength={120} onChange={(e) => set("industry", e.target.value)} />
            </Field>
            <Field label={t("benchmarks.businessSize")} htmlFor="bm-size">
              <Input id="bm-size" value={draft.businessSize ?? ""} maxLength={60} onChange={(e) => set("businessSize", e.target.value)} placeholder={t("benchmarks.sizePlaceholder")} />
            </Field>
            <Field label={t("benchmarks.productType")} htmlFor="bm-ptype">
              <Input id="bm-ptype" value={draft.productType ?? ""} maxLength={120} onChange={(e) => set("productType", e.target.value)} />
            </Field>
            <Field label={t("benchmarks.b2b")} htmlFor="bm-b2b">
              <Select
                id="bm-b2b"
                value={b2bValue}
                onChange={(e) => set("isB2B", e.target.value === "" ? null : e.target.value === "b2b")}
                placeholder={t("benchmarks.any")}
                options={[
                  { value: "b2b", label: "B2B" },
                  { value: "b2c", label: "B2C" },
                ]}
              />
            </Field>
            <Field label={t("filter.objective")} htmlFor="bm-objective">
              <Select id="bm-objective" value={draft.objective ?? ""} onChange={(e) => set("objective", e.target.value || null)} placeholder={t("benchmarks.any")} options={objectives.map((o) => ({ value: o, label: t(`objective.${o}`) }))} />
            </Field>
            <Field label={t("benchmarks.audienceType")} htmlFor="bm-atype">
              <Input id="bm-atype" value={draft.audienceType ?? ""} maxLength={120} onChange={(e) => set("audienceType", e.target.value)} placeholder={t("benchmarks.audiencePlaceholder")} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Field label="P25" htmlFor="bm-p25" hint={unitHint(draft.metric)} error={bad("p25")}>
              <Input id="bm-p25" type="number" inputMode="decimal" step="any" min={0} value={draft.p25} onChange={(e) => set("p25", e.target.value)} />
            </Field>
            <Field label={`${t("benchmarks.median")} *`} htmlFor="bm-median" hint={unitHint(draft.metric)} error={bad("median")}>
              <Input id="bm-median" type="number" inputMode="decimal" step="any" min={0} required value={draft.median} onChange={(e) => set("median", e.target.value)} />
            </Field>
            <Field label="P75" htmlFor="bm-p75" hint={unitHint(draft.metric)} error={bad("p75")}>
              <Input id="bm-p75" type="number" inputMode="decimal" step="any" min={0} value={draft.p75} onChange={(e) => set("p75", e.target.value)} />
            </Field>
            <Field label={t("benchmarks.direction")} htmlFor="bm-dir">
              <Select
                id="bm-dir"
                value={draft.higherIsBetter ? "higher" : "lower"}
                onChange={(e) => set("higherIsBetter", e.target.value === "higher")}
                options={[
                  { value: "higher", label: t("benchmarks.higherBetter") },
                  { value: "lower", label: t("benchmarks.lowerBetter") },
                ]}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={`${t("ui.source")} *`} htmlFor="bm-source" error={bad("sourceName")} className="lg:col-span-2">
              <Input id="bm-source" required minLength={2} maxLength={200} value={draft.sourceName} onChange={(e) => set("sourceName", e.target.value)} placeholder={t("benchmarks.sourcePlaceholder")} />
            </Field>
            <Field label={t("benchmarks.sourceUrl")} htmlFor="bm-url" error={bad("sourceUrl")} className="lg:col-span-2">
              <Input id="bm-url" type="url" maxLength={500} value={draft.sourceUrl ?? ""} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://" dir="ltr" />
            </Field>
            <Field label={t("benchmarks.asOf")} htmlFor="bm-asof" error={bad("asOf")}>
              <Input id="bm-asof" type="date" required value={draft.asOf} onChange={(e) => set("asOf", e.target.value)} />
            </Field>
            <Field label={t("benchmarks.period")} htmlFor="bm-period">
              <Input id="bm-period" value={draft.periodLabel ?? ""} maxLength={80} onChange={(e) => set("periodLabel", e.target.value)} placeholder={t("benchmarks.periodPlaceholder")} />
            </Field>
            <Field label={t("benchmarks.sampleSize")} htmlFor="bm-sample" error={bad("sampleSize")}>
              <Input id="bm-sample" type="number" inputMode="numeric" min={1} step={1} value={draft.sampleSize} onChange={(e) => set("sampleSize", e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={draft.isEstimate} onChange={(e) => set("isEstimate", e.target.checked)} />
              {t("benchmarks.markEstimate")}
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? t("ui.loading") : t("ui.save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={pending}>
              {t("ui.cancel")}
            </Button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState title={t("benchmarks.noManual")} hint={canEdit ? t("benchmarks.noManualHint") : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="px-3 py-2 text-start font-medium">{t("benchmarks.metric")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("benchmarks.segment")}</th>
                <th className="px-3 py-2 text-end font-medium whitespace-nowrap">P25 / {t("benchmarks.median")} / P75</th>
                <th className="hidden px-3 py-2 text-start font-medium md:table-cell">{t("ui.source")}</th>
                <th className="hidden px-3 py-2 text-start font-medium sm:table-cell">{t("benchmarks.asOf")}</th>
                {canEdit && <th className="px-3 py-2 text-end font-medium">{t("ui.actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const segment = [r.platform && t(`platform.${r.platform}`), r.country, r.industry, r.businessSize, r.productType, r.isB2B == null ? null : r.isB2B ? "B2B" : "B2C", r.objective && t(`objective.${r.objective}`), r.audienceType, r.periodLabel]
                  .filter(Boolean)
                  .join(" · ");
                const n = (v: number | null) => fmtNumber(v, locale, 2);
                const suffix = METRIC_DEFS[r.metric].unit === "pct" ? "%" : "";
                return (
                  <tr key={r.id} className={cx("border-b border-border/60 last:border-0", editing === r.id && "bg-brand-soft/40")}>
                    <td className="px-3 py-2 align-top font-medium">
                      {t(`benchmarks.m_${r.metric}`)}
                      {r.isEstimate && (
                        <span className="ms-1.5">
                          <EstimateBadge label={t("ui.estimate")} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted">{segment || t("benchmarks.any")}</td>
                    <td className="num px-3 py-2 text-end align-top whitespace-nowrap">
                      {n(r.p25)} / <span className="font-semibold">{n(r.median)}</span> / {n(r.p75)}
                      {suffix}
                    </td>
                    <td className="hidden px-3 py-2 align-top text-xs md:table-cell">
                      {r.sourceName}
                      {r.sampleSize != null && (
                        <Badge className="ms-1.5">
                          n=<span className="num">{r.sampleSize}</span>
                        </Badge>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 align-top text-xs whitespace-nowrap sm:table-cell">{fmtDate(r.asOf, locale)}</td>
                    {canEdit && (
                      <td className="px-3 py-2 text-end align-top whitespace-nowrap">
                        <button type="button" onClick={() => open(r.id)} disabled={pending} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text" aria-label={t("ui.edit")} title={t("ui.edit")}>
                          <Pencil className="size-4" aria-hidden />
                        </button>
                        <button type="button" onClick={() => remove(r.id)} disabled={pending} className="rounded p-1.5 text-muted hover:bg-bad-soft hover:text-bad" aria-label={t("ui.delete")} title={t("ui.delete")}>
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
