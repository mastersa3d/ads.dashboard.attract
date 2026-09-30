import Link from "next/link";
import type { Platform } from "@prisma/client";
import { ChevronRight, ExternalLink, X } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext, lastMetricSync, metricSources } from "@/lib/page";
import { filtersToQuery, type FilterKey, type RawParams } from "@/lib/filters";
import { byEntity, dailySeries, toChartRows } from "@/lib/queries/performance";
import { EMPTY_TOTALS, deriveKpis, type Kpis } from "@/lib/metrics";
import { convert } from "@/lib/fx";
import { fmtDate, fmtMoney, fmtNumber, fmtPct } from "@/lib/format";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, DemoBadge, EmptyState, LinkButton, PageHeader, Stat, type Tone } from "@/components/ui/primitives";
import { DataTable, type Row } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ui/export-menu";
import { TimeSeriesChart } from "@/components/charts/charts";
import { Breadcrumb } from "@/components/analytics/breadcrumb";
import { FREQUENCY_WARNING, rowHealth, type Health, type HealthReason } from "@/components/analytics/health";
import { pickBenchmark } from "@/components/benchmarks/model";
import { byAccount, childEntities, drillPath } from "./_lib/queries";

export const metadata = { title: "Campaigns" };

type Level = "account" | "campaign" | "adSet" | "ad";
type DrillRow = Kpis & { id: string; name: string; platform?: Platform | null; status?: string | null; format?: string | null };

const STATUS_TONE: Record<string, Tone> = { ACTIVE: "good", PAUSED: "warning", COMPLETED: "neutral", DRAFT: "neutral", ARCHIVED: "neutral" };
const HEALTH_TONE: Record<Health, Tone> = { good: "good", warning: "warning", bad: "bad", idle: "neutral" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "campaigns:view");
  const { t, locale, filters: f, scope, q, currency } = ctx;

  // Resolve (and tenant-check) every id in the drill path; parents are inferred from children.
  const drill = await drillPath(scope, { account: f.accountId, campaign: f.campaignId, adset: f.adSetId, ad: f.adId });
  const missing = (f.accountId && !drill.account) || (f.campaignId && !drill.campaign) || (f.adSetId && !drill.adSet) || (f.adId && !drill.ad);
  const campaignId = drill.campaign?.id ?? (drill.adSet ? drill.adSet.campaignId : undefined);
  const parents = await drillPath(scope, { campaign: !drill.campaign ? campaignId : undefined });
  const campaign = drill.campaign ?? parents.campaign;
  const accountId = drill.account?.id ?? campaign?.accountId;
  const account = drill.account ?? (accountId ? (await drillPath(scope, { account: accountId })).account : null);

  const level: Level = drill.adSet ? "ad" : campaign ? "adSet" : account ? "campaign" : "account";

  // Links keep every global filter and replace only the drill keys.
  const link = (o: { account?: string | null; campaign?: string | null; adset?: string | null; ad?: string | null }) => {
    const overrides: Partial<Record<FilterKey, string | null>> = { account: o.account ?? null, campaign: o.campaign ?? null, adset: o.adset ?? null, ad: o.ad ?? null };
    const qs = filtersToQuery(sp, overrides);
    return `/campaigns${qs ? `?${qs}` : ""}`;
  };

  const header = (
    <PageHeader
      title={t("analytics.camp_title")}
      description={`${ctx.client?.name ?? t("filter.allClients")} · ${fmtDate(f.from, locale)} – ${fmtDate(f.to, locale)} · ${t("analytics.camp_subtitle")}`}
      badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
      actions={
        <ExportMenu
          dataset={level === "ad" ? "ads" : level === "adSet" ? "adsets" : "campaigns"}
          query={ctx.query}
          targetId="campaigns-root"
          fileName={`campaigns-${level}`}
        />
      }
    />
  );

  if (missing) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <EmptyState title={t("analytics.camp_notFound")} action={<LinkButton href={link({})}>{t("analytics.camp_backToAll")}</LinkButton>} />
        </Card>
      </div>
    );
  }

  // Metric queries: the table lists every child of the current node, so the `ad` selection
  // (detail panel) must not narrow the ad table itself.
  const tableFilters = { ...f, adId: undefined, accountId: account?.id, campaignId: campaign?.id, adSetId: drill.adSet?.id };
  const entityLevel = level === "account" ? null : level;
  const [metricRows, catalogue, updated, source] = await Promise.all([
    level === "account" ? byAccount(tableFilters, q) : byEntity(tableFilters, q, entityLevel as "campaign" | "adSet" | "ad"),
    level === "account" ? Promise.resolve([]) : childEntities(entityLevel as "campaign" | "adSet" | "ad", scope, f, level === "campaign" ? account?.id : level === "adSet" ? campaign?.id : drill.adSet?.id),
    lastMetricSync(scope),
    metricSources(scope, t),
  ]);

  // Merge catalogue (entities with no delivery) with metric rows.
  const byId = new Map<string, DrillRow>(metricRows.map((r) => [r.id, r as DrillRow]));
  for (const c of catalogue) {
    const existing = byId.get(c.id);
    if (existing) byId.set(c.id, { ...existing, platform: existing.platform ?? c.platform, status: existing.status ?? c.status });
    else if (f.mode !== "organic") byId.set(c.id, { id: c.id, name: c.name, platform: c.platform, status: c.status, format: "format" in c ? ((c.format as string | null) ?? null) : null, ...deriveKpis({ ...EMPTY_TOTALS }) });
  }
  const rows = [...byId.values()].sort((a, b) => b.spend - a.spend);

  // Market medians per platform. Benchmarks are market-specific, so they are only applied when a
  // single client is selected (its country / industry pick the benchmark); monetary benchmarks are
  // stored in the organization's currency and converted here.
  const profile = ctx.client ? await db.client.findUnique({ where: { id: ctx.client.id }, select: { country: true, industry: true } }) : null;
  const platforms = [...new Set(rows.map((r) => r.platform).filter((p): p is Platform => Boolean(p)))];
  const bmRows = profile
    ? await db.benchmark.findMany({ where: { OR: [{ organizationId: null }, { organizationId: ctx.user.organizationId }], metric: { in: ["CPL", "CTR"] }, platform: { in: platforms } } })
    : [];
  const bmByPlatform = new Map<string, { cpl: number | null; ctr: number | null; source: string; asOf: Date } | null>();
  for (const p of platforms) {
    const criteria = { platform: p, country: profile?.country, industry: profile?.industry };
    const cpl = pickBenchmark(bmRows, "CPL", criteria);
    const ctr = pickBenchmark(bmRows, "CTR", criteria);
    const any = cpl ?? ctr;
    bmByPlatform.set(p, any ? { cpl: cpl ? convert(cpl.median, ctx.org.currency, currency, ctx.fx) : null, ctr: ctr?.median ?? null, source: any.sourceName, asOf: any.asOf } : null);
  }
  const marketFor = (p?: Platform | null) => (p ? (bmByPlatform.get(p) ?? null) : null);
  const bmUsed = [...bmByPlatform.values()].find(Boolean);

  const money = (n: number | null, digits = 0) => fmtMoney(n, currency, locale, digits);
  const reasonText = (r: HealthReason) => {
    switch (r.key) {
      case "cpl":
        return t("analytics.camp_reason_cpl", { value: money(r.value ?? null, 2), median: money(r.median ?? null, 2) });
      case "ctr":
        return t("analytics.camp_reason_ctr", { value: fmtPct(r.value, locale, 2), median: fmtPct(r.median, locale, 2) });
      case "freq":
        return t("analytics.camp_reason_freq", { value: fmtNumber(r.value, locale, 2) });
      case "roas":
        return t("analytics.camp_reason_roas");
      default:
        return t("analytics.camp_reason_ok");
    }
  };

  const childLink = (r: DrillRow) =>
    level === "account"
      ? link({ account: r.id })
      : level === "campaign"
        ? link({ account: account?.id, campaign: r.id })
        : level === "adSet"
          ? link({ account: account?.id, campaign: campaign?.id, adset: r.id })
          : link({ account: account?.id, campaign: campaign?.id, adset: drill.adSet?.id, ad: r.id }) + "#ad-detail";

  const tableRows: Row[] = rows.map((r) => {
    const market = marketFor(r.platform);
    const h = rowHealth(r, { cpl: market?.cpl, ctr: market?.ctr });
    const reasons = h.reasons.map(reasonText).join(" · ");
    const cplBad = r.cpl != null && market?.cpl != null && r.cpl > market.cpl;
    const freqHigh = (r.frequency ?? 0) > FREQUENCY_WARNING;
    const selected = level === "ad" && drill.ad?.id === r.id;
    return {
      _id: r.id,
      name: {
        v: r.name,
        d: (
          <Link href={childLink(r)} scroll={level === "ad"} className="group inline-flex max-w-72 items-center gap-1 font-medium text-brand hover:underline" aria-current={selected ? "true" : undefined}>
            <span className="truncate" title={r.name}>{r.name}</span>
            <ChevronRight className="size-3.5 shrink-0 opacity-50 group-hover:opacity-100 flip-rtl" aria-hidden />
          </Link>
        ),
      },
      platform: r.platform ? t(`platform.${r.platform}`) : null,
      status: r.status ? { v: r.status, d: <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{t(`campaignStatus.${r.status}`)}</Badge> } : null,
      format: r.format ? t(`contentType.${r.format}`) : null,
      health: {
        v: h.health === "bad" ? 0 : h.health === "warning" ? 1 : h.health === "good" ? 2 : 3,
        d: (
          <span className="inline-flex flex-col items-start gap-0.5">
            <Badge tone={HEALTH_TONE[h.health]} title={reasons}>
              {t(`analytics.camp_health_${h.health}`)}
            </Badge>
            {h.health !== "good" && h.health !== "idle" && <span className="text-[11px] leading-snug text-muted">{h.reasons.map((x) => t(`analytics.camp_short_${x.key}`)).join(" · ")}</span>}
          </span>
        ),
      },
      spend: r.spend,
      results: r.conversions,
      cpl: { v: r.cpl, d: <span className={cplBad ? "font-semibold text-bad" : undefined}>{money(r.cpl, 2)}</span> },
      cpa: r.cpa,
      roas: { v: r.revenue > 0 ? r.roas : null, d: r.roas == null || r.revenue <= 0 ? <span className="text-subtle">—</span> : <span className={r.revenue > 0 && r.roas < 1 ? "font-semibold text-bad" : undefined}>{fmtNumber(r.roas, locale, 2)}x</span> },
      ctr: r.ctr,
      cpm: r.cpm,
      frequency: { v: r.frequency, d: <span className={freqHigh ? "rounded bg-warn-soft px-1 font-semibold text-warn" : undefined}>{fmtNumber(r.frequency, locale, 2)}</span> },
    };
  });

  // Ad detail panel
  const adRow = level === "ad" && drill.ad ? (rows.find((r) => r.id === drill.ad!.id) ?? null) : null;
  const adSeries = drill.ad ? await dailySeries({ ...tableFilters, adId: drill.ad.id }, q) : [];

  const crumbs = [
    { label: t("analytics.camp_allAccounts"), href: link({}) },
    ...(account ? [{ label: account.name, href: link({ account: account.id }), hint: t(`platform.${account.platform}`) }] : []),
    ...(campaign ? [{ label: campaign.name, href: link({ account: account?.id, campaign: campaign.id }) }] : []),
    ...(drill.adSet ? [{ label: drill.adSet.name, href: link({ account: account?.id, campaign: campaign?.id, adset: drill.adSet.id }) }] : []),
    ...(drill.ad ? [{ label: drill.ad.name }] : []),
  ];

  const meta = <DataMeta source={source} updated={ctx.rel(updated)} demo={ctx.isDemo} labels={ctx.metaLabels} />;
  const totals = rows.reduce(
    (acc, r) => ({ spend: acc.spend + r.spend, conversions: acc.conversions + r.conversions, active: acc.active + (r.status === "ACTIVE" ? 1 : 0) }),
    { spend: 0, conversions: 0, active: 0 },
  );

  return (
    <div id="campaigns-root" className="space-y-5">
      {header}
      {ctx.fxApplied && <Callout tone="info">{t("dashboard.fxNote", { currency, source: ctx.fx.source ?? "" })}</Callout>}
      {f.mode === "organic" && <Callout tone="warning">{t("analytics.camp_organicMode")}</Callout>}

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Breadcrumb items={crumbs} label={t("analytics.camp_breadcrumb")} />
          <div className="grid grid-cols-3 gap-4 sm:flex sm:gap-6">
            <Stat label={t(`analytics.camp_level_${level}`)} value={fmtNumber(rows.length, locale)} />
            <Stat label={t("kpi.spend")} value={money(totals.spend)} />
            <Stat label={t("analytics.camp_results")} value={fmtNumber(totals.conversions, locale)} />
          </div>
        </CardBody>
      </Card>

      {adRow && drill.ad && (
        <Card id="ad-detail" className="scroll-mt-20">
          <CardHeader
            title={`${t("analytics.camp_adDetail")}: ${drill.ad.name}`}
            meta={meta}
            actions={
              <LinkButton href={link({ account: account?.id, campaign: campaign?.id, adset: drill.adSet?.id })} size="sm" variant="ghost" aria-label={t("analytics.camp_closeDetail")}>
                <X className="size-4" aria-hidden />
              </LinkButton>
            }
          />
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">{t("analytics.camp_format")}</dt>
                <dd className="mt-0.5 text-sm font-medium">{drill.ad.format ? t(`contentType.${drill.ad.format}`) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t("ui.status")}</dt>
                <dd className="mt-0.5">
                  <Badge tone={STATUS_TONE[drill.ad.status] ?? "neutral"}>{t(`campaignStatus.${drill.ad.status}`)}</Badge>
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted">{t("analytics.camp_headline")}</dt>
                <dd className="mt-0.5 text-sm font-medium">{drill.ad.headline ?? "—"}</dd>
              </div>
              {drill.ad.previewUrl && /^https?:\/\//.test(drill.ad.previewUrl) && (
                <div className="col-span-2 sm:col-span-4">
                  <dt className="text-xs text-muted">{t("analytics.camp_preview")}</dt>
                  <dd className="mt-0.5">
                    <a href={drill.ad.previewUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
                      {t("analytics.camp_openPreview")} <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={t("kpi.spend")} value={money(adRow.spend)} />
              <Stat label={t("analytics.camp_results")} value={fmtNumber(adRow.conversions, locale)} />
              <Stat label={t("kpi.cpl")} value={money(adRow.cpl, 2)} />
              <Stat label={t("kpi.ctr")} value={fmtPct(adRow.ctr, locale, 2)} />
              <Stat label={t("kpi.cpm")} value={money(adRow.cpm, 2)} />
              <Stat label={t("kpi.frequency")} value={<span className={(adRow.frequency ?? 0) > FREQUENCY_WARNING ? "text-warn" : undefined}>{fmtNumber(adRow.frequency, locale, 2)}</span>} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-medium text-muted">{t("analytics.camp_dailySpend")}</h4>
                <TimeSeriesChart area height={200} data={toChartRows(adSeries, ["spend"])} series={[{ key: "spend", label: t("kpi.spend") }]} format="money" currency={currency} />
              </div>
              <div>
                <h4 className="mb-2 text-xs font-medium text-muted">{t("analytics.camp_dailyCtr")}</h4>
                <TimeSeriesChart height={200} data={toChartRows(adSeries, ["ctr"])} series={[{ key: "ctr", label: t("kpi.ctr"), color: "var(--chart-3)" }]} format="pct" />
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={t(`analytics.camp_level_${level}`)}
          subtitle={t("analytics.camp_legend")}
          meta={
            <div className="space-y-1">
              {meta}
              <p className="text-[11px] text-subtle">
                {bmUsed ? t("analytics.camp_benchmarkNote", { source: bmUsed.source, asOf: fmtDate(bmUsed.asOf, locale) }) : t(profile ? "analytics.camp_noBenchmark" : "analytics.camp_selectClient")}
              </p>
            </div>
          }
        />
        <DataTable
          exportName={`campaigns-${level}`}
          columns={[
            { key: "name", label: t(level === "account" ? "filter.account" : level === "campaign" ? "filter.campaign" : level === "adSet" ? "filter.adset" : "filter.ad") },
            ...(level === "account" || level === "campaign" ? [{ key: "platform", label: t("filter.platform"), hideOnMobile: true }] : []),
            ...(level === "ad" ? [{ key: "format", label: t("analytics.camp_format"), hideOnMobile: true }] : []),
            ...(level !== "account" ? [{ key: "status", label: t("ui.status") }] : []),
            { key: "health", label: t("analytics.camp_health") },
            { key: "spend", label: t("kpi.spend"), type: "money" as const, currency },
            { key: "results", label: t("analytics.camp_results"), type: "number" as const },
            { key: "cpl", label: t("kpi.cpl"), type: "money" as const, currency, digits: 2 },
            { key: "cpa", label: t("kpi.cpa"), type: "money" as const, currency, digits: 2, hideOnMobile: true },
            { key: "roas", label: t("kpi.roas"), type: "number" as const, digits: 2, hideOnMobile: true },
            { key: "ctr", label: t("kpi.ctr"), type: "pct" as const, digits: 2 },
            { key: "cpm", label: t("kpi.cpm"), type: "money" as const, currency, digits: 2, hideOnMobile: true },
            { key: "frequency", label: t("kpi.frequency"), type: "number" as const, digits: 2 },
          ]}
          rows={tableRows}
          initialSort={{ key: "spend", dir: "desc" }}
          empty={<EmptyState title={t("ui.noData")} hint={t("ui.noDataHint")} />}
        />
      </Card>
    </div>
  );
}
