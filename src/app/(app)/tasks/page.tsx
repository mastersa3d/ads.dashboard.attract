import Link from "next/link";
import { CalendarClock, KanbanSquare, List, Plus } from "lucide-react";
import type { Prisma, Priority, TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { fmtDate, fmtNumber, isoDay } from "@/lib/format";
import { Badge, Button, Card, CardBody, CardHeader, DataMeta, DemoBadge, EmptyState, LinkButton, PageHeader, Select, cx } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { MarkDoneButton, TaskForm, TaskStatusSelect } from "@/components/tasks/task-controls";

export const metadata = { title: "Tasks & Action Items" };

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const PRIORITY_TONE = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", CRITICAL: "bad" } as const;
const STATUS_TONE = { TODO: "neutral", IN_PROGRESS: "info", BLOCKED: "bad", DONE: "good" } as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function TasksPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "tasks:view");
  const { t, locale, scope, user } = ctx;
  const canEdit = ctx.can("tasks:edit");

  const view = one(sp.view) === "board" ? "board" : "list";
  const fStatus = STATUSES.find((s) => s === one(sp.tstatus));
  const fPriority = PRIORITIES.find((p) => p === one(sp.tpriority));
  const fOwner = one(sp.towner);
  const fDue = one(sp.tdue);
  const fReport = one(sp.treport);
  const editId = one(sp.edit);
  const creating = one(sp.new) === "1";

  const now = new Date();
  const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const where: Prisma.TaskWhereInput = { ...scope };
  if (fStatus) where.status = fStatus;
  if (fPriority) where.priority = fPriority;
  if (fOwner === "me") where.assigneeId = user.id;
  else if (fOwner === "none") where.assigneeId = null;
  else if (fOwner) where.assigneeId = fOwner;
  if (fReport) where.reportId = fReport;
  if (fDue === "overdue") Object.assign(where, { dueDate: { lt: startToday }, status: fStatus ?? { not: "DONE" } });
  if (fDue === "week") where.dueDate = { gte: startToday, lt: new Date(startToday.getTime() + 7 * 86_400_000) };

  const [tasks, users, reports] = await Promise.all([
    db.task.findMany({
      where,
      include: { client: { select: { name: true, isDemo: true } }, assignee: { select: { id: true, name: true } }, report: { select: { id: true, title: true } } },
      orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      take: 1000,
    }),
    db.user.findMany({ where: { organizationId: user.organizationId, active: true, role: { not: "VIEWER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.report.findMany({ where: scope, select: { id: true, title: true, clientId: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
  ]);
  const editing = editId ? await db.task.findFirst({ where: { id: editId, ...scope } }) : null;

  const overdue = (x: { dueDate: Date | null; status: TaskStatus }) => x.status !== "DONE" && x.dueDate != null && x.dueDate < startToday;
  const mayChange = (x: { assigneeId: string | null }) => canEdit || x.assigneeId === user.id;
  const updated = tasks.reduce<Date | null>((m, x) => (!m || x.updatedAt > m ? x.updatedAt : m), null);
  const meta = <DataMeta source={t("tasks.source")} updated={ctx.rel(updated)} demo={ctx.isDemo} labels={ctx.metaLabels} />;

  // Links keep the global filters (ctx.query) plus this page's own params.
  const own = { view, tstatus: fStatus, tpriority: fPriority, towner: fOwner, tdue: fDue, treport: fReport };
  const href = (o: Partial<Record<keyof typeof own | "edit" | "new", string | undefined>>) => {
    const q = new URLSearchParams(ctx.query);
    for (const [k, v] of Object.entries({ ...own, ...o })) if (v) q.set(k, v);
    return `/tasks?${q.toString()}`;
  };
  const closeHref = href({});
  const counts = STATUSES.map((s) => ({ s, n: tasks.filter((x) => x.status === s).length }));
  const overdueCount = tasks.filter(overdue).length;

  const formClients = ctx.clients.map((c) => ({ id: c.id, name: c.name }));
  const defaultClient = ctx.client?.id ?? formClients[0]?.id ?? "";

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("tasks.title")}
        description={t("tasks.description")}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={
          <>
            <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label={t("tasks.view")}>
              <Link href={href({ view: "list" })} aria-current={view === "list" ? "page" : undefined} className={cx("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm", view === "list" ? "bg-brand-soft text-brand" : "text-muted hover:text-text")}>
                <List className="size-4" aria-hidden /> {t("tasks.list")}
              </Link>
              <Link href={href({ view: "board" })} aria-current={view === "board" ? "page" : undefined} className={cx("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm", view === "board" ? "bg-brand-soft text-brand" : "text-muted hover:text-text")}>
                <KanbanSquare className="size-4" aria-hidden /> {t("tasks.board")}
              </Link>
            </div>
            {canEdit && (
              <LinkButton href={href({ new: "1" })} variant="primary">
                <Plus className="size-4" aria-hidden /> {t("tasks.new")}
              </LinkButton>
            )}
          </>
        }
      />

      {!canEdit && <p className="text-sm text-muted">{t("tasks.readOnly")}</p>}

      {canEdit && (creating || editing) && formClients.length > 0 && (
        <Card>
          <CardHeader title={editing ? t("tasks.edit") : t("tasks.new")} />
          <CardBody>
            <TaskForm
              key={editing?.id ?? "new"}
              clients={formClients}
              users={users}
              reports={reports}
              onClose={closeHref}
              initial={
                editing
                  ? {
                      id: editing.id,
                      clientId: editing.clientId,
                      title: editing.title,
                      description: editing.description ?? "",
                      assigneeId: editing.assigneeId ?? "",
                      dueDate: editing.dueDate ? isoDay(editing.dueDate) : "",
                      priority: editing.priority,
                      status: editing.status,
                      reportId: editing.reportId ?? "",
                    }
                  : { clientId: defaultClient, title: "", description: "", assigneeId: "", dueDate: "", priority: "MEDIUM", status: "TODO", reportId: fReport ?? "" }
              }
            />
          </CardBody>
        </Card>
      )}

      {/* Filters: plain GET form so they are shareable/bookmarkable and work without JS. */}
      <Card>
        <form method="get" action="/tasks" className="flex flex-wrap items-end gap-3 p-3 no-print">
          {[...new URLSearchParams(ctx.query).entries()].map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="view" value={view} />
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("ui.status")}
            <Select name="tstatus" defaultValue={fStatus ?? ""} placeholder={t("ui.all")} options={STATUSES.map((s) => ({ value: s, label: t(`taskStatus.${s}`) }))} className="w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("ui.owner")}
            <Select
              name="towner"
              defaultValue={fOwner ?? ""}
              placeholder={t("ui.all")}
              options={[{ value: "me", label: t("tasks.mine") }, { value: "none", label: t("tasks.unassigned") }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
              className="w-44"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("ui.priority")}
            <Select name="tpriority" defaultValue={fPriority ?? ""} placeholder={t("ui.all")} options={PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) }))} className="w-36" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("ui.dueDate")}
            <Select name="tdue" defaultValue={fDue ?? ""} placeholder={t("ui.all")} options={[{ value: "overdue", label: t("tasks.overdue") }, { value: "week", label: t("tasks.dueThisWeek") }]} className="w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("tasks.col.report")}
            <Select name="treport" defaultValue={fReport ?? ""} placeholder={t("ui.all")} options={reports.map((r) => ({ value: r.id, label: r.title }))} className="w-52" />
          </label>
          <Button type="submit" size="md">{t("ui.apply")}</Button>
          <Link href={`/tasks?${ctx.query}${ctx.query ? "&" : ""}view=${view}`} className="text-sm text-muted hover:text-text">
            {t("ui.resetFilters")}
          </Link>
        </form>
      </Card>

      <div className="flex flex-wrap gap-2 text-sm">
        {counts.map(({ s, n }) => (
          <Badge key={s} tone={STATUS_TONE[s]}>
            {t(`taskStatus.${s}`)} <span className="num">{fmtNumber(n, locale)}</span>
          </Badge>
        ))}
        {overdueCount > 0 && (
          <Badge tone="bad">
            <CalendarClock className="size-3" aria-hidden /> {t("tasks.overdue")} <span className="num">{fmtNumber(overdueCount, locale)}</span>
          </Badge>
        )}
      </div>

      {view === "list" ? (
        <Card>
          <CardHeader title={t("tasks.list")} meta={meta} />
          <DataTable
            exportName="tasks"
            empty={<EmptyState title={t("tasks.none")} hint={t("tasks.noneHint")} />}
            initialSort={{ key: "due", dir: "asc" }}
            columns={[
              { key: "title", label: t("tasks.col.title") },
              { key: "client", label: t("filter.client"), hideOnMobile: true },
              { key: "owner", label: t("ui.owner"), hideOnMobile: true },
              { key: "due", label: t("ui.dueDate") },
              { key: "priority", label: t("ui.priority"), hideOnMobile: true },
              { key: "status", label: t("ui.status") },
              { key: "report", label: t("tasks.col.report"), hideOnMobile: true },
              { key: "done", label: "", sortable: false },
            ]}
            rows={tasks.map((x) => ({
              _id: x.id,
              title: {
                v: x.title,
                d: canEdit ? (
                  <Link href={href({ edit: x.id })} className="font-medium text-brand hover:underline">
                    {x.title}
                  </Link>
                ) : (
                  <span className="font-medium">{x.title}</span>
                ),
              },
              client: x.client.name,
              owner: x.assignee?.name ?? "",
              due: { v: x.dueDate ? isoDay(x.dueDate) : null, d: <span className={cx("num whitespace-nowrap", overdue(x) && "font-semibold text-bad")}>{fmtDate(x.dueDate, locale)}</span> },
              priority: { v: PRIORITIES.indexOf(x.priority), d: <Badge tone={PRIORITY_TONE[x.priority]}>{t(`priority.${x.priority}`)}</Badge> },
              status: { v: x.status, d: mayChange(x) ? <TaskStatusSelect id={x.id} status={x.status} label={t("ui.status")} /> : <Badge tone={STATUS_TONE[x.status]}>{t(`taskStatus.${x.status}`)}</Badge> },
              report: { v: x.report?.title ?? "", d: x.report ? <Link href={`/reports/${x.report.id}`} className="text-brand hover:underline">{x.report.title}</Link> : "—" },
              done: { v: "", d: mayChange(x) && x.status !== "DONE" ? <MarkDoneButton id={x.id} /> : null },
            }))}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {meta}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {STATUSES.map((s) => {
              const col = tasks.filter((x) => x.status === s);
              return (
                <section key={s} aria-label={t(`taskStatus.${s}`)} className="rounded-card border border-border bg-surface-2/50 p-2">
                  <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                    <Badge tone={STATUS_TONE[s]}>{t(`taskStatus.${s}`)}</Badge>
                    <span className="num text-xs text-muted">{col.length}</span>
                  </h2>
                  {col.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-subtle">{t("tasks.emptyColumn")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {col.map((x) => (
                        <li key={x.id} className="card rounded-lg border border-border bg-surface p-3 shadow-card">
                          <div className="flex items-start justify-between gap-2">
                            {canEdit ? (
                              <Link href={href({ edit: x.id })} className="text-sm font-medium hover:text-brand">
                                {x.title}
                              </Link>
                            ) : (
                              <p className="text-sm font-medium">{x.title}</p>
                            )}
                            <Badge tone={PRIORITY_TONE[x.priority]}>{t(`priority.${x.priority}`)}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            {x.client.name}
                            {x.assignee && <> · {x.assignee.name}</>}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <span className={cx("num inline-flex items-center gap-1 text-xs", overdue(x) ? "font-semibold text-bad" : "text-subtle")}>
                              <CalendarClock className="size-3" aria-hidden /> {fmtDate(x.dueDate, locale)}
                            </span>
                            {mayChange(x) && <TaskStatusSelect id={x.id} status={x.status} label={t("ui.status")} />}
                          </div>
                          {x.report && (
                            <Link href={`/reports/${x.report.id}`} className="mt-1 block truncate text-[11px] text-brand hover:underline">
                              {x.report.title}
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
