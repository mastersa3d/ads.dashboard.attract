import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { contentInclude, contentWhere, toDTO } from "@/lib/content/queries";
import { calendarRange } from "@/lib/content/calendar";
import { editorOptions } from "@/lib/content/options";
import { addDays, dayLabel, isDayKey, zonedDayKey, zonedToUtc } from "@/lib/content/tz";
import { fmtRelative, type Locale } from "@/lib/format";
import { buttonClass, Callout, DataMeta, DemoBadge, PageHeader, Tabs } from "@/components/ui/primitives";
import { ExportMenu } from "@/components/ui/export-menu";
import { ContentBoard } from "@/components/content/content-board";
import { CalendarSidebar } from "@/components/content/calendar-sidebar";
import { CALENDAR_VIEWS, type CalendarView } from "@/components/content/types";

export const metadata = { title: "Content Calendar" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CalendarPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "content:view");
  const { t, filters: f, scope } = ctx;
  const locale = ctx.locale as Locale;
  const tz = ctx.timezone;
  const now = new Date();

  const view: CalendarView = CALENDAR_VIEWS.includes(one(sp.view) as CalendarView) ? (one(sp.view) as CalendarView) : "month";
  const today = zonedDayKey(now, tz);
  const anchor = isDayKey(one(sp.date)) ? (one(sp.date) as string) : today;
  const weekStart = locale === "ar" ? 6 : 1; // Saturday (MENA) / Monday
  const range = calendarRange(view, anchor, weekStart);
  const from = zonedToUtc(range.first, "00:00", tz);
  const to = zonedToUtc(addDays(range.last, 1), "00:00", tz);

  // Filtered posts in the visible period + unscheduled work in progress.
  const where = contentWhere(f, scope);
  const [rows, updated, options] = await Promise.all([
    db.contentItem.findMany({
      where: { ...where, OR: [{ publishAt: { gte: from, lt: to } }, { publishAt: null, status: { notIn: ["PUBLISHED", "REJECTED"] } }] },
      include: contentInclude,
      orderBy: [{ publishAt: "asc" }, { createdAt: "asc" }],
      take: 1500,
    }),
    db.contentItem.aggregate({ where: scope, _max: { updatedAt: true } }),
    editorOptions(ctx),
  ]);
  const items = rows.map(toDTO);

  // Deep link (?item=) to a post outside the visible period.
  const itemId = one(sp.item);
  let initialItem = null;
  if (itemId && !items.some((i) => i.id === itemId)) {
    const found = await db.contentItem.findFirst({ where: { id: itemId, ...scope }, include: contentInclude });
    initialItem = found ? toDTO(found) : null;
  }

  // Best-time platform: the platform filter, else the client's most planned platform.
  const counts = new Map<Platform, number>();
  for (const i of items) counts.set(i.platform, (counts.get(i.platform) ?? 0) + 1);
  const platformHint = f.platforms[0] ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const base = ctx.query;
  const href = (patch: { view?: string; date?: string }) => {
    const q = new URLSearchParams(base);
    q.set("view", patch.view ?? view);
    q.set("date", patch.date ?? anchor);
    return `/calendar?${q.toString()}`;
  };

  const title =
    view === "week"
      ? `${dayLabel(range.first, locale, { day: "numeric", month: "short" })} – ${dayLabel(range.last, locale, { day: "numeric", month: "short", year: "numeric" })}`
      : view === "day"
        ? dayLabel(anchor, locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : dayLabel(range.month + "-01", locale, { month: "long", year: "numeric" });

  const clientNames = Object.fromEntries(ctx.clients.filter((c) => ctx.clientIds.includes(c.id)).map((c) => [c.id, c.name]));
  const source = items.some((i) => i.source === "DEMO") ? `${t("content.sourceCalendar")} (${t("source.DEMO")})` : t("content.sourceCalendar");

  return (
    <div id="calendar-root" className="space-y-4">
      <PageHeader
        title={t("nav.calendar")}
        description={t("content.calendarDesc", { tz })}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={<ExportMenu targetId="calendar-root" fileName="content-calendar" />}
      />
      {ctx.isDemo && <Callout tone="demo">{t("content.demoBanner")}</Callout>}

      <Tabs active={view} tabs={CALENDAR_VIEWS.map((v) => ({ key: v, label: t(`content.view.${v}`), href: href({ view: v }) }))} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-3" aria-labelledby="cal-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Link href={href({ date: range.prev })} className={buttonClass("secondary", "sm")} aria-label={t("ui.previous")}>
                <ChevronLeft className="size-4 flip-rtl" aria-hidden />
              </Link>
              <Link href={href({ date: today })} className={buttonClass("secondary", "sm")}>
                {t("content.today")}
              </Link>
              <Link href={href({ date: range.next })} className={buttonClass("secondary", "sm")} aria-label={t("ui.next")}>
                <ChevronRight className="size-4 flip-rtl" aria-hidden />
              </Link>
              <h2 id="cal-title" className="ms-2 text-base font-semibold">
                {title}
              </h2>
            </div>
            <DataMeta source={source} updated={updated._max.updatedAt ? fmtRelative(updated._max.updatedAt, locale) : null} demo={ctx.isDemo} labels={ctx.metaLabels} />
          </div>

          <ContentBoard
            view={view}
            days={range.days}
            month={range.month}
            today={today}
            items={items}
            options={options}
            clientNames={clientNames}
            baseQuery={base}
            nowIso={now.toISOString()}
            initialOpenId={itemId ?? null}
            initialItem={initialItem}
            openNew={one(sp.new) === "1" && ctx.can("content:create")}
          />
        </section>

        <CalendarSidebar ctx={ctx} where={where} linkBase={href({})} platformHint={platformHint} />
      </div>
    </div>
  );
}
