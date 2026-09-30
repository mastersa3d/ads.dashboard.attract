import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { sanitize } from "@/lib/sanitize";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { Badge, Button, Card, CardHeader, DataMeta, EmptyState, Field, Input, LinkButton, PageHeader, Select, buttonClass } from "@/components/ui/primitives";

export const metadata = { title: "Audit Logs" };

const PAGE_SIZE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const day = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

function actionTone(a: string) {
  if (/delete|revoke|deactivate|failed|reject|archive/.test(a)) return "bad" as const;
  if (/create|invite|approve|activate|enabled|restore|grant/.test(a)) return "good" as const;
  if (/login|logout|read/.test(a)) return "neutral" as const;
  return "info" as const;
}

/**
 * Audit Log (organization-scoped). Filters are plain query params (the global performance
 * filter bar doesn't apply here) and pagination is server-side, 50 rows per page.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "audit:view");
  const { t, locale, user } = ctx;

  const f = {
    user: one(sp.user),
    action: one(sp.action),
    entity: one(sp.entity),
    client: one(sp.client),
    from: day(one(sp.from)),
    to: day(one(sp.to)),
  };
  const page = Math.max(1, Number(one(sp.page)) || 1);

  // Admins/managers see the whole organization; anyone else granted audit:view only sees
  // entries for their accessible clients or their own actions.
  const orgWide = user.role === "SUPER_ADMIN" || user.role === "COMPANY_MANAGER";
  const where: Prisma.AuditLogWhereInput = {
    organizationId: user.organizationId,
    ...(orgWide ? {} : { OR: [{ clientId: { in: ctx.clientIds } }, { userId: user.id }] }),
    ...(f.user ? { userId: f.user } : {}),
    ...(f.action ? { action: f.action } : {}),
    ...(f.entity ? { entity: f.entity } : {}),
    ...(f.client ? { clientId: f.client } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: new Date(f.from + "T00:00:00.000Z") } : {}), ...(f.to ? { lte: new Date(f.to + "T23:59:59.999Z") } : {}) } } : {}),
  };

  const [rows, total, users, actions, entities, clients] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.auditLog.count({ where }),
    db.user.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.auditLog.findMany({ where: { organizationId: user.organizationId }, distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    db.auditLog.findMany({ where: { organizationId: user.organizationId }, distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
    db.client.findMany({ where: { organizationId: user.organizationId, ...(orgWide ? {} : { id: { in: ctx.clientIds } }) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
  const query = params.toString();
  const pageHref = (p: number) => `/audit?${query ? query + "&" : ""}page=${p}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("audit.title")}
        description={t("audit.subtitle")}
        actions={
          <a href={`/api/export/audit?${query ? query + "&" : ""}format=csv`} className={buttonClass("secondary")}>
            <Download className="size-4" aria-hidden /> {t("audit.exportCsv")}
          </a>
        }
      />

      <Card>
        <form method="get" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 no-print">
          <Field label={t("audit.user")} htmlFor="a-user">
            <Select id="a-user" name="user" defaultValue={f.user ?? ""} placeholder={t("ui.all")} options={users.map((u) => ({ value: u.id, label: u.name }))} />
          </Field>
          <Field label={t("audit.action")} htmlFor="a-action">
            <Select id="a-action" name="action" defaultValue={f.action ?? ""} placeholder={t("ui.all")} options={actions.map((a) => ({ value: a.action, label: a.action }))} />
          </Field>
          <Field label={t("audit.entity")} htmlFor="a-entity">
            <Select id="a-entity" name="entity" defaultValue={f.entity ?? ""} placeholder={t("ui.all")} options={entities.map((e) => ({ value: e.entity, label: e.entity }))} />
          </Field>
          <Field label={t("filter.client")} htmlFor="a-client">
            <Select id="a-client" name="client" defaultValue={f.client ?? ""} placeholder={t("filter.allClients")} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label={t("ui.from")} htmlFor="a-from">
            <Input id="a-from" name="from" type="date" defaultValue={f.from ?? ""} />
          </Field>
          <Field label={t("ui.to")} htmlFor="a-to">
            <Input id="a-to" name="to" type="date" defaultValue={f.to ?? ""} />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="primary">{t("ui.apply")}</Button>
            {query && (
              <LinkButton href="/audit" variant="ghost">
                {t("ui.resetFilters")}
              </LinkButton>
            )}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title={t("audit.entries", { n: fmtNumber(total, locale) })}
          subtitle={t("audit.retentionNote")}
          meta={<DataMeta source={t("audit.source")} updated={ctx.rel(rows[0]?.createdAt)} labels={ctx.metaLabels} />}
        />
        {rows.length === 0 ? (
          <EmptyState title={t("audit.empty")} hint={query ? t("ui.noDataHint") : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  {[t("audit.time"), t("audit.user"), t("audit.action"), t("audit.entity"), t("audit.entityId"), t("filter.client"), t("audit.summary"), t("audit.ip")].map((h, i) => (
                    <th key={i} className={`px-3 py-2 text-start font-medium whitespace-nowrap ${i === 4 || i === 7 ? "hidden md:table-cell" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const diff = r.diff == null ? null : JSON.stringify(sanitize(r.diff), null, 2);
                  return (
                    <tr key={r.id} className="border-b border-border/60 align-top last:border-0 hover:bg-surface-2/60">
                      <td className="num px-3 py-2 text-xs whitespace-nowrap">{fmtDateTime(r.createdAt, locale, ctx.org.timezone)}</td>
                      <td className="px-3 py-2">
                        <span className="block max-w-40 truncate">{(r.userId && userName.get(r.userId)) || t("audit.system")}</span>
                        {r.userEmail && (
                          <span className="block max-w-40 truncate text-[11px] text-subtle" dir="ltr">
                            {r.userEmail}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={actionTone(r.action)}>{r.action}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">{r.entity}</td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        <code className="text-[11px] text-muted" dir="ltr">{r.entityId ?? "—"}</code>
                      </td>
                      <td className="px-3 py-2 text-xs">{r.clientId ? (clientName.get(r.clientId) ?? "—") : "—"}</td>
                      <td className="min-w-48 px-3 py-2 text-xs">
                        <span className="break-words">{r.summary ?? "—"}</span>
                        {diff && diff !== "{}" && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-brand">{t("audit.showChanges")}</summary>
                            <pre dir="ltr" className="mt-1 max-h-64 max-w-md overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] leading-snug text-start">
                              {diff}
                            </pre>
                          </details>
                        )}
                      </td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        <span className="num text-xs" dir="ltr">{r.ip ?? "—"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav className="flex items-center justify-end gap-2 px-4 py-2 text-xs text-muted no-print" aria-label={t("ui.page")}>
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="rounded p-1 hover:bg-surface-2" aria-label={t("ui.previous")}>
                <ChevronLeft className="size-4 flip-rtl" />
              </Link>
            )}
            <span>
              {t("ui.page")} <span className="num">{page}</span> {t("ui.of")} <span className="num">{pages}</span>
            </span>
            {page < pages && (
              <Link href={pageHref(page + 1)} className="rounded p-1 hover:bg-surface-2" aria-label={t("ui.next")}>
                <ChevronRight className="size-4 flip-rtl" />
              </Link>
            )}
          </nav>
        )}
      </Card>
    </div>
  );
}
