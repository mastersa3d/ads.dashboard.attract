import Link from "next/link";
import type { Platform, Prisma } from "@prisma/client";
import { AlarmClock, AlertTriangle } from "lucide-react";
import type { PageContext } from "@/lib/page";
import { bestTimeFor } from "@/lib/content/best-time";
import { contentDueSoon, overdueApprovals, DUE_SOON_HOURS } from "@/lib/content/reminders";
import { fmtDateTime, fmtRelative, type Locale } from "@/lib/format";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, EmptyState } from "@/components/ui/primitives";
import { StatusBadge } from "./status-badge";
import { BestTimeView } from "./best-time-view";

/**
 * Calendar sidebar: Best Time to Post for the selected client, posts due in the next 48h and
 * approvals past their deadline. The notifications worker sends the matching alerts using the
 * same helpers (lib/content/reminders.ts).
 */
export async function CalendarSidebar({ ctx, where, linkBase, platformHint }: { ctx: PageContext; where: Prisma.ContentItemWhereInput; linkBase: string; platformHint: Platform | null }) {
  const { t, locale } = ctx;
  const now = new Date();
  const [due, overdue, best] = await Promise.all([
    contentDueSoon(ctx.scope, { now, where, take: 12 }),
    overdueApprovals(ctx.scope, { now, where, take: 12 }),
    ctx.client ? bestTimeFor({ clientId: ctx.client.id, platform: platformHint, timezone: ctx.client.timezone, now }) : null,
  ]);
  const href = (id: string) => `${linkBase}${linkBase.includes("?") ? "&" : "?"}item=${id}`;
  const clientName = new Map(ctx.clients.map((c) => [c.id, c.name]));
  const multi = ctx.clientIds.length > 1;
  const meta = (source: string, estimate = false) => <DataMeta source={source} updated={fmtRelative(now, locale as Locale)} demo={ctx.isDemo} estimate={estimate} labels={ctx.metaLabels} />;

  return (
    <aside className="space-y-4" aria-label={t("content.sidebar")}>
      <Card>
        <CardHeader title={t("content.bt.title")} subtitle={best ? (best.platform ? t(`platform.${best.platform}`) : t("content.bt.allPlatforms")) : undefined} meta={meta(t("content.bt.source"), best?.method === "benchmark")} />
        <CardBody>
          {best ? <BestTimeView result={best} t={t} locale={locale as Locale} /> : <Callout tone="info">{t("content.bt.selectClient")}</Callout>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("content.dueSoonTitle", { hours: DUE_SOON_HOURS })} meta={meta(t("content.sourceCalendar"))} />
        {due.length === 0 ? (
          <EmptyState title={t("content.nothingDue")} icon={<AlarmClock className="size-6" aria-hidden />} />
        ) : (
          <ul className="divide-y divide-border">
            {due.map((d) => (
              <li key={d.id} className="px-4 py-2.5">
                <Link href={href(d.id)} className="block text-sm font-medium hover:text-brand">
                  {d.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  <span className="num">{fmtDateTime(d.publishAt, locale as Locale, ctx.timezone)}</span>
                  <span>· {t(`platform.${d.platform}`)}</span>
                  {multi && <span>· {clientName.get(d.clientId)}</span>}
                  {d.notReady ? <Badge tone="warning">{t("content.notApprovedYet")}</Badge> : <StatusBadge status={d.status} label={t(`contentStatus.${d.status}`)} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={t("content.overdueTitle")} meta={meta(t("content.sourceCalendar"))} />
        {overdue.length === 0 ? (
          <EmptyState title={t("content.noOverdue")} />
        ) : (
          <ul className="divide-y divide-border">
            {overdue.map((d) => (
              <li key={d.id} className="px-4 py-2.5">
                <Link href={href(d.id)} className="flex items-start gap-1.5 text-sm font-medium hover:text-brand">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-bad" aria-hidden />
                  {d.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  <span>
                    {t("content.deadlineWas")} <span className="num">{fmtRelative(d.approvalDeadline, locale as Locale)}</span>
                  </span>
                  {multi && <span>· {clientName.get(d.clientId)}</span>}
                  <StatusBadge status={d.status} label={t(`contentStatus.${d.status}`)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </aside>
  );
}
