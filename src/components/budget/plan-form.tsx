"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BudgetPeriod, BudgetScenario, FunnelStage, Objective, Platform } from "@prisma/client";
import { Info, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmtMoney, fmtNumber, fmtPct, fmtDate } from "@/lib/format";
import { convert, type FxTable } from "@/lib/fx";
import { allocate, COST_KEYS, periodEnd, SCENARIO_WEIGHTS, type CostAssumption, type CostKey, type CostSource, type HistoryKpis, type ScenarioWeights } from "@/lib/budget/allocation";
import { lineLabel } from "@/lib/budget/plan";
import { savePlan } from "@/app/actions/budget";
import { Badge, Button, Callout, Card, CardBody, CardHeader, cx, EstimateBadge, Field, Input, Select, SimpleTable, Textarea, inputClass } from "@/components/ui/primitives";
import { DonutChart } from "@/components/charts/charts";

export type PlanFormValues = {
  id?: string;
  clientId: string;
  name: string;
  period: BudgetPeriod;
  scenario: BudgetScenario;
  startDate: string;
  endDate: string;
  totalBudget: number;
  currency: string;
  objective: Objective | null;
  platforms: Platform[];
  products: string[];
  audiences: string[];
  regions: string[];
  campaignIds: string[];
  costs: Partial<Record<Platform, CostAssumption>>;
  weights: ScenarioWeights | null;
  platformShares: Partial<Record<Platform, number>> | null;
  plannedContent: number;
  notes: string;
};

export type PlanFormDefaults = {
  currency: string;
  historyFrom: string;
  historyTo: string;
  platforms: Platform[];
  history: Partial<Record<Platform, HistoryKpis>>;
  previous: Partial<Record<Platform, { spend: number; cpm: number | null; cpc: number | null; cpl: number | null; cvr: number | null; roas: number | null }>>;
  market: Partial<Record<Platform, Partial<CostAssumption> & { sourceName?: string }>>;
  costs: Partial<Record<Platform, CostAssumption>>;
  costSources: Partial<Record<Platform, Partial<Record<CostKey, CostSource>>>>;
  campaigns: { id: string; name: string; platform: Platform; objective: Objective; funnelStage: FunnelStage | null; historySpend: number; status: string }[];
  benchmarkSource: string | null;
};

const PERIODS: BudgetPeriod[] = ["MONTHLY", "QUARTERLY", "YEARLY"];
const SCENARIOS: BudgetScenario[] = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE", "CUSTOM"];
const OBJECTIVES: Objective[] = ["AWARENESS", "REACH", "TRAFFIC", "ENGAGEMENT", "VIDEO_VIEWS", "LEADS", "SALES", "APP_INSTALLS", "MESSAGES"];
const WEIGHT_KEYS = ["production", "testing", "scaling", "contingency", "prospecting", "retargeting", "retention", "efficiencyBias"] as const;

function TagInput({ id, value, onChange, suggestions, placeholder }: { id: string; value: string[]; onChange: (v: string[]) => void; suggestions: string[]; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = (s: string) => {
    const v = s.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  const rest = suggestions.filter((s) => !value.includes(s));
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
            {v}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="text-muted hover:text-bad" aria-label={`× ${v}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        id={id}
        className={cx(inputClass, "mt-1.5")}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft && add(draft)}
      />
      {rest.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rest.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted hover:border-brand hover:text-brand">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PlanForm({
  initial,
  defaults,
  suggestions,
  currencies,
  fx,
  paidPlatforms,
}: {
  initial: PlanFormValues;
  defaults: PlanFormDefaults;
  suggestions: { products: string[]; audiences: string[]; regions: string[] };
  currencies: string[];
  fx: FxTable;
  paidPlatforms: Platform[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<PlanFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof PlanFormValues>(k: K, val: PlanFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const money = (n: number | null) => fmtMoney(n, v.currency, locale);

  const weights = v.weights ?? SCENARIO_WEIGHTS.BALANCED;
  const campaigns = defaults.campaigns.filter((c) => v.platforms.includes(c.platform));

  const alloc = useMemo(() => {
    const start = new Date(v.startDate + "T00:00:00Z");
    const end = new Date(v.endDate + "T00:00:00Z");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
    return allocate({
      total: v.totalBudget || 0,
      platforms: v.platforms,
      objective: v.objective,
      scenario: v.scenario,
      customWeights: v.weights,
      platformShares: v.platformShares,
      costs: v.costs,
      history: defaults.history,
      campaigns: defaults.campaigns.filter((c) => v.campaignIds.includes(c.id) && v.platforms.includes(c.platform)),
      audiences: v.audiences,
      startDate: start,
      endDate: end,
    });
  }, [v, defaults]);

  const days = alloc ? Math.round((new Date(v.endDate).getTime() - new Date(v.startDate).getTime()) / 86400000) + 1 : 0;

  function setStart(s: string) {
    const d = new Date(s + "T00:00:00Z");
    setV((x) => ({ ...x, startDate: s, endDate: Number.isNaN(d.getTime()) ? x.endDate : periodEnd(d, x.period).toISOString().slice(0, 10) }));
  }
  function setPeriod(p: BudgetPeriod) {
    const d = new Date(v.startDate + "T00:00:00Z");
    setV((x) => ({ ...x, period: p, endDate: Number.isNaN(d.getTime()) ? x.endDate : periodEnd(d, p).toISOString().slice(0, 10) }));
  }
  function setCurrency(c: string) {
    // Money assumptions follow the currency so estimates stay consistent (FX = reference rates).
    setV((x) => {
      const costs: PlanFormValues["costs"] = {};
      for (const [p, cost] of Object.entries(x.costs) as [Platform, CostAssumption][]) {
        costs[p] = { ...cost };
        for (const k of ["cpm", "cpc", "cpl", "aov"] as const) if (cost[k] != null) costs[p]![k] = Math.round(convert(cost[k]!, x.currency, c, fx) * 100) / 100;
      }
      return { ...x, currency: c, totalBudget: Math.round(convert(x.totalBudget, x.currency, c, fx)), costs };
    });
  }
  function togglePlatform(p: Platform) {
    setV((x) => {
      const on = x.platforms.includes(p);
      const costs = { ...x.costs };
      if (!on && !costs[p]) costs[p] = defaults.costs[p] ? { ...defaults.costs[p]! } : { cpm: null, cpc: null, cpl: null, cvr: null, aov: null };
      return { ...x, platforms: on ? x.platforms.filter((y) => y !== p) : [...x.platforms, p], costs };
    });
  }
  function setCost(p: Platform, k: CostKey, raw: string) {
    const n = raw === "" ? null : Number(raw);
    const val = n == null || !Number.isFinite(n) ? null : k === "cvr" ? n / 100 : n;
    setV((x) => ({ ...x, costs: { ...x.costs, [p]: { ...(x.costs[p] ?? { cpm: null, cpc: null, cpl: null, cvr: null, aov: null }), [k]: val } } }));
  }
  function setWeight(k: (typeof WEIGHT_KEYS)[number], pct: string) {
    const n = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
    setV((x) => ({ ...x, weights: { ...(x.weights ?? SCENARIO_WEIGHTS.BALANCED), [k]: n } }));
  }
  function setScenario(s: BudgetScenario) {
    setV((x) => ({ ...x, scenario: s, weights: s === "CUSTOM" ? (x.weights ?? { ...SCENARIO_WEIGHTS.BALANCED }) : x.weights }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!v.platforms.length) return setError(t("budget.form.needPlatform"));
    start(async () => {
      const res = await savePlan({
        ...v,
        costs: Object.fromEntries(v.platforms.map((p) => [p, v.costs[p] ?? { cpm: null, cpc: null, cpl: null, cvr: null, aov: null }])),
        weights: v.scenario === "CUSTOM" ? weights : null,
        platformShares: v.scenario === "CUSTOM" ? (v.platformShares as Record<string, number> | null) : null,
      });
      if (res.ok) router.push(`/budget/${res.id}?client=${v.clientId}`);
      else setError(t(`budget.error.${res.error}`));
    });
  }

  const srcBadge = (p: Platform, k: CostKey) => {
    const d = defaults.costs[p]?.[k];
    const cur = v.costs[p]?.[k];
    const src = d != null && cur != null && Math.abs(d - cur) < 1e-9 ? defaults.costSources[p]?.[k] : cur != null ? "manual" : undefined;
    if (!src) return null;
    return <span className={cx("text-[10px]", src === "history" ? "text-good" : src === "benchmark" ? "text-warn" : "text-info")}>{t(`budget.costSource.${src}`)}</span>;
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card>
        <CardHeader title={t("budget.form.basics")} />
        <CardBody className="grid gap-4 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("budget.form.name")} htmlFor="pf-name" className="sm:col-span-2">
            <Input id="pf-name" required maxLength={160} value={v.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label={t("budget.form.period")} htmlFor="pf-period">
            <Select id="pf-period" value={v.period} onChange={(e) => setPeriod(e.target.value as BudgetPeriod)} options={PERIODS.map((p) => ({ value: p, label: t(`budget.period.${p}`) }))} />
          </Field>
          <Field label={t("budget.form.objective")} htmlFor="pf-obj">
            <Select id="pf-obj" value={v.objective ?? ""} placeholder={t("budget.form.mixedObjective")} onChange={(e) => set("objective", (e.target.value || null) as Objective | null)} options={OBJECTIVES.map((o) => ({ value: o, label: t(`objective.${o}`) }))} />
          </Field>
          <Field label={t("ui.from")} htmlFor="pf-start">
            <Input id="pf-start" type="date" required value={v.startDate} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t("ui.to")} htmlFor="pf-end" hint={days > 0 ? t("budget.form.duration", { days, weeks: fmtNumber(days / 7, locale, 1) }) : undefined} error={days <= 0 ? t("budget.form.badDates") : undefined}>
            <Input id="pf-end" type="date" required value={v.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
          <Field label={t("budget.form.total")} htmlFor="pf-total">
            <Input id="pf-total" type="number" required min={1} step="any" inputMode="decimal" value={v.totalBudget || ""} onChange={(e) => set("totalBudget", Number(e.target.value))} className="num" />
          </Field>
          <Field label={t("filter.currency")} htmlFor="pf-cur" hint={v.currency !== defaults.currency ? t("budget.form.currencyConverted", { source: fx.source ?? "" }) : undefined}>
            <Select id="pf-cur" value={v.currency} onChange={(e) => setCurrency(e.target.value)} options={currencies.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label={t("budget.form.plannedContent")} htmlFor="pf-content" hint={t("budget.form.plannedContentHint")}>
            <Input id="pf-content" type="number" min={0} step={1} value={v.plannedContent} onChange={(e) => set("plannedContent", Math.max(0, Math.round(Number(e.target.value) || 0)))} className="num" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("budget.form.targeting")} />
        <CardBody className="space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-muted">{t("budget.form.platforms")}</legend>
            <div className="flex flex-wrap gap-2">
              {paidPlatforms.map((p) => {
                const on = v.platforms.includes(p);
                return (
                  <label key={p} className={cx("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm", on ? "border-brand bg-brand-soft text-brand" : "border-border hover:bg-surface-2")}>
                    <input type="checkbox" checked={on} onChange={() => togglePlatform(p)} className="accent-[var(--brand)]" />
                    {t(`platform.${p}`)}
                    {defaults.history[p] && <span className="text-[10px] text-good">{t("budget.form.hasHistory")}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-3">
            <Field label={t("budget.form.products")} htmlFor="pf-products">
              <TagInput id="pf-products" value={v.products} onChange={(x) => set("products", x)} suggestions={suggestions.products} placeholder={t("budget.form.tagPlaceholder")} />
            </Field>
            <Field label={t("budget.form.audiences")} htmlFor="pf-aud">
              <TagInput id="pf-aud" value={v.audiences} onChange={(x) => set("audiences", x)} suggestions={suggestions.audiences} placeholder={t("budget.form.tagPlaceholder")} />
            </Field>
            <Field label={t("budget.form.regions")} htmlFor="pf-reg">
              <TagInput id="pf-reg" value={v.regions} onChange={(x) => set("regions", x)} suggestions={suggestions.regions} placeholder={t("budget.form.tagPlaceholder")} />
            </Field>
          </div>
          {campaigns.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-muted">{t("budget.form.campaigns")}</legend>
              <p className="mb-2 text-[11px] text-subtle">{t("budget.form.campaignsHint")}</p>
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
                {campaigns.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={v.campaignIds.includes(c.id)}
                      onChange={() => set("campaignIds", v.campaignIds.includes(c.id) ? v.campaignIds.filter((x) => x !== c.id) : [...v.campaignIds, c.id])}
                      className="accent-[var(--brand)]"
                    />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-[11px] text-subtle">
                      {t(`platform.${c.platform}`)}
                      {c.funnelStage ? ` · ${t(`funnel.${c.funnelStage}`)}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("budget.form.scenario")} subtitle={t("budget.form.scenarioHint")} />
        <CardBody className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label={t("budget.form.scenario")}>
            {SCENARIOS.map((s) => (
              <label key={s} className={cx("cursor-pointer rounded-lg border p-3 text-sm", v.scenario === s ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-2")}>
                <span className="flex items-center gap-2 font-semibold">
                  <input type="radio" name="scenario" checked={v.scenario === s} onChange={() => setScenario(s)} className="accent-[var(--brand)]" />
                  {t(`budget.scenario.${s}`)}
                </span>
                <span className="mt-1 block text-xs text-muted">{t(`budget.scenarioWhy.${s}`)}</span>
              </label>
            ))}
          </div>
          {v.scenario === "CUSTOM" && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {WEIGHT_KEYS.map((k) => (
                <Field key={k} label={`${t(`budget.weight.${k}`)} (%)`} htmlFor={`w-${k}`} hint={t(`budget.weightHint.${k}`)}>
                  <Input id={`w-${k}`} type="number" min={0} max={100} step={1} className="num" value={Math.round(weights[k] * 100)} onChange={(e) => setWeight(k, e.target.value)} />
                </Field>
              ))}
              <Field label={t("budget.weight.phasing")} htmlFor="w-phasing">
                <Select id="w-phasing" value={weights.phasing} onChange={(e) => setV((x) => ({ ...x, weights: { ...weights, phasing: e.target.value as ScenarioWeights["phasing"] } }))} options={(["flat", "rampUp", "frontLoad"] as const).map((p) => ({ value: p, label: t(`budget.phasing.${p}`) }))} />
              </Field>
              {v.platforms.length > 1 && (
                <fieldset className="sm:col-span-2 lg:col-span-3">
                  <legend className="mb-1 text-xs font-medium text-muted">{t("budget.form.manualShares")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {v.platforms.map((p) => (
                      <label key={p} className="flex items-center gap-1.5 text-xs">
                        {t(`platform.${p}`)}
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className={cx(inputClass, "num h-8 w-20")}
                          value={v.platformShares?.[p] != null ? Math.round(v.platformShares[p]! * 100) : ""}
                          placeholder="auto"
                          onChange={(e) => {
                            const n = e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))) / 100;
                            setV((x) => {
                              const next = { ...(x.platformShares ?? {}) };
                              if (n == null) delete next[p];
                              else next[p] = n;
                              return { ...x, platformShares: Object.keys(next).length ? next : null };
                            });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          )}
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t("budget.form.weightsExplain", {
              reserves: fmtPct(weights.production + weights.testing + weights.scaling + weights.contingency, locale),
              p: fmtPct(alloc?.weights.prospecting ?? 0, locale),
              r: fmtPct(alloc?.weights.retargeting ?? 0, locale),
              k: fmtPct(alloc?.weights.retention ?? 0, locale),
              bias: fmtPct(alloc?.weights.efficiencyBias ?? 0, locale),
              phasing: t(`budget.phasing.${alloc?.weights.phasing ?? "flat"}`),
            })}
          </p>
        </CardBody>
      </Card>

      {v.platforms.length > 0 && (
        <Card>
          <CardHeader
            title={t("budget.form.costs")}
            subtitle={t("budget.form.costsHint", { from: fmtDate(defaults.historyFrom, locale), to: fmtDate(defaults.historyTo, locale) })}
            meta={<EstimateBadge label={t("ui.estimate")} hint={t("budget.form.costsEstimate")} />}
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="px-3 py-2 text-start font-medium">{t("filter.platform")}</th>
                    {COST_KEYS.map((k) => (
                      <th key={k} className="px-3 py-2 text-start font-medium">
                        {t(`budget.cost.${k}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {v.platforms.map((p) => (
                    <tr key={p} className="border-b border-border/60 align-top last:border-0">
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{t(`platform.${p}`)}</td>
                      {COST_KEYS.map((k) => {
                        const cur = v.costs[p]?.[k];
                        const mk = k === "aov" ? null : defaults.market[p]?.[k];
                        const prev = k === "aov" ? null : defaults.previous[p]?.[k as "cpm" | "cpc" | "cpl" | "cvr"];
                        const fmt = (n: number | null | undefined) => (n == null ? "—" : k === "cvr" ? fmtPct(n, locale, 2) : fmtMoney(n, v.currency, locale, 2));
                        return (
                          <td key={k} className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              aria-label={`${t(`platform.${p}`)} ${t(`budget.cost.${k}`)}`}
                              className={cx(inputClass, "num h-8 w-28")}
                              value={cur == null ? "" : k === "cvr" ? Math.round(cur * 10000) / 100 : cur}
                              onChange={(e) => setCost(p, k, e.target.value)}
                            />
                            <div className="mt-0.5 space-y-0.5 text-[10px] leading-tight text-subtle">
                              {srcBadge(p, k)}
                              {mk != null && (
                                <p>
                                  {t("ui.market")}: <span className="num">{fmt(mk)}</span>
                                </p>
                              )}
                              {prev != null && (
                                <p>
                                  {t("budget.form.previous")}: <span className="num">{fmt(prev)}</span>
                                </p>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-[11px] text-subtle">
              {t("budget.form.cvrUnit")} · {defaults.benchmarkSource ? `${t("ui.market")}: ${defaults.benchmarkSource}` : t("budget.form.noBenchmark")}
            </p>
          </CardBody>
        </Card>
      )}

      {alloc && alloc.total > 0 && v.platforms.length > 0 && (
        <Card>
          <CardHeader title={t("budget.form.preview")} subtitle={t("budget.form.previewHint")} meta={<EstimateBadge label={t("ui.estimate")} hint={t("budget.estimateMethod")} />} />
          <CardBody className="space-y-5">
            <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-2">
              <DonutChart
                format="money"
                currency={v.currency}
                data={[
                  ...alloc.platforms.map((p) => ({ label: t(`platform.${p.platform}`), value: Math.round(p.amount) })),
                  ...(["production", "testing", "scaling", "contingency"] as const).filter((k) => alloc.reserves[k] > 0).map((k) => ({ label: t(`budget.weight.${k}`), value: Math.round(alloc.reserves[k]) })),
                ]}
              />
              <SimpleTable
                head={[t("filter.platform"), t("budget.share"), t("budget.planned"), t("budget.basis")]}
                rows={alloc.platforms.map((p) => [
                  t(`platform.${p.platform}`),
                  <span key="s" className="num">{fmtPct(p.share, locale)}</span>,
                  <span key="a" className="num">{money(p.amount)}</span>,
                  <Badge key="b" tone={p.basis === "efficiency" ? "good" : p.basis === "manual" ? "info" : "neutral"}>
                    {t(`budget.basisLabel.${p.basis}`)}
                  </Badge>,
                ])}
              />
            </div>
            <SimpleTable
              head={[t("budget.line"), t("budget.planned"), t("kpi.impressions"), t("kpi.clicks"), t("kpi.leads"), t("kpi.purchases"), t("kpi.revenue")]}
              rows={alloc.lines.map((l) => [
                <span key="l" className="inline-flex flex-wrap items-center gap-1.5">
                  {lineLabel({ ...l }, t)}
                  {l.incomplete && <Badge tone="warning">{t("budget.missingAssumption")}</Badge>}
                </span>,
                <span key="b" className="num whitespace-nowrap">{money(l.budget)}</span>,
                <span key="i" className="num">{fmtNumber(l.impressions, locale)}</span>,
                <span key="c" className="num">{fmtNumber(l.clicks, locale)}</span>,
                <span key="d" className="num">{fmtNumber(l.leads, locale)}</span>,
                <span key="s" className="num">{fmtNumber(l.sales, locale)}</span>,
                <span key="r" className="num whitespace-nowrap">{money(l.revenue)}</span>,
              ])}
            />
            <div className="grid gap-5 [&>*]:min-w-0 md:grid-cols-3">
              <div>
                <h4 className="mb-2 text-xs font-semibold text-muted">{t("budget.view.funnel")}</h4>
                <SimpleTable head={[t("filter.funnel"), t("budget.planned")]} rows={alloc.views.byFunnel.map((x) => [t(`funnel.${x.key}`), <span key="a" className="num">{money(x.amount)}</span>])} />
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold text-muted">{t("budget.view.objective")}</h4>
                <SimpleTable head={[t("filter.objective"), t("budget.planned")]} rows={alloc.views.byObjective.map((x) => [x.key === "UNSET" ? t("budget.form.mixedObjective") : t(`objective.${x.key}`), <span key="a" className="num">{money(x.amount)}</span>])} />
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold text-muted">{t("budget.view.audience")}</h4>
                {alloc.views.byAudience.length ? (
                  <SimpleTable head={[t("filter.audience"), t("budget.planned")]} rows={alloc.views.byAudience.map((x) => [x.key, <span key="a" className="num">{money(x.amount)}</span>])} />
                ) : (
                  <p className="text-xs text-subtle">{t("budget.view.noAudiences")}</p>
                )}
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold text-muted">
                {t("budget.view.weekly")} · {t(`budget.phasing.${alloc.weights.phasing}`)}
              </h4>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {alloc.views.weekly.map((w, i) => (
                  <div key={i} className="min-w-20 rounded-md bg-surface-2 px-2 py-1.5 text-center">
                    <p className="text-[10px] text-subtle">{fmtDate(w.start, locale, { month: "short", day: "numeric" })}</p>
                    <p className="num text-xs font-medium">{fmtMoney(w.amount, v.currency, locale)}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <Field label={t("ui.notes")} htmlFor="pf-notes">
            <Textarea id="pf-notes" value={v.notes} maxLength={4000} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      {error && <Callout tone="bad">{error}</Callout>}
      {initial.id && <Callout tone="warning">{t("budget.form.rebuildWarning")}</Callout>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending || days <= 0}>
          {pending ? t("ui.loading") : initial.id ? t("budget.form.saveChanges") : t("budget.form.create")}
        </Button>
        <Button type="button" onClick={() => router.back()} disabled={pending}>
          {t("ui.cancel")}
        </Button>
      </div>
    </form>
  );
}
