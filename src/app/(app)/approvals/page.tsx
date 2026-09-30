import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { contentInclude, contentWhere, toDTO } from "@/lib/content/queries";
import { PENDING_APPROVAL_STATUSES } from "@/lib/content/workflow";
import { fmtNumber, fmtRelative, type Locale } from "@/lib/format";
import { Callout, Card, CardHeader, DataMeta, DemoBadge, PageHeader, Tabs } from "@/components/ui/primitives";
import { ApprovalCenter } from "@/components/content/approval-center";

export const metadata = { title: "Approval Center" };

const QUEUES = ["internal", "client", "revision", "overdue"] as const;
type Queue = (typeof QUEUES)[number];

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "content:view");
  const { t, filters: f, scope, user } = ctx;
  const locale = ctx.locale as Locale;
  const now = new Date();

  // Client users only ever see their own Client Review queue.
  const clientMode = user.role === "CLIENT";
  const base = contentWhere(f, scope);
  const queueWhere: Record<Queue, Prisma.ContentItemWhereInput> = {
    internal: { ...base, status: "INTERNAL_REVIEW" },
    client: { ...base, status: "CLIENT_REVIEW" },
    revision: { ...base, status: "NEEDS_REVISION" },
    overdue: { ...base, approvalDeadline: { lt: now }, status: { in: PENDING_APPROVAL_STATUSES } },
  };
  const available: Queue[] = clientMode ? ["client"] : [...QUEUES];
  const requested = (Array.isArray(sp.queue) ? sp.queue[0] : sp.queue) as Queue;
  const queue: Queue = available.includes(requested) ? requested : available[0];

  const [counts, rows, updated] = await Promise.all([
    Promise.all(available.map((q) => db.contentItem.count({ where: queueWhere[q] }))),
    db.contentItem.findMany({
      where: queueWhere[queue],
      include: contentInclude,
      orderBy: [{ approvalDeadline: { sort: "asc", nulls: "last" } }, { publishAt: { sort: "asc", nulls: "last" } }],
      take: 200,
    }),
    db.approval.aggregate({ where: { content: scope }, _max: { createdAt: true } }),
  ]);
  const items = rows.map(toDTO);
  const count = Object.fromEntries(available.map((q, i) => [q, counts[i]])) as Record<Queue, number>;

  const tabHref = (q: Queue) => {
    const p = new URLSearchParams(ctx.query);
    p.set("queue", q);
    return `/approvals?${p.toString()}`;
  };
  const clientNames = Object.fromEntries(ctx.clients.map((c) => [c.id, c.name]));
  const currencies = Object.fromEntries(ctx.clients.map((c) => [c.id, c.currency]));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.approvals")}
        description={clientMode ? t("content.approvalsClientDesc") : t("content.approvalsDesc")}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
      />
      {count.overdue > 0 && !clientMode && <Callout tone="bad">{t("content.overdueBanner", { n: count.overdue })}</Callout>}

      {!clientMode && (
        <Tabs
          active={queue}
          tabs={available.map((q) => ({
            key: q,
            href: tabHref(q),
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t(`content.queue.${q}`)}
                <span className={`num rounded-full px-1.5 text-[10px] ${q === "overdue" && count[q] ? "bg-bad-soft text-bad" : "bg-surface-2 text-muted"}`}>{fmtNumber(count[q], locale)}</span>
              </span>
            ),
          }))}
        />
      )}

      <Card>
        <CardHeader
          title={clientMode ? t("content.queue.clientMine", { n: count.client }) : t(`content.queue.${queue}`)}
          subtitle={t(`content.queueHint.${queue}`)}
          meta={<DataMeta source={t("content.sourceCalendar")} updated={updated._max.createdAt ? fmtRelative(updated._max.createdAt, locale) : null} demo={ctx.isDemo} labels={ctx.metaLabels} />}
        />
        <div className={clientMode ? "p-4" : ""}>
          <ApprovalCenter items={items} mode={clientMode ? "client" : "agency"} perms={[...user.perms]} clientNames={clientNames} currencies={currencies} nowIso={now.toISOString()} timezone={ctx.timezone} />
        </div>
      </Card>
    </div>
  );
}
