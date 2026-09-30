import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { fmtDate, isoDay } from "@/lib/format";
import { isLinkValid } from "@/lib/reports/share";
import { nextOccurrence, parseSchedule } from "@/lib/reports/schedule";
import { Badge, Card, CardHeader, DataMeta, DemoBadge, EmptyState, LinkButton, PageHeader } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const ctx = await pageContext(await searchParams, "reports:view");
  const { t, locale, scope } = ctx;
  const reports = await db.report.findMany({
    where: scope,
    include: { client: { select: { name: true, timezone: true, isDemo: true } }, _count: { select: { actions: true } } },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  const now = new Date();
  const updated = reports[0]?.updatedAt ?? null;
  const scheduleLabel = (raw: string | null) => {
    const s = parseSchedule(raw);
    return s ? t(`reports.schedule.${s.freq}`) : "—";
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("reports.title")}
        description={t("reports.description")}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={
          ctx.can("reports:create") ? (
            <LinkButton href={`/reports/new${ctx.client ? `?client=${ctx.client.id}` : ""}`} variant="primary">
              <Plus className="size-4" aria-hidden /> {t("reports.new")}
            </LinkButton>
          ) : undefined
        }
      />
      <Card>
        <CardHeader title={t("reports.list")} meta={<DataMeta source={t("reports.source")} updated={ctx.rel(updated)} demo={ctx.isDemo} labels={ctx.metaLabels} />} />
        <DataTable
          exportName="reports"
          empty={
            <EmptyState
              title={t("reports.none")}
              hint={t("reports.noneHint")}
              action={ctx.can("reports:create") ? <LinkButton href="/reports/new" variant="primary" size="sm">{t("reports.new")}</LinkButton> : undefined}
            />
          }
          columns={[
            { key: "title", label: t("reports.col.title") },
            { key: "client", label: t("filter.client"), hideOnMobile: true },
            { key: "type", label: t("reports.col.type") },
            { key: "period", label: t("reports.col.period"), hideOnMobile: true },
            { key: "schedule", label: t("reports.col.schedule"), hideOnMobile: true },
            { key: "share", label: t("reports.col.share"), hideOnMobile: true },
            { key: "actions", label: t("reports.col.actions"), type: "number", hideOnMobile: true },
            { key: "lastSent", label: t("reports.col.lastSent"), type: "date", hideOnMobile: true },
          ]}
          rows={reports.map((r) => {
            const shared = isLinkValid(r.shareExpiresAt, now);
            const next = r.schedule ? nextOccurrence(r.schedule, now, r.client.timezone) : null;
            return {
              _id: r.id,
              title: { v: r.title, d: <Link href={`/reports/${r.id}`} className="font-medium text-brand hover:underline">{r.title}</Link> },
              client: r.client.name,
              type: t(`reports.type.${r.type}`),
              period: { v: isoDay(r.periodStart), d: <span className="num whitespace-nowrap">{fmtDate(r.periodStart, locale)} – {fmtDate(r.periodEnd, locale)}</span> },
              schedule: { v: r.schedule ?? "", d: r.schedule ? <span title={next ? fmtDate(next, locale) : undefined}>{scheduleLabel(r.schedule)} · <span className="num text-xs text-muted">{r.recipients.length}</span></span> : "—" },
              share: { v: shared ? 1 : 0, d: shared ? <Badge tone="good">{t("reports.share.active")}</Badge> : r.shareTokenHash ? <Badge tone="neutral">{t("reports.share.expired")}</Badge> : <span className="text-subtle">—</span> },
              actions: r._count.actions,
              lastSent: r.lastSentAt ? isoDay(r.lastSentAt) : null,
            };
          })}
        />
      </Card>
    </div>
  );
}
