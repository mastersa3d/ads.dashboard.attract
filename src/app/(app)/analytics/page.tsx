import { pageContext, lastMetricSync, metricSources } from "@/lib/page";
import { comparisonRange, filtersToQuery, type Filters, type RawParams } from "@/lib/filters";
import { byDimension, dailySeries, organicSummary, totals } from "@/lib/queries/performance";
import { delta, trendTone, type KpiKey, type Kpis } from "@/lib/metrics";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber, fmtPct, isoDay } from "@/lib/format";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, DemoBadge, EmptyState, PageHeader, SimpleTable, type Tone } from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { RankBarChart, TimeSeriesChart, type ValueFormat } from "@/components/charts/charts";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ui/export-menu";
import { SegmentedLinks } from "@/components/analytics/segmented-links";
import { FunnelView } from "@/components/analytics/funnel";
import { DIMENSIONS, dimensionValueLabel, parseDimension } from "@/components/analytics/dimensions";
import { organicMeta, organicSeries } from "./_lib/queries";

export const metadata = { title: "Performance Analytics" };

/** Metrics selectable for the trend chart (URL param `metric`). */
const TREND_METRICS = { spend: "money", revenue: "money", leads: "number", ctr: "pct", cpm: "money" } as const satisfies Record<string, ValueFormat>;
type TrendMetric = keyof typeof TREND_METRICS;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "analytics:view");
  const { t, locale, filters: f, scope, q, currency } = ctx;

  const metric: TrendMetric = (one(sp.metric) ?? "") in TREND_METRICS ? (one(sp.metric) as TrendMetric) : "spend";
  const dim = parseDimension(one(sp.dim));
  const showPaid = f.mode !== "organic";
  const showOrganic = f.mode !== "paid";

  // Comparison windows: the one chosen in the filter bar drives deltas & the dashed line;
  // the table always shows both previous period and same period last year.
  const cmp = comparisonRange(f);
  const prevRange = comparisonRange({ ...f, compare: "prev" } as Filters)!;
  const yoyRange = comparisonRange({ ...f, compare: "yoy" } as Filters)!;

  const [current, prev, yoy, series, cmpSeries, breakdown, organicNow, organicCmp, orgSeries, orgMeta, updated, source] = await Promise.all([
    totals(f, q),
    totals(f, q, prevRange),
    totals(f, q, yoyRange),
    showPaid ? dailySeries(f, q) : Promise.resolve([]),
    showPaid && cmp ? dailySeries(f, q, cmp) : Promise.resolve([]),
    showPaid ? byDimension(f, q, dim) : Promise.resolve([]),
    organicSummary(f, q),
    cmp ? organicSummary(f, q, cmp) : Promise.resolve(null),
    showOrganic ? organicSeries(f, scope) : Promise.resolve([]),
    organicMeta(f, scope, t),
    lastMetricSync(scope),
    metricSources(scope, t),
  ]);
  const previous = f.compare === "yoy" ? yoy : f.compare === "prev" ? prev : null;

  const money = (n: number | null, digits = 0) => fmtMoney(n, currency, locale, digits);
  const d = (k: KpiKey) => (previous ? delta(current[k] as number | null, previous[k] as number | null) : undefined);
  const tone = (k: KpiKey) => (previous ? trendTone(k, delta(current[k] as number | null, previous[k] as number | null)) : "neutral");
  const cmpLabel = f.compare === "yoy" ? t("ui.previousYear") : f.compare === "prev" ? t("ui.previousPeriod") : t("ui.noComparison");

  const meta = <DataMeta source={source} updated={ctx.rel(updated)} demo={ctx.isDemo} labels={ctx.metaLabels} />;
  const orgMetaEl = (
    <DataMeta source={orgMeta.source} updated={orgMeta.latest ? fmtDate(orgMeta.latest, locale) : null} demo={ctx.isDemo} labels={ctx.metaLabels} />
  );

  // URL helpers keep every global filter plus this page's own view params.
  const base = filtersToQuery(sp);
  const href = (patch: { metric?: string; dim?: string }) => {
    const p = new URLSearchParams(base);
    p.set("metric", patch.metric ?? metric);
    p.set("dim", patch.dim ?? dim);
    return `/analytics?${p.toString()}`;
  };

  // Trend: align comparison days to current days by offset so the dashed line overlays.
  const cmpByDay = new Map(cmpSeries.map((r) => [isoDay(r.date), r]));
  const trendRows = series.map((r) => {
    const row: Record<string, string | number | null> = { date: isoDay(r.date), current: (r[metric] as number | null) ?? null };
    if (cmp) {
      const offset = r.date.getTime() - f.from.getTime();
      const match = cmpByDay.get(isoDay(new Date(cmp.from.getTime() + offset)));
      row.previous = match ? ((match[metric] as number | null) ?? null) : null;
    }
    return row;
  });
  const metricLabel = (m: TrendMetric) => t(`kpi.${m}`);

  const totalSpend = breakdown.reduce((s, r) => s + r.spend, 0);
  const breakdownRows = breakdown
    .map((r) => ({ ...r, label: dimensionValueLabel(dim, r.key, t, locale) }))
    .sort((a, b) => b.spend - a.spend);

  // KPI comparison table rows
  const tableKpis: { key: KpiKey; fmt: (n: number | null) => string }[] = [
    { key: "spend", fmt: (n) => money(n) },
    { key: "revenue", fmt: (n) => money(n) },
    { key: "roas", fmt: (n) => (n == null ? "—" : fmtNumber(n, locale, 2) + "x") },
    { key: "leads", fmt: (n) => fmtNumber(n, locale) },
    { key: "cpl", fmt: (n) => money(n, 2) },
    { key: "purchases", fmt: (n) => fmtNumber(n, locale) },
    { key: "cpa", fmt: (n) => money(n, 2) },
    { key: "cvr", fmt: (n) => fmtPct(n, locale, 2) },
    { key: "impressions", fmt: (n) => fmtNumber(n, locale) },
    { key: "reach", fmt: (n) => fmtNumber(n, locale) },
    { key: "frequency", fmt: (n) => fmtNumber(n, locale, 2) },
    { key: "clicks", fmt: (n) => fmtNumber(n, locale) },
    { key: "ctr", fmt: (n) => fmtPct(n, locale, 2) },
    { key: "cpc", fmt: (n) => money(n, 2) },
    { key: "cpm", fmt: (n) => money(n, 2) },
  ];
  const deltaBadge = (k: KpiKey, a: Kpis, b: Kpis) => {
    const dv = delta(a[k] as number | null, b[k] as number | null);
    const tn = trendTone(k, dv);
    const badgeTone: Tone = tn === "good" ? "good" : tn === "bad" ? "bad" : "neutral";
    return (
      <Badge tone={badgeTone}>
        <span className="num">{dv == null ? "—" : `${dv > 0 ? "+" : ""}${fmtPct(dv, locale, 1)}`}</span>
      </Badge>
    );
  };
  const rangeText = (r: { from: Date; to: Date }) => `${fmtDate(r.from, locale)} – ${fmtDate(r.to, locale)}`;

  const hasPaidData = current.impressions > 0 || current.spend > 0;
  const funnelSteps = [
    { key: "impressions", label: t("kpi.impressions"), value: current.impressions },
    { key: "clicks", label: t("kpi.clicks"), value: current.clicks, rateLabel: t("kpi.ctr"), rate: current.ctr },
    { key: "leads", label: t("kpi.leads"), value: current.leads, rateLabel: t("analytics.clickToLead"), rate: current.clicks ? current.leads / current.clicks : null },
    { key: "purchases", label: t("kpi.purchases"), value: current.purchases, rateLabel: t("analytics.clickToPurchase"), rate: current.clicks ? current.purchases / current.clicks : null },
  ];

  const orgD = (a: number | null | undefined, b: number | null | undefined) => (organicCmp ? delta(a ?? null, b ?? null) : undefined);
  const orgTone = (dv: number | null | undefined): "good" | "bad" | "neutral" => (dv == null || Math.abs(dv) < 0.03 ? "neutral" : dv > 0 ? "good" : "bad");

  return (
    <div id="analytics-root" className="space-y-6">
      <PageHeader
        title={t("analytics.title")}
        description={`${ctx.client?.name ?? t("filter.allClients")} · ${rangeText(f)}${cmp ? ` · ${t("ui.compareTo")}: ${cmpLabel} (${rangeText(cmp)})` : ""}`}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={<ExportMenu dataset="daily" query={ctx.query} targetId="analytics-root" fileName="performance-analytics" />}
      />
      {ctx.fxApplied && <Callout tone="info">{t("dashboard.fxNote", { currency, source: ctx.fx.source ?? "" })}</Callout>}

      {showPaid && (
        <section aria-labelledby="paid-h" className="space-y-4">
          <h2 id="paid-h" className="text-sm font-semibold text-muted">{t("analytics.paidSection")}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard locale={locale} label={t("kpi.spend")} value={money(current.spend)} delta={d("spend")} tone="neutral" />
            <KpiCard locale={locale} label={t("kpi.revenue")} value={money(current.revenue)} delta={d("revenue")} tone={tone("revenue")} />
            <KpiCard locale={locale} label={t("kpi.roas")} value={current.roas == null ? "—" : fmtNumber(current.roas, locale, 2) + "x"} delta={d("roas")} tone={tone("roas")} />
            <KpiCard locale={locale} label={t("kpi.leads")} value={fmtNumber(current.leads, locale)} delta={d("leads")} tone={tone("leads")} />
            <KpiCard locale={locale} label={t("kpi.cpl")} value={money(current.cpl, 2)} delta={d("cpl")} tone={tone("cpl")} />
            <KpiCard locale={locale} label={t("kpi.purchases")} value={fmtNumber(current.purchases, locale)} delta={d("purchases")} tone={tone("purchases")} />
            <KpiCard locale={locale} label={t("kpi.ctr")} value={fmtPct(current.ctr, locale, 2)} delta={d("ctr")} tone={tone("ctr")} />
            <KpiCard locale={locale} label={t("kpi.cpm")} value={money(current.cpm, 2)} delta={d("cpm")} tone={tone("cpm")} />
          </div>
          {previous && <p className="text-[11px] text-subtle">{t("analytics.deltaNote", { period: cmpLabel })}</p>}

          <Card>
            <CardHeader
              title={t("analytics.trendTitle", { metric: metricLabel(metric) })}
              subtitle={cmp ? t("analytics.trendSubtitle", { period: cmpLabel }) : undefined}
              meta={meta}
            />
            <div className="px-4 pt-3">
              <SegmentedLinks
                label={t("analytics.metric")}
                active={metric}
                options={(Object.keys(TREND_METRICS) as TrendMetric[]).map((m) => ({ key: m, label: metricLabel(m), href: href({ metric: m }) }))}
              />
            </div>
            <CardBody>
              {trendRows.length ? (
                <TimeSeriesChart
                  data={trendRows}
                  series={[
                    { key: "current", label: t("analytics.currentPeriod") },
                    ...(cmp ? [{ key: "previous", label: cmpLabel, dashed: true, color: "var(--chart-7)" }] : []),
                  ]}
                  format={TREND_METRICS[metric]}
                  currency={currency}
                />
              ) : (
                <EmptyState title={t("ui.noData")} hint={t("ui.noDataHint")} />
              )}
            </CardBody>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2">
              <CardHeader
                title={t("analytics.breakdownTitle")}
                subtitle={t("analytics.breakdownSubtitle", { metric: metricLabel(metric) })}
                meta={meta}
              />
              <div className="px-4 pt-3">
                <SegmentedLinks
                  label={t("analytics.breakdownBy")}
                  active={dim}
                  options={DIMENSIONS.map((k) => ({ key: k, label: t(`analytics.dim_${k}`), href: href({ dim: k }) }))}
                />
              </div>
              {breakdownRows.length ? (
                <>
                  <CardBody>
                    <RankBarChart
                      data={breakdownRows.slice(0, 10).map((r) => ({ label: r.label, value: (r[metric] as number | null) ?? 0 }))}
                      valueKey="value"
                      format={TREND_METRICS[metric]}
                      currency={currency}
                      colorByIndex
                    />
                  </CardBody>
                  <DataTable
                    searchable={breakdownRows.length > 8}
                    exportName={`breakdown-${dim}`}
                    columns={[
                      { key: "label", label: t(`analytics.dim_${dim}`) },
                      { key: "spend", label: t("kpi.spend"), type: "money", currency },
                      { key: "share", label: t("analytics.share"), type: "pct", hideOnMobile: true },
                      { key: "impressions", label: t("kpi.impressions"), type: "number", hideOnMobile: true },
                      { key: "ctr", label: t("kpi.ctr"), type: "pct", digits: 2 },
                      { key: "cpm", label: t("kpi.cpm"), type: "money", currency, digits: 2, hideOnMobile: true },
                      { key: "leads", label: t("kpi.leads"), type: "number" },
                      { key: "cpl", label: t("kpi.cpl"), type: "money", currency, digits: 2, hideOnMobile: true },
                      { key: "purchases", label: t("kpi.purchases"), type: "number", hideOnMobile: true },
                      { key: "roas", label: t("kpi.roas"), type: "number", digits: 2, hideOnMobile: true },
                    ]}
                    rows={breakdownRows.map((r) => ({
                      _id: r.key ?? "unknown",
                      label: r.label,
                      spend: r.spend,
                      share: totalSpend > 0 ? r.spend / totalSpend : null,
                      impressions: r.impressions,
                      ctr: r.ctr,
                      cpm: r.cpm,
                      leads: r.leads,
                      cpl: r.cpl,
                      purchases: r.purchases,
                      roas: r.roas,
                    }))}
                    initialSort={{ key: "spend", dir: "desc" }}
                  />
                </>
              ) : (
                <EmptyState title={t("ui.noData")} hint={t("analytics.breakdownEmpty")} />
              )}
            </Card>

            <Card className="min-w-0">
              <CardHeader title={t("analytics.funnelTitle")} subtitle={t("analytics.funnelSubtitle")} meta={meta} />
              <CardBody>
                {hasPaidData ? (
                  <FunnelView steps={funnelSteps} locale={locale} overallLabel={t("analytics.funnelOverall")} />
                ) : (
                  <EmptyState title={t("ui.noData")} hint={t("ui.noDataHint")} />
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title={t("analytics.comparisonTitle")} subtitle={t("analytics.comparisonSubtitle")} meta={meta} />
            {hasPaidData || prev.spend > 0 || yoy.spend > 0 ? (
              <SimpleTable
                head={[
                  t("analytics.kpi"),
                  <span key="c">{t("analytics.currentPeriod")}<span className="block text-[10px] font-normal text-subtle">{rangeText(f)}</span></span>,
                  <span key="p">{t("ui.previousPeriod")}<span className="block text-[10px] font-normal text-subtle">{rangeText(prevRange)}</span></span>,
                  t("analytics.change"),
                  <span key="y">{t("ui.previousYear")}<span className="block text-[10px] font-normal text-subtle">{rangeText(yoyRange)}</span></span>,
                  t("analytics.changeYoy"),
                ]}
                rows={tableKpis.map(({ key, fmt }) => [
                  <span key="l" className="whitespace-nowrap font-medium">{t(`kpi.${key}`)}</span>,
                  <span key="c" className="num whitespace-nowrap">{fmt(current[key] as number | null)}</span>,
                  <span key="p" className="num whitespace-nowrap text-muted">{fmt(prev[key] as number | null)}</span>,
                  <span key="pd">{deltaBadge(key, current, prev)}</span>,
                  <span key="y" className="num whitespace-nowrap text-muted">{fmt(yoy[key] as number | null)}</span>,
                  <span key="yd">{deltaBadge(key, current, yoy)}</span>,
                ])}
              />
            ) : (
              <EmptyState title={t("ui.noData")} hint={t("ui.noDataHint")} />
            )}
          </Card>
        </section>
      )}

      {showOrganic && (
        <section aria-labelledby="organic-h" className="space-y-4">
          <h2 id="organic-h" className="text-sm font-semibold text-muted">{t("analytics.organicSection")}</h2>
          {!organicNow || orgSeries.length === 0 ? (
            <Card>
              <EmptyState title={t("analytics.organicEmpty")} hint={t("analytics.organicEmptyHint")} />
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                <KpiCard locale={locale} label={t("kpi.followers")} value={fmtCompact(organicNow.followersEnd, locale)} delta={orgD(organicNow.followersEnd, organicCmp?.followersEnd)} tone={orgTone(orgD(organicNow.followersEnd, organicCmp?.followersEnd))} />
                <KpiCard locale={locale} label={t("kpi.followersGrowth")} value={fmtPct(organicNow.followersGrowth, locale, 2)} footer={<p className="num text-[11px] text-subtle">{`${organicNow.followersEnd - organicNow.followersStart >= 0 ? "+" : ""}${fmtNumber(organicNow.followersEnd - organicNow.followersStart, locale)}`}</p>} />
                <KpiCard locale={locale} label={t("kpi.reach")} value={fmtCompact(organicNow.reach, locale)} delta={orgD(organicNow.reach, organicCmp?.reach)} tone={orgTone(orgD(organicNow.reach, organicCmp?.reach))} />
                <KpiCard locale={locale} label={t("kpi.engagementRate")} value={fmtPct(organicNow.engagementRate, locale, 2)} delta={orgD(organicNow.engagementRate, organicCmp?.engagementRate)} tone={orgTone(orgD(organicNow.engagementRate, organicCmp?.engagementRate))} />
                <KpiCard locale={locale} label={t("analytics.posts")} value={fmtNumber(organicNow.posts, locale)} delta={orgD(organicNow.posts, organicCmp?.posts)} tone="neutral" />
                <KpiCard locale={locale} label={t("kpi.videoViews")} value={fmtCompact(organicNow.videoViews, locale)} delta={orgD(organicNow.videoViews, organicCmp?.videoViews)} tone={orgTone(orgD(organicNow.videoViews, organicCmp?.videoViews))} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title={t("analytics.followersOverTime")} meta={orgMetaEl} />
                  <CardBody>
                    <TimeSeriesChart data={orgSeries} series={[{ key: "followers", label: t("kpi.followers") }]} format="number" />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={t("analytics.reachOverTime")} meta={orgMetaEl} />
                  <CardBody>
                    <TimeSeriesChart area data={orgSeries} series={[{ key: "reach", label: t("kpi.reach"), color: "var(--chart-3)" }]} format="number" />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={t("analytics.erOverTime")} subtitle={t("analytics.erDefinition")} meta={orgMetaEl} />
                  <CardBody>
                    <TimeSeriesChart data={orgSeries} series={[{ key: "engagementRate", label: t("kpi.engagementRate"), color: "var(--chart-2)" }]} format="pct" />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={t("analytics.postsOverTime")} meta={orgMetaEl} />
                  <CardBody>
                    <TimeSeriesChart data={orgSeries} series={[{ key: "posts", label: t("analytics.posts"), color: "var(--chart-6)" }]} format="number" />
                  </CardBody>
                </Card>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
