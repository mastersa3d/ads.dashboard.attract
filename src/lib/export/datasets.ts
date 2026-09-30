import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Permission } from "@/lib/rbac";
import { byEntity, byPlatform, dailySeries } from "@/lib/queries/performance";
import { toNum } from "@/lib/format";
import type { Kpis } from "@/lib/metrics";
import type { ExportContext } from "./context";

/** Hard cap per export — keeps memory bounded and protects the database. */
export const EXPORT_ROW_LIMIT = 50_000;
const BATCH = 2_000;

export type ColumnType = "text" | "number" | "money" | "pct" | "ratio" | "date" | "datetime" | "bool";
export type ExportColumn = { key: string; label: string; type?: ColumnType };
export type ExportValue = string | number | boolean | Date | null | undefined | string[];
export type ExportRow = Record<string, ExportValue>;

export type DatasetDef = {
  permission: Permission;
  /** Client.hiddenSections key — CLIENT users can't export a section hidden from them. */
  section: string;
  columns: (ctx: ExportContext) => ExportColumn[];
  /** Yields batches so writers can stream; the total never exceeds EXPORT_ROW_LIMIT. */
  rows: (ctx: ExportContext) => AsyncGenerator<ExportRow[]>;
};

const tr = (ctx: ExportContext, prefix: string, v: string | null | undefined) => (v ? ctx.t(`${prefix}.${v}`) : null);
const range = (ctx: ExportContext) => ({ gte: ctx.filters.from, lte: new Date(ctx.filters.to.getTime() + 86_399_999) });

/** Cursor pagination over any model with a string `id`. */
async function* paged<T extends { id: string }>(fetch: (args: { take: number; cursor?: { id: string }; skip?: number }) => Promise<T[]>, map: (r: T) => ExportRow) {
  let cursor: string | undefined;
  let total = 0;
  while (total < EXPORT_ROW_LIMIT) {
    const take = Math.min(BATCH, EXPORT_ROW_LIMIT - total);
    const batch = await fetch({ take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!batch.length) return;
    total += batch.length;
    yield batch.map(map);
    if (batch.length < take) return;
    cursor = batch[batch.length - 1].id;
  }
}

async function* once(rows: ExportRow[]) {
  yield rows.slice(0, EXPORT_ROW_LIMIT);
}

// ───────────── Performance (paid) ─────────────

function metricColumns(ctx: ExportContext): ExportColumn[] {
  const t = ctx.t;
  const cur = ` (${ctx.currency})`;
  return [
    { key: "spend", label: t("kpi.spend") + cur, type: "money" },
    { key: "impressions", label: t("kpi.impressions"), type: "number" },
    { key: "reach", label: t("kpi.reach"), type: "number" },
    { key: "frequency", label: t("kpi.frequency"), type: "ratio" },
    { key: "clicks", label: t("kpi.clicks"), type: "number" },
    { key: "ctr", label: t("kpi.ctr"), type: "pct" },
    { key: "cpc", label: t("kpi.cpc") + cur, type: "money" },
    { key: "cpm", label: t("kpi.cpm") + cur, type: "money" },
    { key: "leads", label: t("kpi.leads"), type: "number" },
    { key: "cpl", label: t("kpi.cpl") + cur, type: "money" },
    { key: "purchases", label: t("kpi.purchases"), type: "number" },
    { key: "cpa", label: t("kpi.cpa") + cur, type: "money" },
    { key: "cvr", label: t("kpi.cvr"), type: "pct" },
    { key: "revenue", label: t("kpi.revenue") + cur, type: "money" },
    { key: "roas", label: t("kpi.roas"), type: "ratio" },
    { key: "videoViews", label: t("kpi.videoViews"), type: "number" },
    { key: "vcr", label: t("kpi.vcr"), type: "pct" },
    { key: "engagements", label: t("kpi.engagements"), type: "number" },
  ];
}

function metricValues(k: Kpis): ExportRow {
  return {
    spend: k.spend,
    impressions: k.impressions,
    reach: k.reach,
    frequency: k.frequency,
    clicks: k.clicks,
    ctr: k.ctr,
    cpc: k.cpc,
    cpm: k.cpm,
    leads: k.leads,
    cpl: k.cpl,
    purchases: k.purchases,
    cpa: k.cpa,
    cvr: k.cvr,
    revenue: k.revenue,
    roas: k.roas,
    videoViews: k.videoViews,
    vcr: k.vcr,
    engagements: k.engagements,
  };
}

const bySpend = <T extends { spend: number }>(a: T, b: T) => b.spend - a.spend;

const campaigns: DatasetDef = {
  permission: "campaigns:view",
  section: "campaigns",
  columns: (ctx) => [
    { key: "name", label: ctx.t("filter.campaign") },
    { key: "account", label: ctx.t("filter.account") },
    { key: "platform", label: ctx.t("filter.platform") },
    { key: "objective", label: ctx.t("filter.objective") },
    { key: "status", label: ctx.t("ui.status") },
    ...metricColumns(ctx),
  ],
  async *rows(ctx) {
    const rows = (await byEntity(ctx.filters, ctx.q, "campaign")).sort(bySpend);
    const meta = new Map(
      (await db.campaign.findMany({ where: { id: { in: rows.map((r) => r.id) }, ...ctx.scope }, select: { id: true, account: { select: { name: true } } } })).map((c) => [c.id, c.account.name]),
    );
    yield* once(
      rows.map((r) => ({
        name: r.name,
        account: meta.get(r.id) ?? null,
        platform: tr(ctx, "platform", r.platform),
        objective: tr(ctx, "objective", r.objective),
        status: tr(ctx, "campaignStatus", r.status),
        ...metricValues(r),
      })),
    );
  },
};

const adsets: DatasetDef = {
  permission: "campaigns:view",
  section: "campaigns",
  columns: (ctx) => [
    { key: "campaign", label: ctx.t("filter.campaign") },
    { key: "name", label: ctx.t("filter.adset") },
    { key: "audience", label: ctx.t("filter.audience") },
    { key: "status", label: ctx.t("ui.status") },
    ...metricColumns(ctx),
  ],
  async *rows(ctx) {
    const rows = (await byEntity(ctx.filters, ctx.q, "adSet")).sort(bySpend);
    const meta = new Map(
      (
        await db.adSet.findMany({ where: { id: { in: rows.map((r) => r.id) }, campaign: ctx.scope }, select: { id: true, audience: true, campaign: { select: { name: true } } } })
      ).map((a) => [a.id, a]),
    );
    yield* once(
      rows.map((r) => ({ campaign: meta.get(r.id)?.campaign.name ?? null, name: r.name, audience: meta.get(r.id)?.audience ?? null, status: tr(ctx, "campaignStatus", r.status), ...metricValues(r) })),
    );
  },
};

const ads: DatasetDef = {
  permission: "campaigns:view",
  section: "campaigns",
  columns: (ctx) => [
    { key: "campaign", label: ctx.t("filter.campaign") },
    { key: "adset", label: ctx.t("filter.adset") },
    { key: "name", label: ctx.t("filter.ad") },
    { key: "format", label: ctx.t("analytics.col_format") },
    { key: "headline", label: ctx.t("analytics.col_headline") },
    { key: "status", label: ctx.t("ui.status") },
    ...metricColumns(ctx),
  ],
  async *rows(ctx) {
    const rows = (await byEntity(ctx.filters, ctx.q, "ad")).sort(bySpend);
    const meta = new Map(
      (
        await db.ad.findMany({
          where: { id: { in: rows.map((r) => r.id) }, adSet: { campaign: ctx.scope } },
          select: { id: true, headline: true, adSet: { select: { name: true, campaign: { select: { name: true } } } } },
        })
      ).map((a) => [a.id, a]),
    );
    yield* once(
      rows.map((r) => {
        const m = meta.get(r.id);
        return { campaign: m?.adSet.campaign.name ?? null, adset: m?.adSet.name ?? null, name: r.name, format: tr(ctx, "contentType", r.format), headline: m?.headline ?? null, status: tr(ctx, "campaignStatus", r.status), ...metricValues(r) };
      }),
    );
  },
};

const platforms: DatasetDef = {
  permission: "analytics:view",
  section: "analytics",
  columns: (ctx) => [{ key: "platform", label: ctx.t("filter.platform") }, ...metricColumns(ctx)],
  async *rows(ctx) {
    const rows = (await byPlatform(ctx.filters, ctx.q)).sort(bySpend);
    yield* once(rows.map((r) => ({ platform: tr(ctx, "platform", r.platform), ...metricValues(r) })));
  },
};

const daily: DatasetDef = {
  permission: "analytics:view",
  section: "analytics",
  columns: (ctx) => [{ key: "date", label: ctx.t("ui.date"), type: "date" }, ...metricColumns(ctx)],
  async *rows(ctx) {
    const rows = await dailySeries(ctx.filters, ctx.q);
    yield* once(rows.map((r) => ({ date: r.date, ...metricValues(r) })));
  },
};

// ───────────── Content, budget, intelligence, ops ─────────────

const content: DatasetDef = {
  permission: "content:view",
  section: "calendar",
  columns: (ctx) => {
    const t = ctx.t;
    return [
      { key: "title", label: t("analytics.col_title") },
      { key: "client", label: t("filter.client") },
      { key: "brand", label: t("filter.brand") },
      { key: "platform", label: t("filter.platform") },
      { key: "type", label: t("filter.ctype") },
      { key: "status", label: t("filter.cstatus") },
      { key: "publishAt", label: t("analytics.col_publishAt"), type: "datetime" },
      { key: "pillar", label: t("analytics.col_pillar") },
      { key: "funnel", label: t("filter.funnel") },
      { key: "objective", label: t("filter.objective") },
      { key: "campaign", label: t("filter.campaign") },
      { key: "assignee", label: t("ui.owner") },
      { key: "caption", label: t("analytics.col_caption") },
      { key: "hook", label: t("analytics.col_hook") },
      { key: "cta", label: t("analytics.col_cta") },
      { key: "hashtags", label: t("analytics.col_hashtags") },
      { key: "isPaid", label: t("filter.paid"), type: "bool" },
      { key: "boostBudget", label: t("analytics.col_boostBudget"), type: "number" },
      { key: "resultReach", label: t("kpi.reach"), type: "number" },
      { key: "resultEngagements", label: t("kpi.engagements"), type: "number" },
      { key: "publishedUrl", label: t("analytics.col_url") },
      { key: "source", label: t("ui.source") },
    ];
  },
  rows(ctx) {
    const f = ctx.filters;
    const where: Prisma.ContentItemWhereInput = { ...ctx.scope, OR: [{ publishAt: range(ctx) }, { publishAt: null, createdAt: range(ctx) }] };
    if (f.platforms.length) where.platform = { in: f.platforms };
    if (f.brandId) where.brandId = f.brandId;
    if (f.contentType) where.type = f.contentType;
    if (f.contentStatus) where.status = f.contentStatus;
    if (f.creatorId) where.assigneeId = f.creatorId;
    if (f.objective) where.objective = f.objective;
    if (f.funnel) where.funnelStage = f.funnel;
    return paged(
      (a) =>
        db.contentItem.findMany({
          ...a,
          where,
          orderBy: [{ id: "asc" }],
          include: { client: { select: { name: true } }, brand: { select: { name: true } }, assignee: { select: { name: true } } },
        }),
      (c) => ({
        title: c.title,
        client: c.client.name,
        brand: c.brand?.name ?? null,
        platform: tr(ctx, "platform", c.platform),
        type: tr(ctx, "contentType", c.type),
        status: tr(ctx, "contentStatus", c.status),
        publishAt: c.publishAt,
        pillar: c.pillar,
        funnel: tr(ctx, "funnel", c.funnelStage),
        objective: tr(ctx, "objective", c.objective),
        campaign: c.campaignName,
        assignee: c.assignee?.name ?? null,
        caption: c.caption,
        hook: c.hook,
        cta: c.cta,
        hashtags: c.hashtags,
        isPaid: c.isPaid,
        boostBudget: c.boostBudget == null ? null : toNum(c.boostBudget),
        resultReach: c.resultReach,
        resultEngagements: c.resultEngagements,
        publishedUrl: c.publishedUrl,
        source: tr(ctx, "source", c.source),
      }),
    );
  },
};

const budget: DatasetDef = {
  permission: "budget:view",
  section: "budget",
  columns: (ctx) => {
    const t = ctx.t;
    return [
      { key: "plan", label: t("analytics.col_plan") },
      { key: "client", label: t("filter.client") },
      { key: "planStatus", label: t("ui.status") },
      { key: "start", label: t("ui.from"), type: "date" },
      { key: "end", label: t("ui.to"), type: "date" },
      { key: "currency", label: t("filter.currency") },
      { key: "category", label: t("analytics.col_category") },
      { key: "label", label: t("analytics.col_line") },
      { key: "platform", label: t("filter.platform") },
      { key: "funnel", label: t("filter.funnel") },
      { key: "plannedBudget", label: t("kpi.plannedBudget"), type: "number" },
      { key: "plannedImpressions", label: t("kpi.impressions"), type: "number" },
      { key: "plannedReach", label: t("kpi.reach"), type: "number" },
      { key: "plannedClicks", label: t("kpi.clicks"), type: "number" },
      { key: "plannedLeads", label: t("kpi.leads"), type: "number" },
      { key: "plannedSales", label: t("kpi.purchases"), type: "number" },
      { key: "plannedRevenue", label: t("kpi.revenue"), type: "number" },
      { key: "notes", label: t("ui.notes") },
    ];
  },
  rows(ctx) {
    const f = ctx.filters;
    const where: Prisma.BudgetLineWhereInput = { plan: { ...ctx.scope, startDate: { lte: f.to }, endDate: { gte: f.from } } };
    if (f.platforms.length) where.OR = [{ platform: { in: f.platforms } }, { platform: null }];
    return paged(
      (a) => db.budgetLine.findMany({ ...a, where, orderBy: [{ id: "asc" }], include: { plan: { include: { client: { select: { name: true } } } } } }),
      (l) => ({
        plan: l.plan.name,
        client: l.plan.client.name,
        planStatus: l.plan.status,
        start: l.plan.startDate,
        end: l.plan.endDate,
        currency: l.plan.currency,
        category: l.category,
        label: l.label,
        platform: tr(ctx, "platform", l.platform),
        funnel: tr(ctx, "funnel", l.funnelStage),
        plannedBudget: toNum(l.plannedBudget),
        plannedImpressions: l.plannedImpressions,
        plannedReach: l.plannedReach,
        plannedClicks: l.plannedClicks,
        plannedLeads: l.plannedLeads,
        plannedSales: l.plannedSales,
        plannedRevenue: toNum(l.plannedRevenue),
        notes: l.notes,
      }),
    );
  },
};

const benchmarks: DatasetDef = {
  permission: "benchmarks:view",
  section: "benchmarks",
  columns: (ctx) => {
    const t = ctx.t;
    return [
      { key: "metric", label: t("benchmarks.metric") },
      { key: "platform", label: t("filter.platform") },
      { key: "country", label: t("filter.country") },
      { key: "industry", label: t("benchmarks.industry") },
      { key: "businessSize", label: t("benchmarks.businessSize") },
      { key: "productType", label: t("benchmarks.productType") },
      { key: "b2b", label: t("benchmarks.b2b") },
      { key: "objective", label: t("filter.objective") },
      { key: "audienceType", label: t("benchmarks.audienceType") },
      { key: "p25", label: "P25", type: "number" },
      { key: "median", label: t("benchmarks.median"), type: "number" },
      { key: "p75", label: "P75", type: "number" },
      { key: "higherIsBetter", label: t("benchmarks.higherIsBetter"), type: "bool" },
      { key: "sourceName", label: t("ui.source") },
      { key: "sourceUrl", label: t("benchmarks.sourceUrl") },
      { key: "sampleSize", label: t("benchmarks.sampleSize"), type: "number" },
      { key: "periodLabel", label: t("benchmarks.period") },
      { key: "asOf", label: t("benchmarks.asOf"), type: "date" },
      { key: "isManual", label: t("benchmarks.companyBenchmark"), type: "bool" },
      { key: "isEstimate", label: t("ui.estimate"), type: "bool" },
    ];
  },
  rows(ctx) {
    const f = ctx.filters;
    const where: Prisma.BenchmarkWhereInput = { OR: [{ organizationId: null }, { organizationId: ctx.org.id }] };
    if (f.platforms.length) where.platform = { in: f.platforms };
    if (f.country) where.country = f.country;
    if (f.objective) where.objective = f.objective;
    return paged(
      (a) => db.benchmark.findMany({ ...a, where, orderBy: [{ id: "asc" }] }),
      (b) => ({
        metric: ctx.t(`benchmarks.m_${b.metric}`),
        platform: tr(ctx, "platform", b.platform),
        country: b.country,
        industry: b.industry,
        businessSize: b.businessSize,
        productType: b.productType,
        b2b: b.isB2B == null ? null : b.isB2B ? "B2B" : "B2C",
        objective: tr(ctx, "objective", b.objective),
        audienceType: b.audienceType,
        p25: b.p25,
        median: b.median,
        p75: b.p75,
        higherIsBetter: b.higherIsBetter,
        sourceName: b.sourceName,
        sourceUrl: b.sourceUrl,
        sampleSize: b.sampleSize,
        periodLabel: b.periodLabel,
        asOf: b.asOf,
        isManual: b.isManual,
        isEstimate: b.isEstimate,
      }),
    );
  },
};

const competitors: DatasetDef = {
  permission: "competitors:view",
  section: "competitors",
  columns: (ctx) => {
    const t = ctx.t;
    return [
      { key: "name", label: t("ui.name") },
      { key: "client", label: t("filter.client") },
      { key: "website", label: t("analytics.col_url") },
      { key: "platforms", label: t("filter.platform") },
      { key: "origin", label: t("analytics.col_origin") },
      { key: "state", label: t("ui.status") },
      { key: "postingPerWeek", label: t("analytics.col_postingPerWeek"), type: "number" },
      { key: "engagementLevel", label: t("kpi.engagementRate") },
      { key: "contentTypes", label: t("filter.ctype") },
      { key: "pillars", label: t("analytics.col_pillar") },
      { key: "strengths", label: t("analytics.col_strengths") },
      { key: "weaknesses", label: t("analytics.col_weaknesses") },
      { key: "opportunities", label: t("analytics.col_opportunities") },
      { key: "source", label: t("ui.source") },
      { key: "updatedAt", label: t("ui.lastUpdated"), type: "datetime" },
    ];
  },
  rows(ctx) {
    const where: Prisma.CompetitorWhereInput = { ...ctx.scope };
    if (ctx.filters.platforms.length) where.activePlatforms = { hasSome: ctx.filters.platforms };
    return paged(
      (a) => db.competitor.findMany({ ...a, where, orderBy: [{ id: "asc" }], include: { client: { select: { name: true } } } }),
      (c) => ({
        name: c.name,
        client: c.client.name,
        website: c.website,
        platforms: c.activePlatforms.map((p) => ctx.t(`platform.${p}`)),
        origin: c.origin,
        state: c.state,
        postingPerWeek: c.postingPerWeek,
        engagementLevel: c.engagementLevel,
        contentTypes: c.contentTypes,
        pillars: c.pillars,
        strengths: c.strengths,
        weaknesses: c.weaknesses,
        opportunities: c.opportunities,
        source: tr(ctx, "source", c.source),
        updatedAt: c.updatedAt,
      }),
    );
  },
};

const competitorAds: DatasetDef = {
  permission: "competitors:view",
  section: "competitors",
  columns: (ctx) => {
    const t = ctx.t;
    return [
      { key: "competitor", label: t("analytics.col_competitor") },
      { key: "platform", label: t("filter.platform") },
      { key: "libraryId", label: t("analytics.col_libraryId") },
      { key: "libraryUrl", label: t("analytics.col_url") },
      { key: "firstSeen", label: t("analytics.col_firstSeen"), type: "date" },
      { key: "lastSeen", label: t("analytics.col_lastSeen"), type: "date" },
      { key: "isActive", label: t("campaignStatus.ACTIVE"), type: "bool" },
      { key: "format", label: t("analytics.col_format") },
      { key: "hook", label: t("analytics.col_hook") },
      { key: "offer", label: t("analytics.col_offer") },
      { key: "message", label: t("analytics.col_message") },
      { key: "cta", label: t("analytics.col_cta") },
      { key: "product", label: t("filter.product") },
      { key: "funnel", label: t("filter.funnel") },
      { key: "landingPage", label: t("analytics.col_landingPage") },
      { key: "variantCount", label: t("analytics.col_variants"), type: "number" },
      { key: "spendMin", label: t("analytics.col_spendMin"), type: "number" },
      { key: "spendMax", label: t("analytics.col_spendMax"), type: "number" },
      { key: "source", label: t("ui.source") },
    ];
  },
  rows(ctx) {
    const f = ctx.filters;
    const where: Prisma.CompetitorAdWhereInput = { competitor: ctx.scope, lastSeen: { gte: f.from }, firstSeen: { lte: f.to } };
    if (f.platforms.length) where.platform = { in: f.platforms };
    return paged(
      (a) => db.competitorAd.findMany({ ...a, where, orderBy: [{ id: "asc" }], include: { competitor: { select: { name: true } } } }),
      (c) => ({
        competitor: c.competitor.name,
        platform: tr(ctx, "platform", c.platform),
        libraryId: c.libraryId,
        libraryUrl: c.libraryUrl,
        firstSeen: c.firstSeen,
        lastSeen: c.lastSeen,
        isActive: c.isActive,
        format: tr(ctx, "contentType", c.format),
        hook: c.hook,
        offer: c.offer,
        message: c.message,
        cta: c.cta,
        product: c.product,
        funnel: tr(ctx, "funnel", c.funnelGuess),
        landingPage: c.landingPage,
        variantCount: c.variantCount,
        spendMin: c.officialSpendMin == null ? null : toNum(c.officialSpendMin),
        spendMax: c.officialSpendMax == null ? null : toNum(c.officialSpendMax),
        source: tr(ctx, "source", c.source),
      }),
    );
  },
};

const ideas: DatasetDef = {
  permission: "trends:view",
  section: "trends",
  columns: (ctx) => {
    const t = ctx.t;
    return [
      { key: "title", label: t("analytics.col_title") },
      { key: "client", label: t("filter.client") },
      { key: "origin", label: t("analytics.col_origin") },
      { key: "platform", label: t("filter.platform") },
      { key: "format", label: t("analytics.col_format") },
      { key: "objective", label: t("filter.objective") },
      { key: "funnel", label: t("filter.funnel") },
      { key: "priority", label: t("ui.priority") },
      { key: "ease", label: t("analytics.col_ease"), type: "number" },
      { key: "impact", label: t("analytics.col_impact"), type: "number" },
      { key: "competitor", label: t("analytics.col_competitor") },
      { key: "keyword", label: t("analytics.col_keyword") },
      { key: "hook", label: t("analytics.col_hook") },
      { key: "cta", label: t("analytics.col_cta") },
      { key: "addedToCalendar", label: t("analytics.col_inCalendar"), type: "bool" },
      { key: "aiGenerated", label: t("analytics.col_ai"), type: "bool" },
      { key: "source", label: t("ui.source") },
      { key: "createdAt", label: t("analytics.col_createdAt"), type: "datetime" },
    ];
  },
  rows(ctx) {
    const where: Prisma.IdeaWhereInput = { ...ctx.scope };
    if (ctx.filters.platforms.length) where.platform = { in: ctx.filters.platforms };
    if (ctx.filters.objective) where.objective = ctx.filters.objective;
    return paged(
      (a) => db.idea.findMany({ ...a, where, orderBy: [{ id: "asc" }], include: { client: { select: { name: true } } } }),
      (i) => ({
        title: i.title,
        client: i.client.name,
        origin: i.source,
        platform: tr(ctx, "platform", i.platform),
        format: tr(ctx, "contentType", i.format),
        objective: tr(ctx, "objective", i.objective),
        funnel: tr(ctx, "funnel", i.funnelStage),
        priority: tr(ctx, "priority", i.priority),
        ease: i.ease,
        impact: i.impact,
        competitor: i.competitorName,
        keyword: i.keyword,
        hook: i.hook,
        cta: i.cta,
        addedToCalendar: i.addedToCalendar,
        aiGenerated: i.aiGenerated,
        source: tr(ctx, "source", i.dataSource),
        createdAt: i.createdAt,
      }),
    );
  },
};

const tasks: DatasetDef = {
  permission: "tasks:view",
  section: "tasks",
  columns: (ctx) => {
    const t = ctx.t;
    return [
      { key: "title", label: t("analytics.col_title") },
      { key: "client", label: t("filter.client") },
      { key: "status", label: t("ui.status") },
      { key: "priority", label: t("ui.priority") },
      { key: "assignee", label: t("ui.owner") },
      { key: "dueDate", label: t("ui.dueDate"), type: "date" },
      { key: "report", label: t("analytics.col_report") },
      { key: "description", label: t("ui.details") },
      { key: "createdAt", label: t("analytics.col_createdAt"), type: "datetime" },
    ];
  },
  rows(ctx) {
    return paged(
      (a) =>
        db.task.findMany({
          ...a,
          where: { ...ctx.scope },
          orderBy: [{ id: "asc" }],
          include: { client: { select: { name: true } }, assignee: { select: { name: true } }, report: { select: { title: true } } },
        }),
      (x) => ({
        title: x.title,
        client: x.client.name,
        status: tr(ctx, "taskStatus", x.status),
        priority: tr(ctx, "priority", x.priority),
        assignee: x.assignee?.name ?? null,
        dueDate: x.dueDate,
        report: x.report?.title ?? null,
        description: x.description,
        createdAt: x.createdAt,
      }),
    );
  },
};

const auditDataset: DatasetDef = {
  permission: "audit:view",
  section: "audit",
  columns: (ctx) => {
    const t = ctx.t;
    return [
      { key: "createdAt", label: t("ui.date"), type: "datetime" },
      { key: "user", label: t("analytics.col_user") },
      { key: "action", label: t("ui.actions") },
      { key: "entity", label: t("analytics.col_entity") },
      { key: "entityId", label: "ID" },
      { key: "client", label: t("filter.client") },
      { key: "summary", label: t("ui.details") },
      { key: "ip", label: "IP" },
    ];
  },
  rows(ctx) {
    // Audit is organization-level; a selected client narrows it (only if the user can see that client).
    const where: Prisma.AuditLogWhereInput = { organizationId: ctx.org.id, createdAt: range(ctx) };
    if (ctx.filters.clientId && ctx.clientIds.includes(ctx.filters.clientId)) where.clientId = ctx.filters.clientId;
    const names = new Map(ctx.clients.map((c) => [c.id, c.name]));
    return paged(
      (a) => db.auditLog.findMany({ ...a, where, orderBy: [{ id: "asc" }] }),
      (l) => ({
        createdAt: l.createdAt,
        user: l.userEmail,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        client: l.clientId ? (names.get(l.clientId) ?? l.clientId) : null,
        summary: l.summary,
        ip: l.ip,
      }),
    );
  },
};

export const DATASETS: Record<string, DatasetDef> = {
  campaigns,
  adsets,
  ads,
  platforms,
  daily,
  content,
  budget,
  benchmarks,
  competitors,
  "competitor-ads": competitorAds,
  ideas,
  tasks,
  audit: auditDataset,
};
