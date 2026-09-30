import { CheckCircle2, AlertTriangle, Lightbulb, ListTodo, MessageSquare, Sparkles, Target } from "lucide-react";
import type { Report } from "@prisma/client";
import type { TFunction } from "@/lib/i18n/translate";
import { delta, trendTone, type KpiKey, type Kpis } from "@/lib/metrics";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber, fmtPct, type Locale } from "@/lib/format";
import { toChartRows } from "@/lib/queries/performance";
import type { ReportData } from "@/lib/reports/data";
import type { ReportKpi } from "@/lib/reports/schema";
import { Badge, Card, CardBody, CardHeader, DataMeta, DemoBadge, EmptyState, Progress, SimpleTable, cx } from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { DonutChart, TimeSeriesChart } from "@/components/charts/charts";

const MONEY: ReportKpi[] = ["spend", "revenue", "cpl", "cpa", "cpc", "cpm"];
const PCT: ReportKpi[] = ["roi", "cvr", "ctr", "engagementRate"];
const RATIO: ReportKpi[] = ["roas", "frequency"];

export function formatKpi(k: ReportKpi, v: number | null, currency: string, locale: Locale) {
  if (MONEY.includes(k)) return fmtMoney(v, currency, locale, k === "cpc" ? 2 : 0);
  if (PCT.includes(k)) return fmtPct(v, locale, 2);
  if (RATIO.includes(k)) return v == null ? "—" : fmtNumber(v, locale, 2) + (k === "roas" ? "x" : "");
  return fmtCompact(v, locale);
}

type Labels = { source: string; updated: string; demo: string; demoHint: string; estimate?: string; estimateHint?: string };

/**
 * Printable report body shared by /reports/[id] (in-app) and /r/[token] (public, read-only).
 * White label: the client's logo and colours override the brand colour for this subtree.
 */
export function ReportDocument({
  report,
  data,
  t,
  locale,
  labels,
  updatedLabel,
  agencyName,
}: {
  report: Pick<Report, "id" | "title" | "type" | "periodStart" | "periodEnd">;
  data: ReportData;
  t: TFunction;
  locale: Locale;
  labels: Labels;
  updatedLabel: string | null;
  agencyName?: string;
}) {
  const { kpis, config, summary, client, theme } = data;
  const c = kpis.current;
  const p = kpis.previous;
  const cur = client.currency;
  const source = data.sourcePlatforms.length
    ? `${data.sourcePlatforms.map((x) => t(`platform.${x}`)).join(", ")} — ${data.sourceKinds.map((s) => t(`source.${s}`)).join(", ")}`
    : "—";
  const meta = <DataMeta source={source} updated={updatedLabel} demo={data.demo} labels={labels} />;
  const has = (chart: string) => config.charts.includes(chart as never);
  const style = theme.primary ? ({ "--brand": theme.primary, ...(theme.accent ? { "--chart-1": theme.primary, "--chart-2": theme.accent } : {}) } as React.CSSProperties) : undefined;
  const noData = c.spend === 0 && c.impressions === 0 && !data.organic?.impressions;

  const section = (key: string, icon: React.ReactNode, items: string[]) =>
    items.length ? (
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          {icon} {t(`reports.section.${key}`)}
        </h3>
        <ul className="list-disc space-y-1 ps-5 text-sm leading-relaxed">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <article id="report-root" className="space-y-5" style={style}>
      <header className="card flex flex-wrap items-center gap-4 rounded-card border border-border bg-surface p-5 shadow-card" style={{ borderTop: `4px solid ${theme.primary ?? "var(--brand)"}` }}>
        {theme.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary client logo URLs (white label)
          <img src={theme.logoUrl} alt={client.name} className="h-12 w-auto max-w-40 object-contain" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted">
            {client.name} · {t(`reports.type.${report.type}`)}
          </p>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{report.title}</h1>
          <p className="num mt-1 text-sm text-muted">
            {fmtDate(report.periodStart, locale)} – {fmtDate(report.periodEnd, locale)}
            {kpis.cmpRange && (
              <span className="ms-2 text-xs text-subtle">
                ({t("ui.compareTo")}: {fmtDate(kpis.cmpRange.from, locale)} – {fmtDate(kpis.cmpRange.to, locale)})
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {data.demo && <DemoBadge label={labels.demo} hint={labels.demoHint} />}
          {!theme.whiteLabel && agencyName && <p className="text-xs text-subtle">{t("reports.preparedBy", { name: agencyName })}</p>}
        </div>
      </header>

      {noData && (
        <Card>
          <EmptyState title={t("ui.noData")} hint={t("reports.noDataHint")} />
        </Card>
      )}

      <section aria-labelledby="kpi-h" className="space-y-2">
        <h2 id="kpi-h" className="text-sm font-semibold text-muted">{t("reports.section.kpis")}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {config.kpis.map((k) => {
            const key = k as KpiKey;
            const d = p ? delta(c[key] as number | null, p[key] as number | null) : undefined;
            return <KpiCard key={k} locale={locale} label={t(`kpi.${k}`)} value={formatKpi(k, c[key] as number | null, cur, locale)} delta={d} tone={p ? trendTone(key, d ?? null) : "neutral"} />;
          })}
        </div>
        {meta}
      </section>

      {summary.executive && (
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-4 text-brand" /> {t("reports.section.executive")}</span>} />
          <CardBody>
            <p className="text-sm leading-relaxed whitespace-pre-line">{summary.executive}</p>
          </CardBody>
        </Card>
      )}

      {(summary.wins.length || summary.challenges.length || summary.learnings.length || summary.recommendations.length) > 0 && (
        <Card>
          <CardBody className="grid gap-5 md:grid-cols-2">
            {section("wins", <CheckCircle2 className="size-4 text-good" />, summary.wins)}
            {section("challenges", <AlertTriangle className="size-4 text-warn" />, summary.challenges)}
            {section("learnings", <Lightbulb className="size-4 text-info" />, summary.learnings)}
            {section("recommendations", <Target className="size-4 text-brand" />, summary.recommendations)}
          </CardBody>
        </Card>
      )}

      {has("trend") && (
        <Card>
          <CardHeader title={t("reports.chart.trend")} meta={meta} />
          <CardBody>
            {c.revenue > 0 ? (
              <TimeSeriesChart area data={toChartRows(data.series, ["spend", "revenue"])} series={[{ key: "spend", label: t("kpi.spend") }, { key: "revenue", label: t("kpi.revenue") }]} format="money" currency={cur} />
            ) : (
              <TimeSeriesChart data={toChartRows(data.series, ["spend"])} series={[{ key: "spend", label: t("kpi.spend") }]} format="money" currency={cur} />
            )}
          </CardBody>
        </Card>
      )}

      {(has("platformShare") || has("budget")) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {has("platformShare") && (
            <Card>
              <CardHeader title={t("reports.chart.platformShare")} meta={meta} />
              <CardBody>
                <DonutChart data={[...data.platforms].sort((a, b) => b.spend - a.spend).map((x) => ({ label: t(`platform.${x.platform}`), value: Math.round(x.spend) }))} format="money" currency={cur} />
              </CardBody>
            </Card>
          )}
          {has("budget") && <BudgetCard data={data} t={t} locale={locale} meta={meta} labels={labels} />}
        </div>
      )}

      {has("platformTable") && (
        <Card>
          <CardHeader title={t("reports.chart.platformTable")} meta={meta} />
          <SimpleTable
            head={[t("filter.platform"), t("kpi.spend"), t("kpi.revenue"), t("kpi.roas"), t("kpi.leads"), t("kpi.cpl"), t("kpi.ctr")]}
            empty={<EmptyState title={t("ui.noData")} />}
            rows={[...data.platforms].sort((a, b) => b.spend - a.spend).map((x) => row(x, t(`platform.${x.platform}`), cur, locale))}
          />
        </Card>
      )}

      {has("campaignTable") && (
        <Card>
          <CardHeader title={t("reports.chart.campaignTable")} meta={meta} />
          <SimpleTable
            head={[t("filter.campaign"), t("kpi.spend"), t("kpi.revenue"), t("kpi.roas"), t("kpi.leads"), t("kpi.cpl"), t("kpi.ctr")]}
            empty={<EmptyState title={t("ui.noData")} />}
            rows={data.campaigns.filter((x) => x.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 20).map((x) => row(x, x.name, cur, locale))}
          />
        </Card>
      )}

      {has("organic") && (
        <Card>
          <CardHeader title={t("reports.chart.organic")} meta={meta} />
          <CardBody>
            {data.organic && data.organic.impressions + data.organic.followersEnd > 0 ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {[
                  [t("kpi.followers"), fmtCompact(data.organic.followersEnd, locale)],
                  [t("kpi.followersGrowth"), fmtPct(data.organic.followersGrowth, locale, 2)],
                  [t("kpi.reach"), fmtCompact(data.organic.reach, locale)],
                  [t("kpi.engagements"), fmtCompact(data.organic.engagements, locale)],
                  [t("kpi.engagementRate"), fmtPct(data.organic.engagementRate, locale, 2)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <p className="text-xs text-muted">{l}</p>
                    <p className="num text-lg font-semibold">{v}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title={t("ui.noData")} />
            )}
          </CardBody>
        </Card>
      )}

      {summary.comments && (
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-1.5"><MessageSquare className="size-4" /> {t("reports.section.comments")}</span>} />
          <CardBody>
            <p className="text-sm leading-relaxed whitespace-pre-line">{summary.comments}</p>
          </CardBody>
        </Card>
      )}

      {data.tasks.length > 0 && (
        <Card className="print-break">
          <CardHeader title={<span className="inline-flex items-center gap-1.5"><ListTodo className="size-4" /> {t("reports.section.nextActions")}</span>} />
          <SimpleTable
            head={[t("tasks.col.title"), t("ui.owner"), t("ui.dueDate"), t("ui.status")]}
            rows={data.tasks.map((x) => [
              x.title,
              x.assignee?.name ?? "—",
              <span key="d" className={cx("num", x.status !== "DONE" && x.dueDate && x.dueDate < new Date() && "font-semibold text-bad")}>{fmtDate(x.dueDate, locale)}</span>,
              <Badge key="s" tone={x.status === "DONE" ? "good" : x.status === "BLOCKED" ? "bad" : x.status === "IN_PROGRESS" ? "info" : "neutral"}>{t(`taskStatus.${x.status}`)}</Badge>,
            ])}
          />
        </Card>
      )}

      <footer className="text-center text-[11px] text-subtle">
        {t("reports.footer", { date: fmtDate(new Date(), locale) })}
      </footer>
    </article>
  );
}

function row(x: Kpis, label: string, cur: string, locale: Locale) {
  return [
    <span key="l" className="font-medium">{label}</span>,
    <span key="s" className="num">{fmtMoney(x.spend, cur, locale)}</span>,
    <span key="r" className="num">{fmtMoney(x.revenue, cur, locale)}</span>,
    <span key="ro" className="num">{x.roas == null ? "—" : fmtNumber(x.roas, locale, 2) + "x"}</span>,
    <span key="le" className="num">{fmtNumber(x.leads, locale)}</span>,
    <span key="c" className="num">{fmtMoney(x.cpl, cur, locale)}</span>,
    <span key="ct" className="num">{fmtPct(x.ctr, locale, 2)}</span>,
  ];
}

function BudgetCard({ data, t, locale, meta, labels }: { data: ReportData; t: TFunction; locale: Locale; meta: React.ReactNode; labels: Labels }) {
  const spend = data.kpis.current.spend;
  const planned = data.budget.planned;
  const util = planned > 0 ? spend / planned : null;
  const cur = data.client.currency;
  return (
    <Card>
      <CardHeader title={t("reports.chart.budget")} meta={meta} />
      <CardBody className="space-y-3">
        {planned > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-muted">{t("kpi.plannedBudget")}</p>
                <p className="num font-semibold">{fmtMoney(planned, cur, locale)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">{t("kpi.spend")}</p>
                <p className="num font-semibold">{fmtMoney(spend, cur, locale)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">{t("kpi.remaining")}</p>
                <p className="num font-semibold">{fmtMoney(planned - spend, cur, locale)}</p>
              </div>
            </div>
            <Progress value={util} tone={util == null ? "neutral" : util > 1.1 ? "bad" : util < 0.85 ? "warning" : "good"} label={t("kpi.utilization")} />
            <p className="text-xs text-muted">
              {t("kpi.utilization")}: <span className="num">{fmtPct(util, locale)}</span> · {labels.estimate && <span title={labels.estimateHint}>{t("reports.plannedProrated")}</span>}
            </p>
          </>
        ) : (
          <EmptyState title={t("reports.noPlan")} />
        )}
      </CardBody>
    </Card>
  );
}
