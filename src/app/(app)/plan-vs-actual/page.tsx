import Link from "next/link";
import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { lastMetricSync, metricSources, pageContext } from "@/lib/page";
import { filtersToQuery, type RawParams } from "@/lib/filters";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber, fmtPct, isoDay, toNum } from "@/lib/format";
import { convert } from "@/lib/fx";
import { forecastSpend, variance, varianceTone } from "@/lib/metrics";
import { byPlatform, dailySeries, plannedBudget, totals } from "@/lib/queries/performance";
import { dailyPlan } from "@/lib/budget/allocation";
import { isMediaLine, planDays, readAssumptions } from "@/lib/budget/plan";
import { driverAnalysis, type PlanTotals } from "@/lib/budget/variance";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, DemoBadge, EmptyState, LinkButton, PageHeader, Progress, SimpleTable, cx } from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { ExportMenu } from "@/components/ui/export-menu";
import { GroupedBarChart, TimeSeriesChart } from "@/components/charts/charts";

export const metadata = { title: "Plan vs Actual" };

const DAY = 86400000;
type Kind = "cost" | "result";

export default async function PlanVsActualPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "budget:view");
  const { t, locale, filters: f, q, scope, currency } = ctx;
  const money = (n: number | null) => fmtMoney(n, currency, locale);
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const actualTo = f.to < today ? f.to : today;

  const [budget, act, platRows, series, expenses, published, updated, source] = await Promise.all([
    plannedBudget(f, q),
    totals(f, q),
    byPlatform(f, q),
    dailySeries(f, q),
    db.expense.findMany({ where: { ...scope, date: { gte: f.from, lte: f.to } }, select: { date: true, amount: true, currency: true } }),
    db.contentItem.count({ where: { ...scope, status: "PUBLISHED", publishAt: { gte: f.from, lt: new Date(f.to.getTime() + DAY) }, ...(f.platforms.length ? { platform: { in: f.platforms } } : {}) } }),
    lastMetricSync(scope),
    metricSources(scope, t),
  ]);

  // ── Planned values pro-rated (linearly) to the selected range, converted to the reporting currency
  const planned: PlanTotals = { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, sales: 0, revenue: 0 };
  let plannedMedia = 0;
  let plannedContent = 0;
  const platPlanned = new Map<Platform, number>();
  const plannedDaily = new Map<string, number>();
  let windowEnd = f.to;
  for (const p of budget.plans) {
    const days = planDays(p.startDate, p.endDate);
    const oStart = Math.max(p.startDate.getTime(), f.from.getTime());
    const oEnd = Math.min(p.endDate.getTime(), f.to.getTime());
    const ratio = Math.max(0, (oEnd - oStart) / DAY + 1) / days;
    const lines = f.platforms.length ? p.lines.filter((l) => !l.platform || f.platforms.includes(l.platform)) : p.lines;
    const cv = (n: number) => convert(n, p.currency, currency, ctx.fx);
    const media = lines.filter(isMediaLine);
    const mediaTotal = cv(media.reduce((s, l) => s + toNum(l.plannedBudget), 0));
    plannedMedia += mediaTotal * ratio;
    for (const l of media) {
      planned.impressions += l.plannedImpressions * ratio;
      planned.reach += l.plannedReach * ratio;
      planned.clicks += l.plannedClicks * ratio;
      planned.leads += l.plannedLeads * ratio;
      planned.sales += l.plannedSales * ratio;
      planned.revenue += cv(toNum(l.plannedRevenue)) * ratio;
      if (l.platform) platPlanned.set(l.platform, (platPlanned.get(l.platform) ?? 0) + cv(toNum(l.plannedBudget)) * ratio);
    }
    plannedContent += p.plannedContent * ratio;
    // Planned daily spend (whole plan, incl. reserves) using the plan's phasing curve, for the forecast chart.
    const total = f.platforms.length ? cv(lines.reduce((s, l) => s + toNum(l.plannedBudget), 0)) : cv(toNum(p.totalBudget));
    for (const d of dailyPlan(p.startDate, p.endDate, total, readAssumptions(p.assumptions).phasing)) {
      const k = isoDay(d.date);
      plannedDaily.set(k, (plannedDaily.get(k) ?? 0) + d.amount);
    }
    if (p.endDate > windowEnd) windowEnd = p.endDate;
  }
  planned.spend = budget.planned;

  const expenseTotal = expenses.reduce((s, e) => s + convert(toNum(e.amount), e.currency, currency, ctx.fx), 0);
  const expenseByDay = new Map<string, number>();
  for (const e of expenses) expenseByDay.set(isoDay(e.date), (expenseByDay.get(isoDay(e.date)) ?? 0) + convert(toNum(e.amount), e.currency, currency, ctx.fx));
  const actualSpend = act.spend + expenseTotal;
  const actual: PlanTotals = { spend: act.spend, impressions: act.impressions, reach: act.reach, clicks: act.clicks, leads: act.leads, sales: act.purchases, revenue: act.revenue };
  const hasPlan = budget.plans.length > 0;

  // ── Variance table
  const ratioOf = (a: number, b: number) => (b > 0 ? a / b : null);
  const rows: { key: string; label: string; planned: number | null; actual: number | null; kind: Kind; fmt: (n: number | null) => string }[] = [
    { key: "spend", label: t("budget.pva.totalSpend"), planned: planned.spend, actual: actualSpend, kind: "cost", fmt: money },
    { key: "leads", label: t("kpi.leads"), planned: planned.leads, actual: act.leads, kind: "result", fmt: (n) => fmtNumber(n, locale) },
    { key: "sales", label: t("kpi.purchases"), planned: planned.sales, actual: act.purchases, kind: "result", fmt: (n) => fmtNumber(n, locale) },
    { key: "revenue", label: t("kpi.revenue"), planned: planned.revenue, actual: act.revenue, kind: "result", fmt: money },
    { key: "cpl", label: t("kpi.cpl"), planned: ratioOf(plannedMedia, planned.leads), actual: act.cpl, kind: "cost", fmt: money },
    { key: "cpa", label: t("kpi.cpa"), planned: ratioOf(plannedMedia, planned.sales), actual: act.cpa, kind: "cost", fmt: money },
    { key: "roas", label: t("kpi.roas"), planned: ratioOf(planned.revenue, plannedMedia), actual: act.roas, kind: "result", fmt: (n) => (n == null ? "—" : `${fmtNumber(n, locale, 2)}x`) },
    { key: "reach", label: t("kpi.reach"), planned: planned.reach, actual: act.reach, kind: "result", fmt: (n) => fmtCompact(n, locale) },
    { key: "impressions", label: t("kpi.impressions"), planned: planned.impressions, actual: act.impressions, kind: "result", fmt: (n) => fmtCompact(n, locale) },
    { key: "content", label: t("budget.pva.content"), planned: plannedContent, actual: published, kind: "result", fmt: (n) => fmtNumber(n, locale) },
  ];
  const tableRows = rows
    .filter((r) => (r.planned ?? 0) > 0 || (r.actual ?? 0) > 0)
    .map((r) => {
      const v = r.planned != null && r.actual != null ? variance(r.planned, r.actual) : { amount: null, pct: null };
      const tone = r.planned ? varianceTone(v.pct, r.kind) : "neutral";
      return { ...r, v, tone };
    });
  const toneCls = { good: "text-good", warning: "text-warn", bad: "text-bad", neutral: "text-muted" } as const;
  const barTone = { good: "good", warning: "warning", bad: "bad", neutral: "neutral" } as const;

  // ── Forecast & burn rate over the window [from, max(to, plan end)]
  const actualDaily = new Map(series.map((s) => [isoDay(s.date), s.spend]));
  const burnSeries: { date: Date; spend: number }[] = [];
  for (let d = f.from.getTime(); d <= actualTo.getTime(); d += DAY) {
    const k = isoDay(new Date(d));
    burnSeries.push({ date: new Date(d), spend: (actualDaily.get(k) ?? 0) + (expenseByDay.get(k) ?? 0) });
  }
  const windowPlanned = [...plannedDaily.entries()].filter(([k]) => k >= isoDay(f.from) && k <= isoDay(windowEnd)).reduce((s, [, v]) => s + v, 0);
  const fc = forecastSpend({ dailySpend: burnSeries, budget: windowPlanned, periodStart: f.from, periodEnd: windowEnd, asOf: actualTo });
  const chart: Record<string, string | number | null>[] = [];
  let cumP = 0;
  let cumA = 0;
  for (let d = f.from.getTime(); d <= windowEnd.getTime(); d += DAY) {
    const k = isoDay(new Date(d));
    cumP += plannedDaily.get(k) ?? 0;
    const isActual = d <= actualTo.getTime();
    if (isActual) cumA += (actualDaily.get(k) ?? 0) + (expenseByDay.get(k) ?? 0);
    const future = d >= actualTo.getTime();
    chart.push({
      date: k,
      planned: hasPlan ? Math.round(cumP) : null,
      actual: isActual ? Math.round(cumA) : null,
      forecast: future ? Math.round(fc.spent + fc.runRate * Math.round((d - actualTo.getTime()) / DAY)) : null,
    });
  }
  const elapsed = burnSeries.length;
  const avgBurn = elapsed ? fc.spent / elapsed : 0;
  const remaining = windowPlanned - fc.spent;
  const daysLeftAtRunRate = fc.runRate > 0 && remaining > 0 ? Math.floor(remaining / fc.runRate) : null;

  // ── Drivers, reasons, corrective actions, alerts
  const plannedForDrivers = { ...planned, spend: plannedMedia };
  const drivers = hasPlan ? driverAnalysis(plannedForDrivers, actual, (n) => fmtPct(n, locale)) : null;
  const alerts = tableRows.filter((r) => r.tone === "bad" && r.v.pct != null);
  const platformChart = [...new Set<Platform>([...platPlanned.keys(), ...platRows.filter((p) => p.spend > 0).map((p) => p.platform)])].map((p) => ({
    label: t(`platform.${p}`),
    planned: Math.round(platPlanned.get(p) ?? 0),
    actual: Math.round(platRows.find((x) => x.platform === p)?.spend ?? 0),
  }));

  const meta = <DataMeta source={source} updated={ctx.rel(updated)} demo={ctx.isDemo} labels={ctx.metaLabels} />;
  const metaEst = <DataMeta source={`${source} · ${t("budget.pva.planSource")}`} updated={ctx.rel(updated)} demo={ctx.isDemo} estimate labels={ctx.metaLabels} />;
  const newHref = `/budget/new?${ctx.query}`;
  const driverFmt = (k: string, n: number | null) => (n == null ? "—" : k === "cpm" || k === "aov" ? money(n) : fmtPct(n, locale, 2));

  return (
    <div id="pva-root" className="space-y-6">
      <PageHeader
        title={t("budget.pva.title")}
        description={`${ctx.client?.name ?? t("filter.allClients")} · ${fmtDate(f.from, locale)} – ${fmtDate(f.to, locale)}`}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={<ExportMenu targetId="pva-root" fileName="plan-vs-actual" />}
      />
      {ctx.fxApplied && <Callout tone="info">{t("budget.fxNote", { currency, source: ctx.fx.source ?? "" })}</Callout>}
      {!hasPlan && (
        <Card>
          <EmptyState title={t("budget.pva.noPlan")} hint={t("budget.pva.noPlanHint")} action={ctx.can("budget:edit") ? <LinkButton href={newHref} variant="primary">{t("budget.newPlan")}</LinkButton> : undefined} />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard locale={locale} label={t("kpi.plannedBudget")} value={hasPlan ? money(planned.spend) : "—"} footer={<p className="text-[11px] text-subtle">{t("budget.pva.prorated")}</p>} />
        <KpiCard locale={locale} label={t("budget.pva.totalSpend")} value={money(actualSpend)} footer={<p className="text-[11px] text-subtle">{t("budget.spendSplit", { media: money(act.spend), other: money(expenseTotal) })}</p>} />
        <KpiCard
          locale={locale}
          label={t("kpi.utilization")}
          value={planned.spend > 0 ? fmtPct(actualSpend / planned.spend, locale) : "—"}
          footer={planned.spend > 0 ? <div className="mt-1"><Progress value={actualSpend / planned.spend} tone={actualSpend > planned.spend * 1.1 ? "bad" : "brand"} /></div> : undefined}
        />
        <KpiCard locale={locale} label={t("budget.pva.burnRate")} value={money(avgBurn)} footer={<p className="text-[11px] text-subtle">{t("budget.pva.runRate7", { amount: money(fc.runRate) })}</p>} />
        <KpiCard
          locale={locale}
          label={t("budget.pva.forecastEnd", { date: fmtDate(windowEnd, locale, { month: "short", day: "numeric" }) })}
          value={money(fc.projected)}
          estimate={t("ui.estimate")}
          footer={hasPlan ? <p className="text-[11px] text-subtle">{t("budget.pva.vsPlanned", { amount: money(windowPlanned) })}</p> : undefined}
        />
        <KpiCard
          locale={locale}
          label={t("budget.pva.runway")}
          value={daysLeftAtRunRate == null ? "—" : t("budget.pva.days", { n: daysLeftAtRunRate })}
          footer={fc.depletionDate ? <p className="text-[11px] text-bad">{t("budget.depletesOn", { date: fmtDate(fc.depletionDate, locale) })}</p> : undefined}
        />
      </div>

      {alerts.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {alerts.map((a) => (
            <Callout key={a.key} tone="bad">
              {t(a.kind === "cost" ? "budget.pva.alertCost" : "budget.pva.alertResult", { metric: a.label, pct: fmtPct(Math.abs(a.v.pct!), locale), planned: a.fmt(a.planned), actual: a.fmt(a.actual) })}
            </Callout>
          ))}
        </div>
      )}

      <Card>
        <CardHeader title={t("budget.pva.varianceTitle")} subtitle={t("budget.pva.varianceSubtitle")} meta={metaEst} />
        <CardBody className="p-0">
          <SimpleTable
            head={[t("budget.pva.metric"), t("budget.planned"), t("ui.actual"), t("budget.variance"), "%", t("budget.pva.progress")]}
            rows={tableRows.map((r) => [
              <span key="l" className="font-medium whitespace-nowrap">{r.label}</span>,
              <span key="p" className="num whitespace-nowrap">{r.planned ? r.fmt(r.planned) : "—"}</span>,
              <span key="a" className="num whitespace-nowrap">{r.fmt(r.actual)}</span>,
              <span key="v" className="num whitespace-nowrap">{r.v.amount == null || !r.planned ? "—" : (r.v.amount > 0 ? "+" : "") + r.fmt(r.v.amount)}</span>,
              <span key="c" className={cx("num font-medium whitespace-nowrap", toneCls[r.tone])}>{r.v.pct == null ? "—" : (r.v.pct > 0 ? "+" : "") + fmtPct(r.v.pct, locale)}</span>,
              <div key="b" className="w-28 sm:w-40">
                <Progress value={r.planned && r.actual != null ? r.actual / r.planned : null} tone={barTone[r.tone]} label={r.label} />
              </div>,
            ])}
          />
          <p className="px-4 py-2 text-[11px] text-subtle">{t("budget.pva.tableNote")}</p>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("budget.pva.forecastTitle")} subtitle={t("budget.pva.forecastSubtitle")} meta={metaEst} />
          <CardBody>
            <TimeSeriesChart
              data={chart}
              series={[
                { key: "planned", label: t("budget.pva.plannedCum") },
                { key: "actual", label: t("budget.pva.actualCum") },
                { key: "forecast", label: t("budget.forecastLine"), dashed: true },
              ]}
              format="money"
              currency={currency}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("budget.pva.byPlatform")} meta={metaEst} />
          <CardBody>
            {platformChart.length ? (
              <GroupedBarChart data={platformChart} series={[{ key: "planned", label: t("budget.planned") }, { key: "actual", label: t("ui.actual") }]} format="money" currency={currency} />
            ) : (
              <EmptyState title={t("ui.noData")} hint={t("ui.noDataHint")} />
            )}
          </CardBody>
        </Card>
      </div>

      {drivers && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t("budget.pva.driversTitle")} subtitle={t("budget.pva.driversSubtitle")} meta={metaEst} />
            <CardBody className="space-y-4">
              <SimpleTable
                head={[t("budget.pva.driver"), t("budget.pva.planAssumption"), t("ui.actual"), t("budget.variance")]}
                rows={drivers.drivers
                  .filter((d) => d.planned != null || d.actual != null)
                  .map((d) => [
                    t(`budget.pva.driverName.${d.key}`),
                    <span key="p" className="num">{driverFmt(d.key, d.planned)}</span>,
                    <span key="a" className="num">{driverFmt(d.key, d.actual)}</span>,
                    <span key="d" className={cx("num font-medium", d.tone === "good" ? "text-good" : d.tone === "bad" ? "text-bad" : "text-muted")}>
                      {d.delta == null ? "—" : (d.delta > 0 ? "+" : "") + fmtPct(d.delta, locale)}
                    </span>,
                  ])}
              />
              <div>
                <h4 className="mb-2 text-xs font-semibold text-muted">{t("budget.pva.reasons")}</h4>
                <ul className="space-y-1.5 text-sm">
                  {drivers.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className={cx("mt-2 size-1.5 shrink-0 rounded-full", r.tone === "good" ? "bg-good" : r.tone === "bad" ? "bg-bad" : "bg-warn")} aria-hidden />
                      {t(r.key, r.vars)}
                    </li>
                  ))}
                </ul>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("budget.pva.actionsTitle")} subtitle={t("budget.pva.actionsSubtitle")} meta={meta} />
            <CardBody>
              {drivers.actions.length === 0 ? (
                <EmptyState title={t("budget.pva.noActions")} />
              ) : (
                <ol className="list-decimal space-y-2 ps-5 text-sm marker:text-subtle">
                  {drivers.actions.map((a, i) => (
                    <li key={i}>
                      {t(a.key)} <Badge tone="brand">{t("ui.recommendation")}</Badge>
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-4 border-t border-border pt-3">
                <h4 className="mb-2 text-xs font-semibold text-muted">{t("budget.pva.plansInRange")}</h4>
                <ul className="space-y-1 text-sm">
                  {budget.plans.map((p) => (
                    <li key={p.id}>
                      <Link className="text-brand hover:underline" href={`/budget/${p.id}?${filtersToQuery(sp, { client: p.clientId })}`}>
                        {p.name}
                      </Link>{" "}
                      <span className="text-xs text-subtle">
                        {fmtDate(p.startDate, locale)} – {fmtDate(p.endDate, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
