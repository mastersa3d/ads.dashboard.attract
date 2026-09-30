import Link from "next/link";
import type { Client } from "@prisma/client";
import { db } from "@/lib/db";
import { lastMetricSync, metricSources, type PageContext } from "@/lib/page";
import { parseFilters } from "@/lib/filters";
import { totalsWithComparison, type Q } from "@/lib/queries/performance";
import { delta, trendTone, type KpiKey } from "@/lib/metrics";
import { fmtDate, fmtMoney, fmtNumber, fmtPct } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, DataMeta, EmptyState, LinkButton, SimpleTable } from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/kpi-card";

/**
 * Client Overview: last-30-day KPIs (vs the previous 30 days) through the shared performance
 * queries, plus accounts, goals, upcoming content and open tasks — all scoped to this client.
 */
export async function OverviewTab({ ctx, client }: { ctx: PageContext; client: Client }) {
  const { t, locale } = ctx;
  const scope = { clientId: client.id };
  const f = parseFilters({}); // fixed window: last 30 days, compared with the previous 30
  const q: Q = { scope, currency: client.currency, fx: ctx.fx };
  const now = new Date();

  const [{ current: c, previous: p }, updated, source, accounts, content, tasks] = await Promise.all([
    totalsWithComparison(f, q),
    lastMetricSync(scope),
    metricSources(scope, t),
    db.adAccount.findMany({ where: scope, orderBy: [{ platform: "asc" }, { name: "asc" }], include: { integration: { select: { status: true, lastSyncAt: true } } } }),
    db.contentItem.findMany({
      where: { ...scope, publishAt: { gte: now }, status: { notIn: ["PUBLISHED", "REJECTED"] } },
      orderBy: { publishAt: "asc" },
      take: 6,
      select: { id: true, title: true, platform: true, publishAt: true, status: true, type: true },
    }),
    db.task.findMany({
      where: { ...scope, status: { not: "DONE" } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
      take: 6,
      include: { assignee: { select: { name: true } } },
    }),
  ]);

  const money = (n: number | null, digits = 0) => fmtMoney(n, client.currency, locale, digits);
  const d = (k: KpiKey) => (p ? delta(c[k] as number | null, p[k] as number | null) : undefined);
  const tone = (k: KpiKey) => (p ? trendTone(k, delta(c[k] as number | null, p[k] as number | null)) : "neutral");
  const meta = <DataMeta source={source} updated={ctx.rel(updated)} demo={client.isDemo} labels={ctx.metaLabels} />;
  const cq = `client=${client.id}`;

  return (
    <div className="space-y-5">
      <section aria-labelledby="kpi-h" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="kpi-h" className="text-sm font-semibold text-muted">
            {t("clients.last30")} · {fmtDate(f.from, locale)} – {fmtDate(f.to, locale)}
          </h2>
          {meta}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <KpiCard locale={locale} label={t("kpi.spend")} value={money(c.spend)} delta={d("spend")} tone="neutral" />
          <KpiCard locale={locale} label={t("kpi.revenue")} value={money(c.revenue)} delta={d("revenue")} tone={tone("revenue")} />
          <KpiCard locale={locale} label={t("kpi.roas")} value={c.roas == null ? "—" : fmtNumber(c.roas, locale, 2) + "x"} delta={d("roas")} tone={tone("roas")} />
          <KpiCard locale={locale} label={t("kpi.leads")} value={fmtNumber(c.leads, locale)} delta={d("leads")} tone={tone("leads")} />
          <KpiCard locale={locale} label={t("kpi.cpl")} value={money(c.cpl)} delta={d("cpl")} tone={tone("cpl")} />
          <KpiCard locale={locale} label={t("kpi.ctr")} value={fmtPct(c.ctr, locale, 2)} delta={d("ctr")} tone={tone("ctr")} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t("clients.linkedAccounts")}
            meta={<DataMeta source={t("clients.accountsSource")} updated={ctx.rel(accounts.reduce<Date | null>((m, a) => (a.integration?.lastSyncAt && (!m || a.integration.lastSyncAt > m) ? a.integration.lastSyncAt : m), null))} demo={client.isDemo} labels={ctx.metaLabels} />}
            actions={ctx.can("integrations:view") ? <LinkButton href="/settings/integrations" size="sm">{t("clients.manageIntegrations")}</LinkButton> : undefined}
          />
          <SimpleTable
            head={[t("filter.platform"), t("filter.account"), t("filter.currency"), t("ui.status")]}
            empty={<EmptyState title={t("clients.noAccounts")} hint={t("clients.noAccountsHint")} />}
            rows={accounts.map((a) => [
              t(`platform.${a.platform}`),
              <span key="n" className="block max-w-56 truncate">{a.name}</span>,
              <span key="c" className="num">{a.currency}</span>,
              a.source === "DEMO" ? (
                <Badge key="s" tone="demo">{t("source.DEMO")}</Badge>
              ) : a.integration ? (
                <Badge key="s" tone={a.integration.status === "CONNECTED" ? "good" : a.integration.status === "SYNCING" ? "info" : "bad"}>{t(`integrationStatus.${a.integration.status}`)}</Badge>
              ) : (
                <Badge key="s">{t(`source.${a.source}`)}</Badge>
              ),
            ])}
          />
        </Card>

        <Card>
          <CardHeader
            title={t("clients.goals")}
            meta={<DataMeta source={t("clients.profileSource")} updated={ctx.rel(client.updatedAt)} demo={client.isDemo} labels={ctx.metaLabels} />}
            actions={ctx.can("strategy:view") ? <LinkButton href={`/strategy?${cq}`} size="sm">{t("clients.openStrategy")}</LinkButton> : undefined}
          />
          <CardBody>
            {client.goals ? <p className="text-sm leading-relaxed whitespace-pre-line">{client.goals}</p> : <EmptyState title={t("clients.noGoals")} hint={t("clients.noGoalsHint")} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("clients.upcomingContent")}
            meta={<DataMeta source={t("clients.contentSource")} updated={ctx.rel(now)} demo={client.isDemo} labels={ctx.metaLabels} />}
            actions={<LinkButton href={`/calendar?${cq}`} size="sm">{t("ui.view")}</LinkButton>}
          />
          <SimpleTable
            head={[t("ui.date"), t("clients.contentTitle"), t("filter.platform"), t("ui.status")]}
            empty={<EmptyState title={t("clients.noContent")} />}
            rows={content.map((x) => [
              <span key="d" className="num whitespace-nowrap">{fmtDate(x.publishAt, locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: client.timezone })}</span>,
              <span key="t" className="block max-w-60 truncate">{x.title}</span>,
              t(`platform.${x.platform}`),
              <Badge key="s" tone={x.status === "APPROVED" || x.status === "SCHEDULED" ? "good" : x.status === "NEEDS_REVISION" ? "warning" : "neutral"}>{t(`contentStatus.${x.status}`)}</Badge>,
            ])}
          />
        </Card>

        <Card>
          <CardHeader
            title={t("clients.openTasks")}
            meta={<DataMeta source={t("clients.tasksSource")} updated={ctx.rel(now)} demo={client.isDemo} labels={ctx.metaLabels} />}
            actions={<LinkButton href={`/tasks?${cq}`} size="sm">{t("ui.view")}</LinkButton>}
          />
          <SimpleTable
            head={[t("clients.taskTitle"), t("ui.owner"), t("ui.dueDate"), t("ui.priority")]}
            empty={<EmptyState title={t("clients.noTasks")} />}
            rows={tasks.map((x) => [
              <span key="t" className="block max-w-60 truncate">{x.title}</span>,
              x.assignee?.name ?? "—",
              <span key="d" className={x.dueDate && x.dueDate < now ? "num font-medium text-bad" : "num"}>{fmtDate(x.dueDate, locale)}</span>,
              <Badge key="p" tone={x.priority === "CRITICAL" ? "bad" : x.priority === "HIGH" ? "warning" : "neutral"}>{t(`priority.${x.priority}`)}</Badge>,
            ])}
          />
        </Card>
      </div>
    </div>
  );
}
