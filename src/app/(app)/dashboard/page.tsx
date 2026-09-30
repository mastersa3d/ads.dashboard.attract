import Link from "next/link";
import { db } from "@/lib/db";
import { pageContext, lastMetricSync, metricSources } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { totalsWithComparison, dailySeries, byPlatform, byEntity, organicSummary, plannedBudget, toChartRows } from "@/lib/queries/performance";
import { benchmarksFor } from "@/lib/queries/benchmarks";
import { delta, forecastSpend, trendTone, type Kpis, type KpiKey } from "@/lib/metrics";
import { fmtMoney, fmtNumber, fmtPct, fmtCompact, fmtDate, toNum } from "@/lib/format";
import { buildExecutiveSummary } from "@/lib/ai/insights";
import { convert } from "@/lib/fx";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, DemoBadge, PageHeader, Progress, LinkButton, EmptyState } from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { TimeSeriesChart, DonutChart } from "@/components/charts/charts";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ui/export-menu";
import { SummaryCard } from "@/components/dashboard/summary-card";

export const metadata = { title: "Executive Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "dashboard:view");
  const { t, locale, filters: f, scope, q, currency } = ctx;

  const [{ current: c, previous: p }, series, platforms, campaigns, ads, organic, budget, updated, source] = await Promise.all([
    totalsWithComparison(f, q),
    dailySeries(f, q),
    byPlatform(f, q),
    byEntity(f, q, "campaign"),
    byEntity(f, q, "ad"),
    organicSummary(f, q),
    plannedBudget(f, q),
    lastMetricSync(scope),
    metricSources(scope, t),
  ]);
  const clientMeta = ctx.client ? await db.client.findUnique({ where: { id: ctx.client.id }, select: { country: true, industry: true } }) : null;
  const benchmarks = await benchmarksFor({ organizationId: ctx.user.organizationId, platforms: f.platforms, country: clientMeta?.country, industry: clientMeta?.industry });

  // Forecast to the end of the plan period (or the selected range)
  const periodStart = budget.periodStart ?? f.from;
  const periodEnd = budget.periodEnd ?? f.to;
  const forecastSeries = budget.plans.length ? await dailySeries(f, q, { from: periodStart, to: f.to < periodEnd ? f.to : periodEnd }) : series;
  const fc = forecastSpend({
    dailySpend: forecastSeries.map((s) => ({ date: s.date, spend: s.spend })),
    budget: budget.fullPeriod,
    periodStart,
    periodEnd,
    asOf: f.to < periodEnd ? f.to : periodEnd,
  });

  // Targets from the budget plan (prorated), market from benchmarks
  const lines = budget.plans.flatMap((pl) => pl.lines);
  const ratio = budget.fullPeriod > 0 ? budget.planned / budget.fullPeriod : 0;
  const target = {
    leads: lines.reduce((s, l) => s + l.plannedLeads, 0) * ratio,
    purchases: lines.reduce((s, l) => s + l.plannedSales, 0) * ratio,
    revenue: lines.reduce((s, l) => s + toNum(l.plannedRevenue), 0) * ratio,
    reach: lines.reduce((s, l) => s + l.plannedReach, 0) * ratio,
    impressions: lines.reduce((s, l) => s + l.plannedImpressions, 0) * ratio,
  };
  // Money benchmarks are converted from their own currency into the reporting currency.
  const MONEY = ["CPM", "CPC", "CPL", "CPA"];
  const bm = (m: string) => {
    const b = benchmarks.find((x) => x.metric === m);
    return b && MONEY.includes(m) ? { ...b, median: convert(b.median, b.currency ?? ctx.org.currency, currency, ctx.fx) } : b;
  };

  const money = (n: number | null) => fmtMoney(n, currency, locale);
  const tone = (k: KpiKey) => (p ? trendTone(k, delta(c[k] as number | null, p[k] as number | null)) : "neutral");
  const d = (k: KpiKey) => (p ? delta(c[k] as number | null, p[k] as number | null) : undefined);
  const vsTarget = (actual: number, tgt: number, fmt: (n: number) => string) =>
    tgt > 0 ? { label: t("dashboard.vsTarget"), value: fmt(tgt), tone: actual >= tgt * 0.95 ? ("good" as const) : actual >= tgt * 0.8 ? ("warning" as const) : ("bad" as const) } : undefined;
  const vsMarket = (metric: string, v: number | null, fmt: (n: number) => string) => {
    const b = bm(metric);
    if (!b || v == null) return undefined;
    const better = b.higherIsBetter ? v >= b.median : v <= b.median;
    return { label: t("dashboard.vsMarket"), value: fmt(b.median), tone: better ? ("good" as const) : ("bad" as const) };
  };

  const remaining = budget.planned - c.spend;
  const utilization = budget.planned > 0 ? c.spend / budget.planned : null;
  const utilTone = utilization == null ? "neutral" : utilization > 1.1 ? "bad" : utilization < 0.85 ? "warning" : "good";

  const eff = (x: Kpis) => x.roas ?? (x.cpl ? 1 / x.cpl : null) ?? (x.cpa ? 1 / x.cpa : null) ?? x.ctr ?? 0;
  const rankedCampaigns = campaigns.filter((x) => x.spend > 0).sort((a, b) => (eff(b) ?? 0) - (eff(a) ?? 0));
  const rankedPlatforms = platforms.filter((x) => x.spend > 0).sort((a, b) => (eff(b) ?? 0) - (eff(a) ?? 0));
  const bestAd = ads.filter((x) => x.spend > c.spend * 0.01).sort((a, b) => (eff(b) ?? 0) - (eff(a) ?? 0))[0];
  const formatPerf = new Map<string, Kpis[]>();
  for (const a of ads) if (a.format) formatPerf.set(a.format, [...(formatPerf.get(a.format) ?? []), a]);
  const bestFormat = [...formatPerf.entries()]
    .map(([k, xs]) => ({ k, ctr: xs.reduce((s, x) => s + x.clicks, 0) / Math.max(1, xs.reduce((s, x) => s + x.impressions, 0)) }))
    .sort((a, b) => b.ctr - a.ctr)[0];

  const summary = buildExecutiveSummary(
    {
      current: c,
      previous: p,
      planned: budget.planned,
      fullBudget: budget.fullPeriod,
      forecast: budget.fullPeriod > 0 ? fc : null,
      platforms,
      campaigns,
      followersGrowth: organic?.followersGrowth ?? null,
      benchmarks: benchmarks.map((b) => ({ metric: b.metric, median: bm(b.metric)!.median, higherIsBetter: b.higherIsBetter })),
      currency,
      source,
    },
    t,
    locale,
  );

  const meta = <DataMeta source={source} updated={ctx.rel(updated)} demo={ctx.isDemo} labels={ctx.metaLabels} />;
  const hasRevenue = c.revenue > 0;

  return (
    <div id="dashboard-root" className="space-y-6">
      {sp.denied && <Callout tone="bad">{t("dashboard.deniedBanner", { perm: String(sp.denied) })}</Callout>}
      <PageHeader
        title={t("dashboard.title")}
        description={`${ctx.client?.name ?? t("filter.allClients")} · ${fmtDate(f.from, locale)} – ${fmtDate(f.to, locale)}`}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={<ExportMenu dataset="campaigns" query={ctx.query} targetId="dashboard-root" fileName="executive-dashboard" />}
      />
      {ctx.isDemo && <Callout tone="demo">{t("dashboard.demoBanner")}</Callout>}
      {ctx.fxApplied && <Callout tone="info">{t("dashboard.fxNote", { currency, source: ctx.fx.source ?? "" })}</Callout>}

      {/* Budget */}
      <section aria-labelledby="budget-h" className="space-y-3">
        <h2 id="budget-h" className="text-sm font-semibold text-muted">{t("dashboard.budgetSection")}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiCard locale={locale} label={t("kpi.plannedBudget")} value={budget.planned > 0 ? money(budget.planned) : "—"} hint={t("dashboard.noPlan")} />
          <KpiCard locale={locale} label={t("kpi.spend")} value={money(c.spend)} delta={d("spend")} tone="neutral" />
          <KpiCard locale={locale} label={t("kpi.remaining")} value={budget.planned > 0 ? money(remaining) : "—"} />
          <KpiCard
            locale={locale}
            label={t("kpi.utilization")}
            value={utilization == null ? "—" : fmtPct(utilization, locale)}
            footer={utilization != null ? <div className="mt-1"><Progress value={utilization} tone={utilTone} label={t("kpi.utilization")} /></div> : undefined}
          />
          <KpiCard
            locale={locale}
            label={t("kpi.forecast")}
            value={budget.fullPeriod > 0 ? money(fc.projected) : "—"}
            estimate={t("ui.estimate")}
            footer={
              budget.fullPeriod > 0 ? (
                <p className="text-[11px] text-subtle">
                  {t("dashboard.pacing")}: <span className="num">{fmtPct(fc.pacing, locale)}</span>
                  {fc.depletionDate && <> · {fmtDate(fc.depletionDate, locale)}</>}
                </p>
              ) : (
                <Link href="/budget" className="text-[11px] text-brand hover:underline">{t("dashboard.createPlan")}</Link>
              )
            }
          />
        </div>
      </section>

      {/* Results */}
      <section aria-labelledby="results-h" className="space-y-3">
        <h2 id="results-h" className="text-sm font-semibold text-muted">{t("dashboard.resultsSection")}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
          <KpiCard locale={locale} label={t("kpi.revenue")} value={money(c.revenue)} delta={d("revenue")} tone={tone("revenue")} target={vsTarget(c.revenue, target.revenue, money)} />
          <KpiCard locale={locale} label={t("kpi.roas")} value={c.roas == null ? "—" : fmtNumber(c.roas, locale, 2) + "x"} delta={d("roas")} tone={tone("roas")} market={vsMarket("ROAS", c.roas, (n) => fmtNumber(n, locale, 1) + "x")} />
          <KpiCard locale={locale} label={t("kpi.roi")} value={fmtPct(c.roi, locale)} delta={d("roi")} tone={tone("roi")} />
          <KpiCard locale={locale} label={t("kpi.leads")} value={fmtNumber(c.leads, locale)} delta={d("leads")} tone={tone("leads")} target={vsTarget(c.leads, target.leads, (n) => fmtNumber(n, locale))} />
          <KpiCard locale={locale} label={t("kpi.purchases")} value={fmtNumber(c.purchases, locale)} delta={d("purchases")} tone={tone("purchases")} target={vsTarget(c.purchases, target.purchases, (n) => fmtNumber(n, locale))} />
          <KpiCard locale={locale} label={t("kpi.cvr")} value={fmtPct(c.cvr, locale, 2)} delta={d("cvr")} tone={tone("cvr")} market={vsMarket("CVR", c.cvr, (n) => fmtPct(n, locale))} />
          <KpiCard locale={locale} label={t("kpi.cpl")} value={money(c.cpl)} delta={d("cpl")} tone={tone("cpl")} market={vsMarket("CPL", c.cpl, money)} />
        </div>
      </section>

      {/* Efficiency & reach */}
      <section aria-labelledby="eff-h" className="space-y-3">
        <h2 id="eff-h" className="text-sm font-semibold text-muted">{t("dashboard.efficiencySection")} · {t("dashboard.reachSection")}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
          <KpiCard locale={locale} label={t("kpi.cpa")} value={money(c.cpa)} delta={d("cpa")} tone={tone("cpa")} market={vsMarket("CPA", c.cpa, money)} />
          <KpiCard locale={locale} label={t("kpi.cpm")} value={money(c.cpm)} delta={d("cpm")} tone={tone("cpm")} market={vsMarket("CPM", c.cpm, money)} />
          <KpiCard locale={locale} label={t("kpi.cpc")} value={fmtMoney(c.cpc, currency, locale, 2)} delta={d("cpc")} tone={tone("cpc")} market={vsMarket("CPC", c.cpc, (n) => fmtMoney(n, currency, locale, 2))} />
          <KpiCard locale={locale} label={t("kpi.ctr")} value={fmtPct(c.ctr, locale, 2)} delta={d("ctr")} tone={tone("ctr")} market={vsMarket("CTR", c.ctr, (n) => fmtPct(n, locale, 2))} />
          <KpiCard locale={locale} label={t("kpi.reach")} value={fmtCompact(c.reach, locale)} delta={d("reach")} tone={tone("reach")} target={vsTarget(c.reach, target.reach, (n) => fmtCompact(n, locale))} />
          <KpiCard locale={locale} label={t("kpi.impressions")} value={fmtCompact(c.impressions, locale)} delta={d("impressions")} tone={tone("impressions")} target={vsTarget(c.impressions, target.impressions, (n) => fmtCompact(n, locale))} />
          <KpiCard locale={locale} label={t("kpi.frequency")} value={fmtNumber(c.frequency, locale, 2)} delta={d("frequency")} tone={tone("frequency")} market={vsMarket("FREQ", c.frequency, (n) => fmtNumber(n, locale, 1))} />
          <KpiCard locale={locale} label={t("kpi.videoViews")} value={fmtCompact(c.videoViews, locale)} delta={d("videoViews")} tone={tone("videoViews")} />
          <KpiCard locale={locale} label={t("kpi.engagementRate")} value={fmtPct(organic?.engagementRate ?? c.engagementRate, locale, 2)} delta={d("engagementRate")} tone={tone("engagementRate")} market={vsMarket("ER", organic?.engagementRate ?? c.engagementRate, (n) => fmtPct(n, locale, 1))} />
          <KpiCard locale={locale} label={t("kpi.followersGrowth")} value={organic?.followersGrowth == null ? "—" : fmtPct(organic.followersGrowth, locale, 2)} footer={organic ? <p className="num text-[11px] text-subtle">{fmtCompact(organic.followersEnd, locale)} {t("kpi.followers")}</p> : undefined} />
        </div>
      </section>

      <SummaryCard summary={summary} t={t} meta={meta} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={hasRevenue ? t("dashboard.trend") : t("dashboard.trendLeads")} meta={meta} />
          <CardBody>
            {hasRevenue ? (
              <TimeSeriesChart area data={toChartRows(series, ["spend", "revenue"])} series={[{ key: "spend", label: t("kpi.spend") }, { key: "revenue", label: t("kpi.revenue") }]} format="money" currency={currency} />
            ) : (
              <TimeSeriesChart data={toChartRows(series, ["spend"])} series={[{ key: "spend", label: t("kpi.spend") }]} format="money" currency={currency} />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("dashboard.platformShare")} meta={meta} />
          <CardBody>
            <DonutChart data={platforms.sort((a, b) => b.spend - a.spend).map((x) => ({ label: t(`platform.${x.platform}`), value: Math.round(x.spend) }))} format="money" currency={currency} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("dashboard.highlights")} subtitle={t("dashboard.efficiencyNote")} meta={meta} />
        <CardBody>
          {rankedCampaigns.length === 0 ? (
            <EmptyState title={t("ui.noData")} hint={t("ui.noDataHint")} />
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                [t("dashboard.bestCampaign"), rankedCampaigns[0]?.name, "good"],
                [t("dashboard.worstCampaign"), rankedCampaigns.at(-1)?.name, "bad"],
                [t("dashboard.bestPlatform"), rankedPlatforms[0] && t(`platform.${rankedPlatforms[0].platform}`), "good"],
                [t("dashboard.worstPlatform"), rankedPlatforms.length > 1 ? t(`platform.${rankedPlatforms.at(-1)!.platform}`) : null, "bad"],
                [t("dashboard.bestAd"), bestAd?.name, "good"],
                [t("dashboard.bestContentType"), bestFormat && t(`contentType.${bestFormat.k}`), "info"],
              ].map(([label, value, tn]) => (
                <div key={label as string} className="rounded-lg border border-border p-3">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-1 flex items-center gap-2 text-sm font-medium">
                    <Badge tone={tn as "good" | "bad" | "info"}>{tn === "good" ? t("tone.good") : tn === "bad" ? t("tone.bad") : t("tone.info")}</Badge>
                    <span className="truncate">{value ?? "—"}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("dashboard.byPlatform")} meta={meta} actions={<LinkButton href={`/analytics?${ctx.query}`} size="sm">{t("ui.drillDown")}</LinkButton>} />
        <DataTable
          exportName="platforms"
          searchable={false}
          columns={[
            { key: "platform", label: t("filter.platform") },
            { key: "spend", label: t("kpi.spend"), type: "money", currency },
            { key: "revenue", label: t("kpi.revenue"), type: "money", currency, hideOnMobile: true },
            { key: "roas", label: t("kpi.roas"), type: "number", digits: 2 },
            { key: "leads", label: t("kpi.leads"), type: "number" },
            { key: "cpl", label: t("kpi.cpl"), type: "money", currency, hideOnMobile: true },
            { key: "ctr", label: t("kpi.ctr"), type: "pct", digits: 2, hideOnMobile: true },
            { key: "cpm", label: t("kpi.cpm"), type: "money", currency, hideOnMobile: true },
          ]}
          rows={platforms.map((x) => ({ _id: x.platform, platform: t(`platform.${x.platform}`), spend: x.spend, revenue: x.revenue, roas: x.roas, leads: x.leads, cpl: x.cpl, ctr: x.ctr, cpm: x.cpm }))}
          initialSort={{ key: "spend", dir: "desc" }}
        />
      </Card>

      <Card>
        <CardHeader title={t("dashboard.campaigns")} meta={meta} actions={<LinkButton href={`/campaigns?${ctx.query}`} size="sm">{t("ui.drillDown")}</LinkButton>} />
        <DataTable
          exportName="campaigns"
          columns={[
            { key: "name", label: t("filter.campaign") },
            { key: "platform", label: t("filter.platform"), hideOnMobile: true },
            { key: "spend", label: t("kpi.spend"), type: "money", currency },
            { key: "roas", label: t("kpi.roas"), type: "number", digits: 2 },
            { key: "leads", label: t("kpi.leads"), type: "number", hideOnMobile: true },
            { key: "purchases", label: t("kpi.purchases"), type: "number", hideOnMobile: true },
            { key: "ctr", label: t("kpi.ctr"), type: "pct", digits: 2 },
            { key: "frequency", label: t("kpi.frequency"), type: "number", digits: 2, hideOnMobile: true },
          ]}
          rows={campaigns.map((x) => ({
            _id: x.id,
            name: { v: x.name, d: <Link className="text-brand hover:underline" href={`/campaigns?${ctx.query}&campaign=${x.id}`}>{x.name}</Link> },
            platform: x.platform ? t(`platform.${x.platform}`) : "",
            spend: x.spend,
            roas: x.roas,
            leads: x.leads,
            purchases: x.purchases,
            ctr: x.ctr,
            frequency: { v: x.frequency, d: <span className={(x.frequency ?? 0) > 3.5 ? "font-semibold text-warn" : ""}>{fmtNumber(x.frequency, locale, 2)}</span> },
          }))}
          initialSort={{ key: "spend", dir: "desc" }}
        />
      </Card>
    </div>
  );
}

