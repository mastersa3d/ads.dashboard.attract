import Link from "next/link";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, CheckCheck, SlidersHorizontal, ChevronLeft, ChevronRight } from "lucide-react";
import type { AlertSeverity, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isRead, readIds, unreadFor } from "@/lib/notifications";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { Badge, Button, Card, CardHeader, DataMeta, EmptyState, LinkButton, PageHeader, Select, cx } from "@/components/ui/primitives";
import { ActionButton } from "@/components/admin/action-button";
import { NOTIFICATION_TYPES, SEVERITY_TONE } from "@/components/admin/constants";
import { notificationWhere } from "@/components/admin/notification-scope";
import { markAllNotificationsRead, markNotificationRead } from "@/app/actions/notifications";

export const metadata = { title: "Notifications" };

const PAGE_SIZE = 30;
const SEVERITIES: AlertSeverity[] = ["CRITICAL", "WARNING", "INFO", "SUCCESS"];
const ICON = { SUCCESS: CheckCircle2, INFO: Info, WARNING: AlertTriangle, CRITICAL: AlertOctagon } as const;
const BAR = { SUCCESS: "border-s-good", INFO: "border-s-info", WARNING: "border-s-warn", CRITICAL: "border-s-bad" } as const;
const ICON_CLS = { SUCCESS: "text-good bg-good-soft", INFO: "text-info bg-info-soft", WARNING: "text-warn bg-warn-soft", CRITICAL: "text-bad bg-bad-soft" } as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Producers may store an i18n key (e.g. "integrations.alert.X.title") instead of literal text. */
const I18N_KEY = /^[a-z]+\.[A-Za-z0-9_.]+$/;

/** Only follow internal links stored on notifications. */
const safeLink = (l: string | null) => (l && l.startsWith("/") && !l.startsWith("//") ? l : null);

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp);
  const { t, locale, user } = ctx;

  const severity = SEVERITIES.find((x) => x === one(sp.severity));
  const client = ctx.clients.find((c) => c.id === one(sp.nclient))?.id;
  const unreadOnly = one(sp.unread) === "1";
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const base = await notificationWhere(user);
  // Known alert types plus any other type producers have raised for this user.
  const seen = await db.notification.findMany({ where: base, distinct: ["type"], select: { type: true } });
  const types = [...new Set<string>([...NOTIFICATION_TYPES, ...seen.map((x) => x.type)])];
  const type = types.find((x) => x === one(sp.type));
  const where: Prisma.NotificationWhereInput = {
    AND: [base, ...(type ? [{ type }] : []), ...(severity ? [{ severity }] : []), ...(client ? [{ clientId: client }] : []), ...(unreadOnly ? [unreadFor(user.id)] : [])],
  };
  const [rows, total, unread, bySeverity] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.notification.count({ where }),
    db.notification.count({ where: { AND: [base, unreadFor(user.id)] } }),
    db.notification.groupBy({ by: ["severity"], where: { AND: [base, unreadFor(user.id)] }, _count: true }),
  ]);
  const sharedRead = await readIds(user.id, rows.filter((n) => !n.userId).map((n) => n.id));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const text = (s: string | null) => (s && I18N_KEY.test(s) ? t(s) : s);
  const typeLabel = (x: string) => {
    const l = t(`notifications.type.${x}`);
    return l === `notifications.type.${x}` ? x.replaceAll("_", " ").toLowerCase() : l;
  };
  const clientName = new Map(ctx.clients.map((c) => [c.id, c.name]));
  const demoClients = new Set(ctx.clients.filter((c) => c.isDemo).map((c) => c.id));
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const cur = { type, severity, nclient: client, unread: unreadOnly ? "1" : undefined, page: undefined as string | undefined, ...over };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/notifications?${s}` : "/notifications";
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("notifications.title")}
        description={t("notifications.subtitle")}
        badges={unread > 0 ? <Badge tone="bad">{t("notifications.unreadCount", { n: fmtNumber(unread, locale) })}</Badge> : undefined}
        actions={
          <>
            <LinkButton href="/settings?tab=notifications" size="sm">
              <SlidersHorizontal className="size-3.5" aria-hidden /> {t("notifications.preferences")}
            </LinkButton>
            {unread > 0 && (
              <ActionButton action={markAllNotificationsRead} variant="primary">
                <CheckCheck className="size-3.5" aria-hidden /> {t("notifications.markAllRead")}
              </ActionButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SEVERITIES.map((s) => {
          const Icon = ICON[s];
          const n = bySeverity.find((b) => b.severity === s)?._count ?? 0;
          return (
            <Link key={s} href={qs({ severity: severity === s ? undefined : s })} className={cx("card flex items-center gap-3 rounded-card border bg-surface p-3 shadow-card transition", severity === s ? "border-brand" : "border-border hover:border-brand/40")}>
              <span className={cx("grid size-9 place-items-center rounded-full", ICON_CLS[s])}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-muted">{t(`notifications.severity.${s}`)}</span>
                <span className="num text-lg font-semibold">{fmtNumber(n, locale)}</span> <span className="text-[11px] text-subtle">{t("notifications.unread")}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader
          title={t("notifications.inbox")}
          meta={<DataMeta source={t("notifications.source")} updated={ctx.rel(rows[0]?.createdAt)} demo={rows.some((r) => r.clientId && demoClients.has(r.clientId))} labels={ctx.metaLabels} />}
        />
        <form method="get" className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3 no-print">
          <div className="w-full sm:w-48"><Select name="type" defaultValue={type ?? ""} placeholder={t("notifications.allTypes")} aria-label={t("notifications.type")} options={types.map((x) => ({ value: x, label: typeLabel(x) }))} /></div>
          <div className="w-full sm:w-40"><Select name="severity" defaultValue={severity ?? ""} placeholder={t("notifications.allSeverities")} aria-label={t("notifications.severityLabel")} options={SEVERITIES.map((s) => ({ value: s, label: t(`notifications.severity.${s}`) }))} /></div>
          {ctx.clients.length > 1 && <div className="w-full sm:w-48"><Select name="nclient" defaultValue={client ?? ""} placeholder={t("filter.allClients")} aria-label={t("filter.client")} options={ctx.clients.map((c) => ({ value: c.id, label: c.name }))} /></div>}
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" name="unread" value="1" defaultChecked={unreadOnly} className="size-4 accent-[var(--brand)]" /> {t("notifications.unreadOnly")}
          </label>
          <Button type="submit" size="md">{t("ui.apply")}</Button>
          {(type || severity || client || unreadOnly) && (
            <Link href="/notifications" className="text-xs text-brand hover:underline">
              {t("ui.resetFilters")}
            </Link>
          )}
        </form>
        {rows.length === 0 ? (
          <EmptyState title={t("notifications.empty")} hint={t("notifications.emptyHint")} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((n) => {
              const Icon = ICON[n.severity];
              const read = isRead(n, sharedRead);
              const link = safeLink(n.link);
              return (
                <li key={n.id} className={cx("flex gap-3 border-s-4 px-4 py-3", BAR[n.severity], read ? "opacity-75" : "bg-surface-2/40")}>
                  <span className={cx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", ICON_CLS[n.severity])}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!read && <span className="size-2 rounded-full bg-brand" aria-label={t("notifications.unread")} />}
                      <p className={cx("text-sm", !read && "font-semibold")}>{text(n.title)}</p>
                    </div>
                    {n.body && <p className="text-sm text-muted">{text(n.body)}</p>}
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
                      <Badge tone={SEVERITY_TONE[n.severity]}>{t(`notifications.severity.${n.severity}`)}</Badge>
                      <Badge>{typeLabel(n.type)}</Badge>
                      {n.clientId && <span>{clientName.get(n.clientId) ?? "—"}</span>}
                      {n.clientId && demoClients.has(n.clientId) && <Badge tone="demo">{t("ui.demoData")}</Badge>}
                      {!n.clientId && !n.userId && <span>{t("notifications.orgWide")}</span>}
                      <span className="num">· {fmtDateTime(n.createdAt, locale, ctx.timezone)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-start">
                    {link && (
                      <LinkButton href={link} size="sm">
                        {t("ui.view")}
                      </LinkButton>
                    )}
                    <ActionButton action={markNotificationRead.bind(null, n.id, !read)} variant="ghost">
                      {read ? t("notifications.markUnread") : t("notifications.markRead")}
                    </ActionButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {pages > 1 && (
          <nav className="flex items-center justify-end gap-2 px-4 py-2 text-xs text-muted" aria-label={t("ui.page")}>
            {page > 1 && (
              <Link href={qs({ page: String(page - 1) })} className="rounded p-1 hover:bg-surface-2" aria-label={t("ui.previous")}>
                <ChevronLeft className="size-4 flip-rtl" />
              </Link>
            )}
            <span>
              {t("ui.page")} <span className="num">{page}</span> {t("ui.of")} <span className="num">{pages}</span>
            </span>
            {page < pages && (
              <Link href={qs({ page: String(page + 1) })} className="rounded p-1 hover:bg-surface-2" aria-label={t("ui.next")}>
                <ChevronRight className="size-4 flip-rtl" />
              </Link>
            )}
          </nav>
        )}
      </Card>
    </div>
  );
}
