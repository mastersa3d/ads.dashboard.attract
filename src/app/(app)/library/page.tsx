import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ChevronLeft, ChevronRight, ImageIcon, LayoutGrid, List, Search } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { contentWhere, toDTO, contentInclude } from "@/lib/content/queries";
import { fmtCompact, fmtDateTime, fmtNumber, fmtPct, fmtRelative, type Locale } from "@/lib/format";
import { Badge, buttonClass, Card, CardHeader, cx, DataMeta, DemoBadge, EmptyState, inputClass, PageHeader, Select, Tabs } from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable } from "@/components/ui/data-table";
import { ExportMenu } from "@/components/ui/export-menu";
import { StatusBadge } from "@/components/content/status-badge";
import { AssetThumb } from "@/components/content/asset-thumb";
import { FileLibrary } from "@/components/content/file-library";

export const metadata = { title: "Content Library" };

const PAGE_SIZE = 36;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "content:view");
  const { t, filters: f, scope } = ctx;
  const locale = ctx.locale as Locale;

  const tab = one(sp.tab) === "files" ? "files" : "content";
  const search = one(sp.search)?.slice(0, 100);
  const layout = one(sp.layout) === "list" ? "list" : "grid";
  const sort = (["recent", "reach", "engagement"] as const).find((s) => s === one(sp.sort)) ?? "recent";
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(ctx.query);
    const cur: Record<string, string | undefined> = { tab, search, layout, sort, kind: one(sp.kind) };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v) q.set(k, v);
    return `/library?${q.toString()}`;
  };

  const header = (
    <>
      <PageHeader
        title={t("nav.library")}
        description={t("content.libraryDesc")}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={<ExportMenu targetId="library-root" fileName="content-library" />}
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "content", label: t("content.libContent"), href: href({ tab: "content", page: null }) },
          { key: "files", label: t("content.libFiles"), href: href({ tab: "files", page: null }) },
        ]}
      />
    </>
  );

  const searchForm = (placeholder: string, extra?: React.ReactNode) => (
    <form action="/library" className="flex flex-wrap items-center gap-2 no-print">
      {[...new URLSearchParams(ctx.query).entries()].map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="tab" value={tab} />
      {tab === "content" && <input type="hidden" name="layout" value={layout} />}
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-subtle" aria-hidden />
        <input name="search" defaultValue={search} placeholder={placeholder} aria-label={placeholder} className={cx(inputClass, "ps-8")} maxLength={100} />
      </div>
      {extra}
      <button className={buttonClass("secondary")}>{t("ui.apply")}</button>
    </form>
  );

  // ───────────── Files tab ─────────────
  if (tab === "files") {
    const kind = (["image", "video", "pdf"] as const).find((k) => k === one(sp.kind));
    const where: Prisma.FileAssetWhereInput = { ...scope };
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (kind) where.mimeType = kind === "pdf" ? "application/pdf" : { startsWith: `${kind}/` };
    const [files, total, latest] = await Promise.all([
      db.fileAsset.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 48, take: 48 }),
      db.fileAsset.count({ where }),
      db.fileAsset.aggregate({ where: scope, _max: { createdAt: true } }),
    ]);
    const uploaders = new Map((await db.user.findMany({ where: { organizationId: ctx.user.organizationId, id: { in: files.map((x) => x.uploadedById).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const clients = ctx.clients.filter((c) => ctx.clientIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name }));
    return (
      <div id="library-root" className="space-y-4">
        {header}
        {searchForm(
          t("content.searchFiles"),
          <div className="w-40">
            <Select name="kind" defaultValue={kind ?? ""} aria-label={t("content.kindLabel")} placeholder={t("ui.all")} options={(["image", "video", "pdf"] as const).map((k) => ({ value: k, label: t(`content.kind.${k}`) }))} />
          </div>,
        )}
        <Card>
          <CardHeader
            title={t("content.libFiles")}
            subtitle={t("content.filesCount", { n: fmtNumber(total, locale) })}
            meta={<DataMeta source={t("content.sourceUploads")} updated={latest._max.createdAt ? fmtRelative(latest._max.createdAt, locale) : null} labels={ctx.metaLabels} />}
          />
          <div className="p-4">
            <FileLibrary
              files={files.map((x) => ({ id: x.id, clientId: x.clientId, name: x.name, url: x.url, mimeType: x.mimeType, sizeBytes: x.sizeBytes, tags: x.tags, createdAt: x.createdAt.toISOString(), uploadedBy: x.uploadedById ? (uploaders.get(x.uploadedById) ?? null) : null }))}
              clients={clients}
              defaultClientId={ctx.client?.id ?? null}
              canUpload={ctx.can("content:edit")}
              canDelete={ctx.can("content:delete")}
            />
          </div>
          <Pager page={page} pages={Math.ceil(total / 48)} href={(p) => href({ page: String(p) })} t={t} />
        </Card>
      </div>
    );
  }

  // ───────────── Content tab ─────────────
  const extra: Prisma.ContentItemWhereInput = search
    ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { caption: { contains: search, mode: "insensitive" } },
          { hook: { contains: search, mode: "insensitive" } },
          { campaignName: { contains: search, mode: "insensitive" } },
          { pillar: { contains: search, mode: "insensitive" } },
          { hashtags: { has: search.startsWith("#") ? search : `#${search}` } },
          { keywords: { has: search.toLowerCase() } },
        ],
      }
    : {};
  const where = contentWhere(f, scope, extra);
  const orderBy: Prisma.ContentItemOrderByWithRelationInput[] =
    sort === "reach"
      ? [{ resultReach: { sort: "desc", nulls: "last" } }]
      : sort === "engagement"
        ? [{ resultEngagements: { sort: "desc", nulls: "last" } }]
        : [{ publishAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
  const [rows, total, perf, latest] = await Promise.all([
    db.contentItem.findMany({ where, include: contentInclude, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.contentItem.count({ where }),
    db.contentItem.aggregate({ where: { ...where, status: "PUBLISHED" }, _count: true, _sum: { resultReach: true, resultEngagements: true } }),
    db.contentItem.aggregate({ where: scope, _max: { updatedAt: true } }),
  ]);
  const items = rows.map(toDTO);
  const reach = perf._sum.resultReach ?? 0;
  const eng = perf._sum.resultEngagements ?? 0;
  const er = (r: number | null, e: number | null) => (r && e != null ? e / r : null);
  const clientName = new Map(ctx.clients.map((c) => [c.id, c.name]));
  const itemHref = (id: string, clientId: string) => `/calendar?client=${clientId}&item=${id}`;
  const demoSource = items.some((i) => i.source === "DEMO");
  const meta = (
    <DataMeta
      source={demoSource ? `${t("content.sourceResults")} (${t("source.DEMO")})` : t("content.sourceResults")}
      updated={latest._max.updatedAt ? fmtRelative(latest._max.updatedAt, locale) : null}
      demo={ctx.isDemo}
      labels={ctx.metaLabels}
    />
  );

  return (
    <div id="library-root" className="space-y-4">
      {header}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard locale={locale} label={t("content.kpiPublished")} value={fmtNumber(perf._count, locale)} />
        <KpiCard locale={locale} label={t("kpi.reach")} value={fmtCompact(reach, locale)} />
        <KpiCard locale={locale} label={t("kpi.engagements")} value={fmtCompact(eng, locale)} />
        <KpiCard locale={locale} label={t("kpi.engagementRate")} value={reach ? fmtPct(eng / reach, locale, 2) : "—"} hint={t("content.erHint")} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {searchForm(
          t("content.searchContent"),
          <div className="w-44">
            <Select name="sort" defaultValue={sort} aria-label={t("content.sortLabel")} options={(["recent", "reach", "engagement"] as const).map((s) => ({ value: s, label: t(`content.sort.${s}`) }))} />
          </div>,
        )}
        <div className="flex gap-1 no-print" role="group" aria-label={t("content.layout")}>
          <Link href={href({ layout: "grid" })} className={buttonClass(layout === "grid" ? "primary" : "secondary", "sm")} aria-label={t("content.grid")} aria-current={layout === "grid" ? "page" : undefined}>
            <LayoutGrid className="size-4" aria-hidden />
          </Link>
          <Link href={href({ layout: "list" })} className={buttonClass(layout === "list" ? "primary" : "secondary", "sm")} aria-label={t("content.list")} aria-current={layout === "list" ? "page" : undefined}>
            <List className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader title={t("content.libContent")} subtitle={t("content.itemsCount", { n: fmtNumber(total, locale) })} meta={meta} />
        {items.length === 0 ? (
          <EmptyState title={search ? t("content.noResults", { q: search }) : t("content.empty")} hint={t("content.emptyHint")} />
        ) : layout === "grid" ? (
          <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((it) => {
              const rate = er(it.resultReach, it.resultEngagements);
              return (
                <li key={it.id}>
                  <Link href={itemHref(it.id, it.clientId)} className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface transition hover:border-brand/50 hover:shadow-card">
                    <div className="aspect-video bg-surface-2">
                      {it.assetUrls[0] ? (
                        <AssetThumb url={it.assetUrls[0]} alt={it.title} className="size-full object-cover" label={t("content.file")} />
                      ) : (
                        <div className="grid size-full place-items-center text-subtle">
                          <ImageIcon className="size-8" aria-hidden />
                          <span className="sr-only">{t("content.noAsset")}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-3">
                      <p className="line-clamp-2 text-sm font-medium">{it.title}</p>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={it.status} label={t(`contentStatus.${it.status}`)} />
                        <Badge tone="neutral">{t(`platform.${it.platform}`)}</Badge>
                        <Badge tone="neutral">{t(`contentType.${it.type}`)}</Badge>
                        {it.isPaid && <Badge tone="brand">{t("filter.paid")}</Badge>}
                      </div>
                      <p className="text-[11px] text-subtle">
                        {it.publishAt ? <span className="num">{fmtDateTime(it.publishAt, locale, it.timezone)}</span> : t("content.unscheduled")}
                        {ctx.clientIds.length > 1 && <> · {clientName.get(it.clientId)}</>}
                        {it.pillar && <> · {it.pillar}</>}
                      </p>
                      <dl className="mt-auto grid grid-cols-3 gap-1 border-t border-border pt-2 text-center">
                        <div>
                          <dt className="text-[10px] text-muted">{t("kpi.reach")}</dt>
                          <dd className="num text-xs font-semibold">{fmtCompact(it.resultReach, locale)}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] text-muted">{t("kpi.engagements")}</dt>
                          <dd className="num text-xs font-semibold">{fmtCompact(it.resultEngagements, locale)}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] text-muted">{t("content.er")}</dt>
                          <dd className="num text-xs font-semibold">{fmtPct(rate, locale, 1)}</dd>
                        </div>
                      </dl>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <DataTable
            searchable={false}
            exportName="content-library"
            pageSize={PAGE_SIZE}
            columns={[
              { key: "title", label: t("content.field.title") },
              { key: "client", label: t("filter.client"), hideOnMobile: true },
              { key: "platform", label: t("filter.platform"), hideOnMobile: true },
              { key: "type", label: t("filter.ctype"), hideOnMobile: true },
              { key: "status", label: t("ui.status") },
              { key: "publishAt", label: t("content.when"), hideOnMobile: true },
              { key: "reach", label: t("kpi.reach"), type: "number" },
              { key: "eng", label: t("kpi.engagements"), type: "number", hideOnMobile: true },
              { key: "er", label: t("content.er"), type: "pct", digits: 2 },
            ]}
            rows={items.map((it) => ({
              _id: it.id,
              title: { v: it.title, d: <Link className="text-brand hover:underline" href={itemHref(it.id, it.clientId)}>{it.title}</Link> },
              client: clientName.get(it.clientId) ?? "",
              platform: t(`platform.${it.platform}`),
              type: t(`contentType.${it.type}`),
              status: { v: t(`contentStatus.${it.status}`), d: <StatusBadge status={it.status} label={t(`contentStatus.${it.status}`)} /> },
              publishAt: { v: it.publishAt ?? "", d: it.publishAt ? <span className="num text-xs">{fmtDateTime(it.publishAt, locale, it.timezone)}</span> : undefined },
              reach: it.resultReach,
              eng: it.resultEngagements,
              er: er(it.resultReach, it.resultEngagements),
            }))}
          />
        )}
        <Pager page={page} pages={Math.ceil(total / PAGE_SIZE)} href={(p) => href({ page: String(p) })} t={t} />
      </Card>
    </div>
  );
}

function Pager({ page, pages, href, t }: { page: number; pages: number; href: (p: number) => string; t: (k: string) => string }) {
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-end gap-2 border-t border-border px-4 py-2 text-xs text-muted no-print" aria-label={t("ui.page")}>
      {page > 1 && (
        <Link href={href(page - 1)} className="rounded p-1 hover:bg-surface-2" aria-label={t("ui.previous")}>
          <ChevronLeft className="size-4 flip-rtl" />
        </Link>
      )}
      <span>
        {t("ui.page")} <span className="num">{page}</span> {t("ui.of")} <span className="num">{pages}</span>
      </span>
      {page < pages && (
        <Link href={href(page + 1)} className="rounded p-1 hover:bg-surface-2" aria-label={t("ui.next")}>
          <ChevronRight className="size-4 flip-rtl" />
        </Link>
      )}
    </nav>
  );
}
