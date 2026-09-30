import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { metricSources, pageContext } from "@/lib/page";
import { filtersToQuery, type RawParams } from "@/lib/filters";
import { fmtDate, fmtMoney, fmtNumber, fmtPct, isoDay } from "@/lib/format";
import { analyzePlan } from "@/lib/budget/analysis";
import { lastPlanSync } from "@/lib/budget/actuals";
import { SCENARIO_WEIGHTS, weeklyPhasing, type CostKey } from "@/lib/budget/allocation";
import { pacingAlerts, pacingSeries, type Grain } from "@/lib/budget/pacing";
import { lineLabel } from "@/lib/budget/plan";
import type { ResultMetric } from "@/lib/budget/reallocation";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, DemoBadge, EstimateBadge, PageHeader, Progress, SimpleTable, Tabs, cx, type Tone } from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ui/export-menu";
import { GroupedBarChart, TimeSeriesChart, DonutChart } from "@/components/charts/charts";
import { PlanActions } from "@/components/budget/plan-actions";
import { ReallocationPanel } from "@/components/budget/reallocation-panel";
import { ExpensesPanel } from "@/components/budget/expenses-panel";
import { LineEditor } from "@/components/budget/line-editor";

export const metadata = { title: "Budget plan" };

const ADVICE_TONE: Record<string, Tone> = { increase: "good", decrease: "bad", hold: "neutral", review: "warning" };
const DAY = 86400000;

export default async function PlanPage({ params, searchParams }: { params: Promise<{ planId: string }>; searchParams: Promise<RawParams> }) {
  const [{ planId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await pageContext(sp, "budget:view");
  const { t, locale } = ctx;
  // Tenant scope: only plans of accessible clients.
  const plan = await db.budgetPlan.findFirst({ where: { id: planId, clientId: { in: ctx.clients.map((c) => c.id) } }, include: { lines: { orderBy: { plannedBudget: "desc" } } } });
  if (!plan) notFound();
  const client = ctx.clients.find((c) => c.id === plan.clientId)!;
  const cur = plan.currency;
  const money = (n: number | null) => fmtMoney(n, cur, locale);

  const [an, updated, source, campaigns, approver] = await Promise.all([
    analyzePlan(plan, ctx.fx),
    lastPlanSync(plan.clientId),
    metricSources({ clientId: plan.clientId }, t),
    db.campaign.findMany({ where: { clientId: plan.clientId }, select: { id: true, name: true, platform: true }, orderBy: { name: "asc" } }),
    plan.approvedById ? db.user.findFirst({ where: { id: plan.approvedById, organizationId: ctx.user.organizationId }, select: { name: true } }) : null,
  ]);
  const act = an.actuals;
  const label = (l: (typeof plan.lines)[number]) => lineLabel(l, t);
  const labels = new Map(plan.lines.map((l) => [l.id, label(l)]));

  // ── Result metric formatting
  const m: ResultMetric = an.metric;
  const metricName = t(`budget.metric.${m}`);
  const fmtResult = (n: number) => (m === "revenue" ? money(n) : fmtNumber(n, locale));
  const fmtEff = (eff: number | null) => (eff == null || eff <= 0 ? "—" : m === "revenue" ? `${fmtNumber(eff, locale, 2)}x` : money(1 / eff));
  const effName = m === "revenue" ? t("kpi.roas") : t(`budget.costPer.${m}`);

  // ── Pacing
  const grain: Grain = sp.pace === "weekly" || sp.pace === "monthly" ? sp.pace : "daily";
  const rows = pacingSeries(an.plannedDaily, act.daily, grain, act.asOf);
  const runRate = an.forecast.runRate;
  const chartRows = rows.map((r, i) => {
    const bucketEnd = i < rows.length - 1 ? new Date(new Date(rows[i + 1].date + "T00:00:00Z").getTime() - DAY) : plan.endDate;
    const lastActual = r.cumActual != null && (i === rows.length - 1 || rows[i + 1].cumActual == null);
    const future = r.cumActual == null;
    const forecast = act.started && (future || lastActual) ? (future ? an.forecast.spent + runRate * Math.max(0, Math.round((Math.min(bucketEnd.getTime(), plan.endDate.getTime()) - act.asOf.getTime()) / DAY)) : r.cumActual) : null;
    return { date: r.date, cumPlanned: r.cumPlanned, cumActual: r.cumActual, forecast, planned: r.planned, actual: r.actual ?? 0 };
  });
  const alerts = pacingAlerts({
    pacing: an.forecast.pacing,
    projected: an.forecast.projected,
    budget: an.mediaPlanned,
    depletionDate: an.forecast.depletionDate,
    periodEnd: plan.endDate,
    started: act.started,
    fmtPct: (n) => fmtPct(n, locale),
    fmtMoney: money,
    fmtDate: (d) => fmtDate(d, locale),
  });

  // ── Breakdown views derived from the saved lines
  const sumBy = (key: (l: (typeof an.rows)[number]["line"]) => string) => {
    const mp = new Map<string, number>();
    for (const r of an.rows) mp.set(key(r.line), (mp.get(key(r.line)) ?? 0) + r.planned);
    return [...mp.entries()].map(([k, v]) => ({ label: k, value: Math.round(v) })).sort((a, b) => b.value - a.value);
  };
  const byPlatform = sumBy((l) => (l.platform ? t(`platform.${l.platform}`) : t(`budget.cat.${l.category}`)));
  const byCategory = sumBy((l) => t(`budget.cat.${l.category}`));
  const byFunnel = sumBy((l) => (l.funnelStage ? t(`funnel.${l.funnelStage}`) : t("budget.nonMedia")));
  const weights = an.assumptions.weights ?? (plan.scenario !== "CUSTOM" ? SCENARIO_WEIGHTS[plan.scenario] : null);
  const weekly = weeklyPhasing(plan.startDate, plan.endDate, an.mediaPlanned, an.assumptions.phasing);

  const canEdit = ctx.can("budget:edit");
  const canApprove = ctx.can("budget:approve");
  const qs = filtersToQuery(sp, { client: plan.clientId });
  const metaEst = <DataMeta source={`${source} · ${t("budget.estimateMethodShort")}`} updated={ctx.rel(updated)} demo={client.isDemo || plan.source === "DEMO"} estimate labels={ctx.metaLabels} />;

  return (
    <div id="plan-root" className="space-y-6">
      <nav className="text-xs text-muted no-print">
        <Link href={`/budget?${qs}`} className="hover:text-brand">
          {t("nav.budget")}
        </Link>{" "}
        / <span className="text-text">{plan.name}</span>
      </nav>
      <PageHeader
        title={plan.name}
        description={`${client.name} · ${t(`budget.period.${plan.period}`)} · ${fmtDate(plan.startDate, locale)} – ${fmtDate(plan.endDate, locale)} · ${t(`budget.scenario.${plan.scenario}`)}${plan.objective ? ` · ${t(`objective.${plan.objective}`)}` : ""}`}
        badges={
          <>
            <Badge tone={plan.status === "APPROVED" ? "good" : "neutral"}>{t(`budget.status.${plan.status}`)}</Badge>
            {(client.isDemo || plan.source === "DEMO") && <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} />}
          </>
        }
        actions={
          <>
            <PlanActions planId={plan.id} status={plan.status} editHref={`/budget/${plan.id}/edit?${qs}`} canEdit={canEdit} canApprove={canApprove} />
            <ExportMenu targetId="plan-root" fileName={`budget-${plan.name}`} />
          </>
        }
      />
      {plan.status === "APPROVED" && plan.approvedAt && (
        <p className="-mt-3 text-xs text-muted">{t("budget.approvedBy", { name: approver?.name ?? "—", date: fmtDate(plan.approvedAt, locale) })}</p>
      )}

      {alerts.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {alerts.map((a, i) => (
            <Callout key={i} tone={a.tone}>
              {t(a.key, a.vars)}
            </Callout>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCard locale={locale} label={t("budget.totalBudget")} value={money(an.total)} footer={<p className="num text-[11px] text-subtle">{t("budget.mediaShare", { amount: money(an.mediaPlanned) })}</p>} />
        <KpiCard locale={locale} label={t("budget.actualSpend")} value={money(an.spentTotal)} footer={<p className="text-[11px] text-subtle">{t("budget.spendSplit", { media: money(act.media.spend), other: money(act.expensesTotal) })}</p>} />
        <KpiCard locale={locale} label={t("kpi.remaining")} value={money(an.remaining)} />
        <KpiCard
          locale={locale}
          label={t("kpi.utilization")}
          value={fmtPct(an.utilization, locale)}
          footer={
            <div className="mt-1 space-y-1">
              <Progress value={an.utilization} tone={an.utilization != null && an.utilization > 1 ? "bad" : "brand"} label={t("kpi.utilization")} />
              <p className="num text-[11px] text-subtle">{t("budget.elapsed", { d: act.elapsedDays, total: act.totalDays })}</p>
            </div>
          }
        />
        <KpiCard
          locale={locale}
          label={t("budget.pacing")}
          value={an.forecast.pacing == null ? "—" : fmtPct(an.forecast.pacing, locale)}
          footer={<p className="text-[11px] text-subtle">{t("budget.pacingHint", { expected: money(an.forecast.expectedByNow) })}</p>}
        />
        <KpiCard
          locale={locale}
          label={t("kpi.forecast")}
          value={act.started ? money(an.projectedTotal) : "—"}
          estimate={t("ui.estimate")}
          footer={<p className="text-[11px] text-subtle">{an.forecast.depletionDate ? t("budget.depletesOn", { date: fmtDate(an.forecast.depletionDate, locale) }) : t("budget.runRate", { amount: money(runRate) })}</p>}
        />
      </div>

      <Card>
        <CardHeader title={t("budget.pacingTitle")} subtitle={t("budget.pacingSubtitle", { phasing: t(`budget.phasing.${an.assumptions.phasing}`) })} meta={metaEst} />
        <CardBody>
          <Tabs
            active={grain}
            tabs={(["daily", "weekly", "monthly"] as const).map((g) => ({ key: g, label: t(`budget.grain.${g}`), href: `/budget/${plan.id}?${qs}&pace=${g}` }))}
          />
          <div className="grid gap-5 [&>*]:min-w-0 xl:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-semibold text-muted">{t("budget.cumulative")}</h4>
              <TimeSeriesChart
                data={chartRows.map((r) => ({ date: r.date, cumPlanned: r.cumPlanned, cumActual: r.cumActual, forecast: r.forecast }))}
                series={[
                  { key: "cumPlanned", label: t("budget.planned") },
                  { key: "cumActual", label: t("ui.actual") },
                  { key: "forecast", label: t("budget.forecastLine"), dashed: true },
                ]}
                format="money"
                currency={cur}
                referenceY={an.mediaPlanned}
                referenceLabel={t("budget.mediaBudget")}
              />
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold text-muted">{t(`budget.perBucket.${grain}`)}</h4>
              {grain === "daily" ? (
                <TimeSeriesChart data={chartRows.filter((r) => r.date <= isoDay(act.asOf)).map((r) => ({ date: r.date, planned: r.planned, actual: r.actual }))} series={[{ key: "planned", label: t("budget.planned") }, { key: "actual", label: t("ui.actual") }]} format="money" currency={cur} />
              ) : (
                <GroupedBarChart
                  data={chartRows.map((r) => ({ label: fmtDate(r.date, locale, grain === "monthly" ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" }), planned: Math.round(r.planned), actual: Math.round(r.actual) }))}
                  series={[{ key: "planned", label: t("budget.planned") }, { key: "actual", label: t("ui.actual") }]}
                  format="money"
                  currency={cur}
                />
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("budget.linesTitle")} subtitle={t("budget.linesSubtitle", { metric: metricName })} meta={metaEst} />
        <DataTable
          exportName={`budget-lines-${plan.name}`}
          pageSize={50}
          columns={[
            { key: "line", label: t("budget.line") },
            { key: "planned", label: t("budget.planned"), type: "money", currency: cur },
            { key: "actual", label: t("budget.actualSpend"), type: "money", currency: cur },
            { key: "variance", label: t("budget.variance"), type: "money", currency: cur, hideOnMobile: true },
            { key: "variancePct", label: t("budget.vsExpected"), type: "pct" },
            { key: "result", label: t("budget.resultVs", { metric: metricName }), align: "end" },
            { key: "forecast", label: t("budget.forecastCol"), type: "money", currency: cur, hideOnMobile: true },
            { key: "advice", label: t("budget.recommendation"), sortable: false },
          ]}
          rows={an.rows.map((r) => {
            const vsExpected = r.expectedByNow > 0 ? (r.actual - r.expectedByNow) / r.expectedByNow : null;
            const toneCls = r.tone === "bad" ? "text-bad" : r.tone === "warning" ? "text-warn" : r.tone === "good" ? "text-good" : "text-muted";
            const a = r.advice;
            return {
              _id: r.id,
              line: {
                v: labels.get(r.id)!,
                d: (
                  <div className="min-w-40">
                    <p className="font-medium">{labels.get(r.id)}</p>
                    <p className="text-[11px] text-subtle">
                      {t(`budget.cat.${r.line.category}`)}
                      {r.line.funnelStage && ` · ${t(`funnel.${r.line.funnelStage}`)}`}
                      {r.line.campaignId && ` · ${t("budget.linked")}`}
                      {r.expenses > 0 && ` · ${t("budget.inclExpenses", { amount: money(r.expenses) })}`}
                    </p>
                  </div>
                ),
              },
              planned: r.planned,
              actual: r.actual,
              variance: { v: r.variance, d: <span className={r.variance > 0 ? "text-bad" : "text-muted"}>{money(r.variance)}</span> },
              variancePct: { v: vsExpected, d: vsExpected == null ? "—" : <span className={cx("font-medium", toneCls)}>{(vsExpected > 0 ? "+" : "") + fmtPct(vsExpected, locale)}</span> },
              result: {
                v: r.actualResult,
                d: r.media ? (
                  <div className="min-w-28">
                    <p>
                      {fmtResult(r.actualResult)} <span className="text-subtle">/ {fmtResult(r.plannedResult)}</span>
                    </p>
                    <Progress value={r.plannedResult > 0 ? r.actualResult / r.plannedResult : null} tone={r.plannedResultByNow > 0 && r.actualResult < r.plannedResultByNow * 0.8 ? "warning" : "good"} />
                  </div>
                ) : (
                  <span className="text-subtle">—</span>
                ),
              },
              forecast: r.forecast,
              advice: {
                v: a?.action ?? "",
                d: a ? (
                  <div className="min-w-44 text-start">
                    <Badge tone={ADVICE_TONE[a.action]}>{t(`budget.action.${a.action}`)}</Badge>
                    <p className="mt-0.5 text-[11px] whitespace-normal text-muted">
                      {t(`budget.advice.${a.reason}`, { eff: fmtEff(a.efficiency), avg: fmtEff(a.avgEfficiency), effName, pacing: a.pacing == null ? "—" : fmtPct(a.pacing, locale) })}
                    </p>
                  </div>
                ) : (
                  <span className="text-[11px] text-subtle">{t("budget.nonMediaAdvice")}</span>
                ),
              },
            };
          })}
          searchable={false}
        />
        <div className="space-y-2 px-4 pb-4">
          {act.unplanned.map((u) => (
            <Callout key={u.platform} tone="warning">
              {t("budget.unplanned", { platform: t(`platform.${u.platform}`), amount: money(u.spend) })}
            </Callout>
          ))}
          {act.unassignedExpenses > 0 && <Callout tone="info">{t("budget.unassignedExpenses", { amount: money(act.unassignedExpenses) })}</Callout>}
          <p className="text-[11px] text-subtle">{t("budget.attributionNote")}</p>
        </div>
      </Card>

      <div className="grid gap-4 [&>*]:min-w-0 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("budget.realloc.title2")} subtitle={t("budget.realloc.subtitle", { effName })} meta={metaEst} />
          <CardBody>
            <ReallocationPanel
              planId={plan.id}
              canApprove={canApprove}
              proposals={an.proposals.map((p) => ({
                ...p,
                fromLabel: labels.get(p.fromId)!,
                toLabel: labels.get(p.toId)!,
                amountLabel: money(p.amount),
                reason: t(p.fromEfficiency > 0 ? "budget.realloc.reason" : "budget.realloc.reasonNoResults", { from: labels.get(p.fromId)!, to: labels.get(p.toId)!, fromEff: fmtEff(p.fromEfficiency), toEff: fmtEff(p.toEfficiency), effName, avg: fmtEff(an.avgEfficiency) }),
              }))}
            />
            {an.decided.length > 0 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted">{t("budget.realloc.history", { n: an.decided.length })}</summary>
                <ul className="mt-2 space-y-1">
                  {an.decided.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <Badge tone={d.state === "ACCEPTED" ? "good" : "bad"}>{t(`budget.realloc.state.${d.state}`)}</Badge>
                      <span>{d.title}</span>
                      <span className="text-subtle">{d.decidedAt ? fmtDate(d.decidedAt, locale) : ""}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("budget.allocationTitle")} subtitle={t(`budget.scenarioWhy.${plan.scenario}`)} meta={<DataMeta source={t("budget.planSource")} updated={ctx.rel(plan.updatedAt)} demo={plan.source === "DEMO"} labels={ctx.metaLabels} />} />
          <CardBody className="space-y-4">
            <DonutChart data={byPlatform} format="money" currency={cur} height={180} />
            {weights && (
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {(["production", "testing", "scaling", "contingency", "prospecting", "retargeting", "retention", "efficiencyBias"] as const).map((k) => (
                  <Badge key={k} tone="neutral">
                    {t(`budget.weight.${k}`)}: <span className="num">{fmtPct(weights[k], locale, 0)}</span>
                  </Badge>
                ))}
              </div>
            )}
            <div className="grid gap-4 [&>*]:min-w-0 sm:grid-cols-2">
              <SimpleTable head={[t("budget.category"), t("budget.planned")]} rows={byCategory.map((x) => [x.label, <span key="a" className="num">{money(x.value)}</span>])} />
              <SimpleTable head={[t("filter.funnel"), t("budget.planned")]} rows={byFunnel.map((x) => [x.label, <span key="a" className="num">{money(x.value)}</span>])} />
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold text-muted">
                {t("budget.view.weekly")} · {t(`budget.phasing.${an.assumptions.phasing}`)}
              </h4>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {weekly.map((w, i) => (
                  <div key={i} className="min-w-20 rounded-md bg-surface-2 px-2 py-1.5 text-center">
                    <p className="text-[10px] text-subtle">{fmtDate(w.start, locale, { month: "short", day: "numeric" })}</p>
                    <p className="num text-xs font-medium">{money(w.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("budget.assumptionsTitle")} subtitle={t("budget.assumptionsSubtitle")} meta={<EstimateBadge label={t("ui.estimate")} hint={t("budget.estimateMethod")} />} />
        <CardBody>
          {Object.keys(an.assumptions.costs).length === 0 ? (
            <p className="text-sm text-muted">{t("budget.noAssumptions")}</p>
          ) : (
            <SimpleTable
              head={[t("filter.platform"), ...(["cpm", "cpc", "cpl", "cvr", "aov"] as CostKey[]).map((k) => t(`budget.cost.${k}`))]}
              rows={Object.entries(an.assumptions.costs).map(([p, c]) => [
                t(`platform.${p}`),
                ...(["cpm", "cpc", "cpl", "cvr", "aov"] as CostKey[]).map((k) => {
                  const src = an.assumptions.costSources[p as keyof typeof an.assumptions.costSources]?.[k];
                  const mk = k === "aov" ? null : an.assumptions.market[p as keyof typeof an.assumptions.market]?.[k];
                  const f = (n: number | null | undefined) => (n == null ? "—" : k === "cvr" ? fmtPct(n, locale, 2) : fmtMoney(n, cur, locale, 2));
                  return (
                    <div key={k} className="num">
                      <p>{f(c?.[k])}</p>
                      <p className="text-[10px] text-subtle">
                        {src ? t(`budget.costSource.${src}`) : ""}
                        {mk != null && ` · ${t("ui.market")} ${f(mk)}`}
                      </p>
                    </div>
                  );
                }),
              ])}
            />
          )}
          {an.assumptions.notes && <p className="mt-3 text-xs whitespace-pre-line text-muted">{an.assumptions.notes}</p>}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
            {an.assumptions.products.length > 0 && <span>{t("budget.form.products")}: {an.assumptions.products.join("، ")}</span>}
            {an.assumptions.audiences.length > 0 && <span>{t("budget.form.audiences")}: {an.assumptions.audiences.join("، ")}</span>}
            {an.assumptions.regions.length > 0 && <span>{t("budget.form.regions")}: {an.assumptions.regions.join("، ")}</span>}
            <span>{t("budget.form.plannedContent")}: <span className="num">{plan.plannedContent}</span></span>
          </div>
        </CardBody>
      </Card>

      {canEdit && (
        <Card className="no-print">
          <details>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{t("budget.adjustLines")}</summary>
            <div className="border-t border-border px-4">
              <p className="pt-3 text-xs text-muted">{t("budget.adjustLinesHint")}</p>
              <LineEditor currency={cur} campaigns={campaigns} lines={plan.lines.map((l) => ({ id: l.id, label: labels.get(l.id)!, plannedBudget: Number(l.plannedBudget), campaignId: l.campaignId, notes: l.notes, platform: l.platform }))} />
            </div>
          </details>
        </Card>
      )}

      <Card>
        <CardHeader title={t("budget.expensesTitle")} subtitle={t("budget.expensesSubtitle")} meta={<DataMeta source={t("source.MANUAL")} demo={client.isDemo} labels={ctx.metaLabels} />} />
        <CardBody>
          <ExpensesPanel
            clientId={plan.clientId}
            planCurrency={cur}
            currencies={[...new Set([cur, client.currency, ctx.org.currency, ...Object.keys(ctx.fx.rates)])]}
            lines={plan.lines.map((l) => ({ id: l.id, label: labels.get(l.id)! }))}
            canEdit={ctx.can("expenses:edit")}
            defaultDate={isoDay(act.asOf < plan.startDate ? plan.startDate : act.asOf)}
            expenses={act.expenses.map((e) => ({ id: e.id, date: isoDay(e.date), description: e.description, amount: Number(e.amount), currency: e.currency, amountPlan: e.amountPlan, lineLabel: e.planLineId ? (labels.get(e.planLineId) ?? null) : null }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}
