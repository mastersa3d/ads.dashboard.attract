"use client";

import Link from "next/link";
import { useCallback, useMemo, useOptimistic, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarPlus, Clock, Megaphone, Plus, Repeat } from "lucide-react";
import type { ContentStatus } from "@prisma/client";
import { useI18n } from "@/lib/i18n/client";
import { changeStatus, moveContent } from "@/app/actions/content";
import type { ContentDTO } from "@/lib/content/queries";
import { allowedTransitions, LOCKED_STATUSES, STATUS_FLOW, statusTone } from "@/lib/content/workflow";
import { isApprovalOverdue, isDueSoon } from "@/lib/content/due";
import { clockLabel, dayLabel, zonedDayKey, zonedParts, zonedTime, zonedToUtc } from "@/lib/content/tz";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { Badge, Button, Callout, cx, EmptyState } from "@/components/ui/primitives";
import { StatusBadge, STATUS_DOT } from "./status-badge";
import { ContentDrawer, type DrawerDefaults } from "./content-drawer";
import { CommentDialog } from "./comment-dialog";
import type { CalendarView, EditorOptions } from "./types";

const BORDER: Record<string, string> = {
  good: "border-s-good",
  bad: "border-s-bad",
  warning: "border-s-warn",
  info: "border-s-info",
  neutral: "border-s-subtle",
  brand: "border-s-brand",
  demo: "border-s-demo",
};

type Patch = { id: string; publishAt?: string; status?: ContentStatus };

/**
 * Interactive content calendar: month / week / day grids with drag-to-reschedule, list,
 * kanban with drag-to-change-status (workflow + permissions enforced client- and server-side),
 * and campaign / platform groupings. Every item opens the editor drawer.
 */
export function ContentBoard({
  view,
  days,
  month,
  today,
  items,
  options,
  clientNames,
  baseQuery,
  nowIso,
  initialOpenId,
  initialItem,
  openNew,
}: {
  view: CalendarView;
  days: string[];
  /** "YYYY-MM" of the anchor (month view dims other months) */
  month: string;
  today: string;
  items: ContentDTO[];
  options: EditorOptions;
  clientNames: Record<string, string>;
  /** current query string without view/date/item/new — used to build day links */
  baseQuery: string;
  nowIso: string;
  initialOpenId?: string | null;
  initialItem?: ContentDTO | null;
  openNew?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tz = options.timezone;
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const perms = useMemo(() => new Set(options.perms), [options.perms]);
  const canCreate = perms.has("content:create");
  const canMove = perms.has("content:edit");

  const [optimistic, applyPatch] = useOptimistic(items, (state: ContentDTO[], p: Patch) => state.map((i) => (i.id === p.id ? { ...i, ...p } : i)));
  const [, start] = useTransition();
  const [drawer, setDrawer] = useState<{ id?: string; defaults?: DrawerDefaults } | null>(initialOpenId ? { id: initialOpenId } : openNew ? { defaults: {} } : null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "bad" | "warning" | "good"; text: string } | null>(null);
  const [pendingStatus, setPendingStatus] = useState<{ item: ContentDTO; to: ContentStatus; required: boolean; label: string } | null>(null);

  const byId = useMemo(() => new Map(optimistic.map((i) => [i.id, i])), [optimistic]);
  const dragItem = dragId ? byId.get(dragId) : undefined;
  const drawerItem = drawer?.id ? (byId.get(drawer.id) ?? (initialItem?.id === drawer.id ? initialItem : null)) : null;

  const dayHref = (d: string) => `${pathname}?${baseQuery ? baseQuery + "&" : ""}view=day&date=${d}`;
  const refresh = useCallback(() => router.refresh(), [router]);

  function closeDrawer() {
    setDrawer(null);
    if (sp.get("item") || sp.get("new")) {
      const q = new URLSearchParams(sp.toString());
      q.delete("item");
      q.delete("new");
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    }
  }

  // ── Drag & drop: reschedule ──
  function reschedule(id: string, day: string, hour?: number, allowConflict = false) {
    const it = byId.get(id);
    if (!it) return;
    const minute = it.publishAt ? zonedParts(new Date(it.publishAt), tz).minute : 0;
    const time = hour != null ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : it.publishAt ? zonedTime(new Date(it.publishAt), tz) : "12:00";
    start(async () => {
      applyPatch({ id, publishAt: zonedToUtc(day, time, tz).toISOString() });
      const res = await moveContent({ id, day, time, tz, allowConflict });
      if (res.ok) {
        setMessage(null);
        refresh();
        return;
      }
      if (res.error === "CONFLICT" && res.conflicts) {
        const list = res.conflicts.map((c) => `• ${c.title} — ${fmtDateTime(c.publishAt, locale, tz)}`).join("\n");
        if (confirm(`${t("content.conflict.title", { minutes: res.windowMinutes ?? options.conflictWindowMinutes })}\n\n${list}\n\n${t("content.conflict.confirmMove")}`)) {
          reschedule(id, day, hour, true);
          return;
        }
      } else {
        setMessage({ tone: "bad", text: t(`content.err.${res.error}`) });
      }
      refresh();
    });
  }

  // ── Drag & drop: status (kanban) ──
  function requestStatus(it: ContentDTO, to: ContentStatus) {
    const tr = allowedTransitions(it.status, perms).find((x) => x.to === to);
    if (!tr) {
      setMessage({ tone: "warning", text: t("content.err.INVALID_TRANSITION") });
      return;
    }
    if (tr.requiresComment) {
      setPendingStatus({ item: it, to, required: true, label: t(`contentStatus.${to}`) });
      return;
    }
    doStatus(it, to);
  }

  function doStatus(it: ContentDTO, to: ContentStatus, comment?: string) {
    start(async () => {
      applyPatch({ id: it.id, status: to });
      const res = await changeStatus({ id: it.id, to, comment: comment ?? null });
      setPendingStatus(null);
      setMessage(res.ok ? null : { tone: "bad", text: t(`content.err.${res.error}`) });
      refresh();
    });
  }

  const dropProps = (key: string, onDrop: (id: string) => void, accept: boolean) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId || !accept) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (overKey !== key) setOverKey(key);
    },
    onDragLeave: () => overKey === key && setOverKey(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragId;
      setOverKey(null);
      setDragId(null);
      if (id) onDrop(id);
    },
  });

  const draggableProps = (it: ContentDTO, enabled: boolean) =>
    enabled
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData("text/plain", it.id);
            e.dataTransfer.effectAllowed = "move";
            setDragId(it.id);
          },
          onDragEnd: () => {
            setDragId(null);
            setOverKey(null);
          },
        }
      : {};

  // ── Bucketing ──
  const scheduled = optimistic.filter((i) => i.publishAt);
  const unscheduled = optimistic.filter((i) => !i.publishAt);
  const byDay = useMemo(() => {
    const m = new Map<string, ContentDTO[]>();
    for (const i of scheduled) {
      const k = zonedDayKey(new Date(i.publishAt as string), tz);
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    for (const xs of m.values()) xs.sort((a, b) => (a.publishAt as string).localeCompare(b.publishAt as string));
    return m;
  }, [scheduled, tz]);

  const flags = (it: ContentDTO) => ({
    due: isDueSoon(it.publishAt, it.status, now),
    overdue: isApprovalOverdue(it.approvalDeadline, it.status, now),
  });

  // ── Chips & cards ──
  function chip(it: ContentDTO, { showTime = true, wide = false }: { showTime?: boolean; wide?: boolean } = {}) {
    const f = flags(it);
    const movable = canMove && !LOCKED_STATUSES.includes(it.status);
    return (
      <button
        key={it.id}
        type="button"
        {...draggableProps(it, movable)}
        onClick={() => setDrawer({ id: it.id })}
        title={`${it.title} · ${t(`contentStatus.${it.status}`)}${f.overdue ? ` · ${t("content.overdueApproval")}` : ""}`}
        className={cx(
          "flex w-full min-w-0 items-center gap-1 rounded-md border-s-[3px] bg-surface-2 px-1.5 py-1 text-start text-[11px] leading-tight hover:bg-brand-soft",
          BORDER[statusTone(it.status)],
          f.due && "ring-1 ring-warn",
          movable && "cursor-grab active:cursor-grabbing",
          dragId === it.id && "opacity-40",
        )}
      >
        {showTime && it.publishAt && <span className="num shrink-0 text-muted">{zonedTime(new Date(it.publishAt), tz)}</span>}
        <span className="shrink-0 font-semibold text-muted">{t(`content.platformShort.${it.platform}`)}</span>
        <span className="truncate">{it.title}</span>
        {wide && <StatusBadge status={it.status} label={t(`contentStatus.${it.status}`)} className="ms-auto" />}
        {f.overdue && <AlertTriangle className="size-3 shrink-0 text-bad" aria-label={t("content.overdueApproval")} />}
        {it.seriesId && <Repeat className="size-3 shrink-0 text-subtle" aria-hidden />}
      </button>
    );
  }

  function card(it: ContentDTO, draggable = false) {
    const f = flags(it);
    return (
      <button
        key={it.id}
        type="button"
        {...draggableProps(it, draggable)}
        onClick={() => setDrawer({ id: it.id })}
        className={cx(
          "w-full rounded-lg border border-border border-s-[3px] bg-surface p-2.5 text-start text-xs shadow-card hover:border-brand/50",
          BORDER[statusTone(it.status)],
          f.due && "ring-1 ring-warn",
          draggable && "cursor-grab active:cursor-grabbing",
          dragId === it.id && "opacity-40",
        )}
      >
        <p className="line-clamp-2 text-sm font-medium">{it.title}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-muted">
          <Badge tone="neutral">{t(`platform.${it.platform}`)}</Badge>
          <Badge tone="neutral">{t(`contentType.${it.type}`)}</Badge>
          {it.isPaid && (
            <Badge tone="brand">
              <Megaphone className="size-3" aria-hidden /> {t("filter.paid")}
            </Badge>
          )}
          {f.overdue && <Badge tone="bad">{t("content.overdueApproval")}</Badge>}
          {f.due && <Badge tone="warning">{t("content.dueSoon")}</Badge>}
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-subtle">
          <Clock className="size-3" aria-hidden />
          {it.publishAt ? <span className="num">{fmtDateTime(it.publishAt, locale, tz)}</span> : t("content.unscheduled")}
          {Object.keys(clientNames).length > 1 && <span>· {clientNames[it.clientId]}</span>}
          {it.assigneeName && <span>· {it.assigneeName}</span>}
        </p>
      </button>
    );
  }

  function unscheduledTray() {
    if (!unscheduled.length) return null;
    return (
      <div className="rounded-card border border-dashed border-border bg-surface p-3">
        <p className="mb-2 text-xs font-medium text-muted">
          {t("content.unscheduledTray")} <span className="num">({fmtNumber(unscheduled.length, locale)})</span>
          {canMove && <span className="text-subtle"> · {t("content.dragToSchedule")}</span>}
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {unscheduled.slice(0, 24).map((it) => (
            chip(it, { showTime: false })
          ))}
        </div>
      </div>
    );
  }

  // ── Views ──
  function monthView() {
    const weekdays = days.slice(0, 7);
    return (
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-[11px] font-medium text-muted">
          {weekdays.map((d) => (
            <div key={d} className="px-1 py-2">
              {dayLabel(d, locale, { weekday: "short" })}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const out = d.slice(0, 7) !== month;
            const key = `m:${d}`;
            return (
              <div
                key={d}
                {...dropProps(key, (id) => reschedule(id, d), canMove)}
                className={cx(
                  "group relative min-h-16 border-b border-e border-border p-1 sm:min-h-28",
                  out && "bg-surface-2/50",
                  overKey === key && "bg-brand-soft ring-2 ring-inset ring-brand",
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <Link
                    href={dayHref(d)}
                    className={cx("num grid size-6 place-items-center rounded-full text-xs hover:bg-surface-2", d === today ? "bg-brand font-semibold text-brand-fg hover:bg-brand" : out ? "text-subtle" : "text-text")}
                    aria-label={dayLabel(d, locale, { weekday: "long", day: "numeric", month: "long" })}
                  >
                    {Number(d.slice(8))}
                  </Link>
                  {canCreate && (
                    <button
                      type="button"
                      onClick={() => setDrawer({ defaults: { day: d } })}
                      className="hidden rounded p-0.5 text-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-brand focus:opacity-100 sm:block"
                      aria-label={t("content.addOn", { day: dayLabel(d, locale) })}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>
                {/* phones: dots; larger screens: draggable chips */}
                <Link href={dayHref(d)} className="flex flex-wrap gap-0.5 sm:hidden" aria-label={t("content.nPosts", { n: list.length })}>
                  {list.slice(0, 6).map((it) => (
                    <span key={it.id} className={cx("size-1.5 rounded-full", STATUS_DOT[statusTone(it.status)])} />
                  ))}
                </Link>
                <div className="hidden space-y-0.5 sm:block">
                  {list.slice(0, 4).map((it) => (
                    chip(it)
                  ))}
                  {list.length > 4 && (
                    <Link href={dayHref(d)} className="block px-1 text-[11px] text-brand hover:underline">
                      {t("content.more", { n: list.length - 4 })}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function timeGrid() {
    const hoursWithItems = days.flatMap((d) => (byDay.get(d) ?? []).map((i) => zonedParts(new Date(i.publishAt as string), tz).hour));
    const first = Math.min(7, ...hoursWithItems);
    const last = Math.max(23, ...hoursWithItems);
    const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    const single = days.length === 1;
    return (
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <div className={cx("grid", single ? "min-w-0" : "min-w-[760px]")} style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="border-b border-e border-border bg-surface-2" />
          {days.map((d) => (
            <div key={d} className={cx("border-b border-e border-border bg-surface-2 px-2 py-2 text-center text-xs font-medium", d === today && "text-brand")}>
              {single ? dayLabel(d, locale, { weekday: "long", day: "numeric", month: "long" }) : <Link href={dayHref(d)} className="hover:underline">{dayLabel(d, locale)}</Link>}
            </div>
          ))}
          {hours.map((h) => (
            <div key={h} className="contents">
              <div className="num border-b border-e border-border px-1 py-1 text-end text-[10px] text-subtle">{clockLabel(h, locale)}</div>
              {days.map((d) => {
                const list = (byDay.get(d) ?? []).filter((i) => zonedParts(new Date(i.publishAt as string), tz).hour === h);
                const key = `h:${d}:${h}`;
                return (
                  <div
                    key={key}
                    {...dropProps(key, (id) => reschedule(id, d, h), canMove)}
                    onDoubleClick={() => canCreate && setDrawer({ defaults: { day: d, time: `${String(h).padStart(2, "0")}:00` } })}
                    className={cx("min-h-10 space-y-0.5 border-b border-e border-border p-0.5", overKey === key && "bg-brand-soft ring-2 ring-inset ring-brand")}
                  >
                    {list.map((it) => (
                      chip(it, { wide: single })
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function listView() {
    const sorted = [...scheduled].sort((a, b) => (a.publishAt as string).localeCompare(b.publishAt as string));
    if (!sorted.length && !unscheduled.length) return <EmptyState title={t("content.empty")} hint={t("content.emptyHint")} />;
    const multi = Object.keys(clientNames).length > 1;
    return (
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="px-3 py-2 text-start font-medium whitespace-nowrap">{t("content.when")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("content.field.title")}</th>
              {multi && <th className="hidden px-3 py-2 text-start font-medium md:table-cell">{t("filter.client")}</th>}
              <th className="px-3 py-2 text-start font-medium">{t("filter.platform")}</th>
              <th className="hidden px-3 py-2 text-start font-medium md:table-cell">{t("filter.ctype")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("ui.status")}</th>
              <th className="hidden px-3 py-2 text-start font-medium lg:table-cell">{t("content.field.assigneeId")}</th>
            </tr>
          </thead>
          <tbody>
            {[...sorted, ...unscheduled].map((it) => {
              const f = flags(it);
              return (
                <tr key={it.id} onClick={() => setDrawer({ id: it.id })} className={cx("cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2/60", f.due && "bg-warn-soft/30")}>
                  <td className="num px-3 py-2 text-xs whitespace-nowrap">{it.publishAt ? fmtDateTime(it.publishAt, locale, tz) : <span className="text-subtle">{t("content.unscheduled")}</span>}</td>
                  <td className="px-3 py-2">
                    <button type="button" className="text-start font-medium hover:text-brand" onClick={() => setDrawer({ id: it.id })}>
                      {it.title}
                    </button>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {f.overdue && <Badge tone="bad">{t("content.overdueApproval")}</Badge>}
                      {f.due && <Badge tone="warning">{t("content.dueSoon")}</Badge>}
                      {it.isPaid && <Badge tone="brand">{t("filter.paid")}</Badge>}
                    </div>
                  </td>
                  {multi && <td className="hidden px-3 py-2 text-xs md:table-cell">{clientNames[it.clientId]}</td>}
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{t(`platform.${it.platform}`)}</td>
                  <td className="hidden px-3 py-2 text-xs md:table-cell">{t(`contentType.${it.type}`)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={it.status} label={t(`contentStatus.${it.status}`)} />
                  </td>
                  <td className="hidden px-3 py-2 text-xs lg:table-cell">{it.assigneeName ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function kanbanView() {
    const allowed = dragItem ? new Set(allowedTransitions(dragItem.status, perms).map((x) => x.to)) : null;
    return (
      <div className="-mx-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
        <div className="flex gap-3">
          {STATUS_FLOW.map((s) => {
            const list = optimistic.filter((i) => i.status === s);
            const key = `k:${s}`;
            const accept = Boolean(allowed?.has(s));
            return (
              <section
                key={s}
                aria-label={t(`contentStatus.${s}`)}
                {...dropProps(key, (id) => {
                  const it = byId.get(id);
                  if (it && it.status !== s) requestStatus(it, s);
                }, accept)}
                className={cx(
                  "flex w-64 shrink-0 flex-col rounded-card border border-border bg-surface-2/60 transition",
                  dragItem && !accept && dragItem.status !== s && "opacity-50",
                  dragItem && accept && "border-brand/60",
                  overKey === key && "bg-brand-soft ring-2 ring-brand",
                )}
              >
                <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold">
                  <span className={cx("size-2 rounded-full", STATUS_DOT[statusTone(s)])} />
                  {t(`contentStatus.${s}`)}
                  <span className="num ms-auto rounded-full bg-surface px-1.5 text-[10px] text-muted">{list.length}</span>
                </header>
                <div className="flex max-h-[70vh] min-h-24 flex-col gap-2 overflow-y-auto p-2">
                  {list.map((it) => (
                    card(it, allowedTransitions(it.status, perms).length > 0)
                  ))}
                  {!list.length && <p className="py-4 text-center text-[11px] text-subtle">{t("content.emptyColumn")}</p>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  function groupedView(by: "campaign" | "platform") {
    const groups = new Map<string, ContentDTO[]>();
    for (const it of optimistic) {
      const k = by === "campaign" ? (it.campaignName ?? "") : it.platform;
      groups.set(k, [...(groups.get(k) ?? []), it]);
    }
    const entries = [...groups.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : b[1].length - a[1].length));
    if (!entries.length) return <EmptyState title={t("content.empty")} hint={t("content.emptyHint")} />;
    return (
      <div className="space-y-4">
        {entries.map(([k, list]) => {
          const published = list.filter((i) => i.status === "PUBLISHED").length;
          return (
            <section key={k || "_none"} className="rounded-card border border-border bg-surface">
              <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                <h3 className="text-sm font-semibold">{by === "platform" ? t(`platform.${k}`) : k || t("content.noCampaign")}</h3>
                <Badge tone="neutral">
                  <span className="num">{fmtNumber(list.length, locale)}</span> {t("content.posts")}
                </Badge>
                <span className="text-xs text-muted">
                  {t("content.publishedOf", { n: published, total: list.length })}
                </span>
              </header>
              <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {list
                  .sort((a, b) => (a.publishAt ?? "9").localeCompare(b.publishAt ?? "9"))
                  .map((it) => (
                    card(it)
                  ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canCreate && (
          <Button variant="primary" onClick={() => setDrawer({ defaults: { day: view === "day" ? days[0] : undefined } })}>
            <CalendarPlus className="size-4" aria-hidden /> {t("content.newPost")}
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm ring-1 ring-warn" /> {t("content.dueSoonLegend")}
          </span>
          <span className="inline-flex items-center gap-1">
            <AlertTriangle className="size-3 text-bad" aria-hidden /> {t("content.overdueApproval")}
          </span>
          {canMove && ["month", "week", "day", "kanban"].includes(view) && <span className="hidden sm:inline">{t(view === "kanban" ? "content.dndKanbanHint" : "content.dndHint")}</span>}
        </div>
      </div>

      {message && <Callout tone={message.tone === "good" ? "good" : message.tone}>{message.text}</Callout>}

      {["month", "week", "day"].includes(view) && unscheduledTray()}
      {view === "month" && monthView()}
      {(view === "week" || view === "day") && timeGrid()}
      {view === "list" && listView()}
      {view === "kanban" && kanbanView()}
      {view === "campaign" && groupedView("campaign")}
      {view === "platform" && groupedView("platform")}

      {drawer && (
        <ContentDrawer
          key={drawerItem ? `${drawerItem.id}:${drawerItem.updatedAt}` : "new"}
          item={drawerItem ?? null}
          defaults={drawer.defaults}
          options={options}
          onClose={closeDrawer}
          onChanged={refresh}
        />
      )}
      {pendingStatus && (
        <CommentDialog
          title={t("content.moveTo", { status: pendingStatus.label })}
          required={pendingStatus.required}
          confirmLabel={t("content.moveTo", { status: pendingStatus.label })}
          onCancel={() => setPendingStatus(null)}
          onConfirm={(c) => doStatus(pendingStatus.item, pendingStatus.to, c)}
        />
      )}
    </div>
  );
}
