import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import { filtersToQuery, type RawParams } from "@/lib/filters";
import { fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { convert } from "@/lib/fx";
import { analyzePlan } from "@/lib/budget/analysis";
import { Badge, Callout, Card, CardHeader, DataMeta, DemoBadge, EmptyState, LinkButton, PageHeader, Progress } from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ui/export-menu";

export const metadata = { title: "Media Budget Planner" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "budget:view");
  const { t, locale, currency } = ctx;
  const plans = await db.budgetPlan.findMany({ where: { ...ctx.scope }, include: { lines: true }, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }], take: 40 });
  const analyses = await Promise.all(plans.map((p) => analyzePlan(p, ctx.fx)));
  const today = new Date();
  const clientName = new Map(ctx.clients.map((c) => [c.id, c.name]));

  const active = plans.map((p, i) => ({ p, a: analyses[i] })).filter(({ p }) => p.startDate <= today && p.endDate >= new Date(today.getTime() - 86400000));
  const toRep = (n: number, from: string) => convert(n, from, currency, ctx.fx);
  const activeBudget = active.reduce((s, { p, a }) => s + toRep(a.total, p.currency), 0);
  const activeSpent = active.reduce((s, { p, a }) => s + toRep(a.spentTotal, p.currency), 0);
  const activeForecast = active.reduce((s, { p, a }) => s + toRep(a.projectedTotal, p.currency), 0);
  const alerts = active.filter(({ a }) => a.forecast.pacing != null && (a.forecast.pacing > 1.1 || a.forecast.pacing < 0.85));
  const fxApplied = plans.some((p) => p.currency !== currency);
  const updated = plans.reduce<Date | null>((d, p) => (!d || p.updatedAt > d ? p.updatedAt : d), null);
  const newHref = `/budget/new?${ctx.query}`;
  const money = (n: number | null) => fmtMoney(n, currency, locale);

  return (
    <div id="budget-root" className="space-y-6">
      <PageHeader
        title={t("budget.title")}
        description={`${ctx.client?.name ?? t("filter.allClients")} · ${t("budget.description")}`}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={
          <>
            {ctx.can("budget:edit") && (
              <LinkButton href={newHref} variant="primary">
                <Plus className="size-4" aria-hidden /> {t("budget.newPlan")}
              </LinkButton>
            )}
            <ExportMenu targetId="budget-root" fileName="budget-plans" />
          </>
        }
      />
      {fxApplied && <Callout tone="info">{t("budget.fxNote", { currency, source: ctx.fx.source ?? "" })}</Callout>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard locale={locale} label={t("budget.activePlans")} value={String(active.length)} />
        <KpiCard locale={locale} label={t("budget.activeBudget")} value={money(activeBudget)} />
        <KpiCard
          locale={locale}
          label={t("budget.actualSpend")}
          value={money(activeSpent)}
          footer={activeBudget > 0 ? <div className="mt-1"><Progress value={activeSpent / activeBudget} label={t("kpi.utilization")} /></div> : undefined}
        />
        <KpiCard locale={locale} label={t("kpi.forecast")} value={active.length ? money(activeForecast) : "—"} estimate={t("ui.estimate")} />
      </div>

      {alerts.map(({ p, a }) => (
        <Callout key={p.id} tone={a.forecast.pacing! > 1.1 ? "bad" : "warning"} title={p.name}>
          {a.forecast.pacing! > 1.1 ? t("budget.alert.overPacing", { pct: fmtPct(a.forecast.pacing! - 1, locale) }) : t("budget.alert.underPacing", { pct: fmtPct(1 - a.forecast.pacing!, locale) })}{" "}
          <Link className="font-medium text-brand hover:underline" href={`/budget/${p.id}?${filtersToQuery(sp, { client: p.clientId })}`}>
            {t("ui.details")}
          </Link>
        </Callout>
      ))}

      <Card>
        <CardHeader title={t("budget.plans")} meta={<DataMeta source={t("budget.planSource")} updated={ctx.rel(updated)} demo={ctx.isDemo} labels={ctx.metaLabels} />} />
        {plans.length === 0 ? (
          <EmptyState title={t("budget.noPlans")} hint={t("budget.noPlansHint")} action={ctx.can("budget:edit") ? <LinkButton href={newHref} variant="primary">{t("budget.newPlan")}</LinkButton> : undefined} />
        ) : (
          <DataTable
            exportName="budget-plans"
            columns={[
              { key: "name", label: t("ui.name") },
              ...(ctx.client ? [] : [{ key: "client", label: t("filter.client"), hideOnMobile: true }]),
              { key: "period", label: t("budget.form.period"), hideOnMobile: true },
              { key: "start", label: t("ui.from"), type: "date", hideOnMobile: true },
              { key: "total", label: t("budget.totalBudget"), align: "end" },
              { key: "spent", label: t("budget.actualSpend"), align: "end" },
              { key: "util", label: t("kpi.utilization"), type: "pct" },
              { key: "pacing", label: t("budget.pacing"), type: "pct", hideOnMobile: true },
              { key: "status", label: t("ui.status") },
            ]}
            rows={plans.map((p, i) => {
              const a = analyses[i];
              const pace = a.forecast.pacing;
              return {
                _id: p.id,
                name: {
                  v: p.name,
                  d: (
                    <div className="min-w-40">
                      <Link className="font-medium text-brand hover:underline" href={`/budget/${p.id}?${filtersToQuery(sp, { client: p.clientId })}`}>
                        {p.name}
                      </Link>
                      <p className="text-[11px] text-subtle">
                        {t(`budget.scenario.${p.scenario}`)} · {fmtDate(p.startDate, locale)} – {fmtDate(p.endDate, locale)}
                      </p>
                    </div>
                  ),
                },
                client: clientName.get(p.clientId) ?? "",
                period: t(`budget.period.${p.period}`),
                start: p.startDate.toISOString(),
                total: { v: a.total, d: fmtMoney(a.total, p.currency, locale) },
                spent: { v: a.spentTotal, d: fmtMoney(a.spentTotal, p.currency, locale) },
                util: {
                  v: a.utilization,
                  d: (
                    <div className="ms-auto w-24">
                      <p>{fmtPct(a.utilization, locale)}</p>
                      <Progress value={a.utilization} tone={a.utilization != null && a.utilization > 1 ? "bad" : "brand"} />
                    </div>
                  ),
                },
                pacing: { v: pace, d: pace == null ? "—" : <span className={pace > 1.1 ? "text-bad" : pace < 0.85 ? "text-warn" : "text-good"}>{fmtPct(pace, locale)}</span> },
                status: { v: p.status, d: <Badge tone={p.status === "APPROVED" ? "good" : "neutral"}>{t(`budget.status.${p.status}`)}</Badge> },
              };
            })}
          />
        )}
      </Card>
    </div>
  );
}
