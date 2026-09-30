import type { Platform } from "@prisma/client";
import { Objective } from "@prisma/client";
import { db } from "@/lib/db";
import { pageContext, lastMetricSync, metricSources } from "@/lib/page";
import { filtersToQuery, type Filters, type RawParams } from "@/lib/filters";
import { byPlatform, organicSummary, totals } from "@/lib/queries/performance";
import { convert } from "@/lib/fx";
import { fmtDate, fmtMoney, fmtNumber, fmtPct } from "@/lib/format";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, DemoBadge, EmptyState, PageHeader, type Tone } from "@/components/ui/primitives";
import { ExportMenu } from "@/components/ui/export-menu";
import { BenchmarkCard, type BenchmarkCardData } from "@/components/benchmarks/benchmark-card";
import { ANY, BenchmarkFilters, type BenchmarkFilterField } from "@/components/benchmarks/benchmark-filters";
import { ManualBenchmarks, type ManualBenchmark } from "@/components/benchmarks/manual-benchmarks";
import {
  BENCHMARK_METRICS,
  METRIC_DEFS,
  convertBenchmarkValue,
  estimatePercentile,
  pickBenchmark,
  rateAgainst,
  type BenchmarkCriteria,
  type BenchmarkMetric,
  type Rating,
} from "@/components/benchmarks/model";

export const metadata = { title: "Benchmark Center" };

/** Ad platforms benchmarks are kept for (analytics-only integrations excluded). */
const BENCHMARK_PLATFORMS: Platform[] = ["META", "FACEBOOK", "INSTAGRAM", "GOOGLE_ADS", "TIKTOK", "LINKEDIN", "YOUTUBE", "X"];
const ORGANIC_METRICS: BenchmarkMetric[] = ["ER", "FOLLOWER_GROWTH"];
/** Page-only filter keys (country / platform / objective are global filters shared with the filter bar). */
const PAGE_KEYS = ["industry", "size", "ptype", "b2b", "period", "atype"] as const;

const one = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
};
const distinct = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();

export default async function BenchmarksPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "benchmarks:view");
  const { t, locale, q, currency, scope } = ctx;

  // "*" means "any" explicitly (overrides a default). Strip it before the metric queries.
  const isAny = (k: string) => one(sp[k]) === ANY;
  const f: Filters = {
    ...ctx.filters,
    country: isAny("country") ? undefined : ctx.filters.country,
    objective: isAny("objective") ? undefined : ctx.filters.objective,
    platforms: ctx.filters.platforms.filter((p) => (p as string) !== ANY),
  };
  const exportQuery = filtersToQuery(sp, { country: f.country ?? null, objective: f.objective ?? null, platform: f.platforms.join(",") || null });

  const [profile, benchRows, platformSpend, updated, source] = await Promise.all([
    ctx.client ? db.client.findUnique({ where: { id: ctx.client.id }, select: { country: true, industry: true, isB2B: true } }) : null,
    db.benchmark.findMany({ where: { OR: [{ organizationId: null }, { organizationId: ctx.user.organizationId }] }, orderBy: { asOf: "desc" } }),
    byPlatform(f, q),
    lastMetricSync(scope),
    metricSources(scope, t),
  ]);

  // Effective criteria: URL value → client-profile default → any.
  const topPlatform = [...platformSpend].sort((a, b) => b.spend - a.spend)[0]?.platform ?? null;
  const pick = (key: string, urlValue: string | undefined, fallback: string | null | undefined) => {
    if (isAny(key)) return { value: null as string | null, defaulted: false };
    if (urlValue) return { value: urlValue, defaulted: false };
    return { value: fallback ?? null, defaulted: fallback != null };
  };
  const crit = {
    country: pick("country", f.country, profile?.country),
    industry: pick("industry", one(sp.industry), profile?.industry),
    size: pick("size", one(sp.size), null),
    ptype: pick("ptype", one(sp.ptype), null),
    b2b: pick("b2b", one(sp.b2b), profile ? (profile.isB2B ? "b2b" : "b2c") : null),
    platform: pick("platform", f.platforms[0], topPlatform),
    objective: pick("objective", f.objective, null),
    period: pick("period", one(sp.period), null),
    atype: pick("atype", one(sp.atype), null),
  };
  const criteria: BenchmarkCriteria = {
    platform: crit.platform.value,
    country: crit.country.value,
    industry: crit.industry.value,
    businessSize: crit.size.value,
    productType: crit.ptype.value,
    isB2B: crit.b2b.value == null ? null : crit.b2b.value === "b2b",
    objective: crit.objective.value,
    audienceType: crit.atype.value,
    periodLabel: crit.period.value,
  };

  // Account values for the same platform the benchmarks are matched on (apples to apples).
  const paidFilters: Filters = { ...f, platforms: crit.platform.value ? [crit.platform.value as Platform] : f.platforms };
  const k = await totals(paidFilters, q);

  const picked = new Map(BENCHMARK_METRICS.map((m) => [m, pickBenchmark(benchRows, m, ORGANIC_METRICS.includes(m) && crit.platform.defaulted ? { ...criteria, platform: null } : criteria)]));
  // Organic metrics are measured on the benchmark's own platform (e.g. Instagram ER).
  const organicPlatforms = [...new Set(ORGANIC_METRICS.map((m) => picked.get(m)?.platform ?? crit.platform.value ?? ""))];
  const organic = new Map(
    await Promise.all(organicPlatforms.map(async (p) => [p, await organicSummary({ ...f, platforms: p ? [p as Platform] : [] }, q)] as const)),
  );

  const accountValue = (m: BenchmarkMetric): number | null => {
    switch (m) {
      case "CPM":
        return k.cpm;
      case "CPC":
        return k.cpc;
      case "CTR":
        return k.ctr;
      case "CPL":
        return k.cpl;
      case "CPA":
        return k.conversions > 0 ? k.spend / k.conversions : null;
      case "CPP":
        return k.cpa;
      case "CVR":
        return k.cvr;
      case "ROAS":
        return k.revenue > 0 ? k.roas : null;
      case "VCR":
        return k.vcr;
      case "FREQ":
        return k.frequency;
      case "REACH_EFF":
        return k.spend > 0 ? (k.reach / k.spend) * 1000 : null;
      case "ER":
      case "FOLLOWER_GROWTH": {
        const o = organic.get(picked.get(m)?.platform ?? crit.platform.value ?? "");
        return m === "ER" ? (o?.engagementRate ?? null) : (o?.followersGrowth ?? null);
      }
    }
  };

  // Monetary benchmarks carry their own currency (Benchmark.currency); older rows fall back to the organization's.
  const factor = convert(1, ctx.org.currency, currency, ctx.fx);
  const factorFor = (b: { currency?: string | null }) => convert(1, b.currency ?? ctx.org.currency, currency, ctx.fx);
  const formatter = (m: BenchmarkMetric) => {
    const unit = METRIC_DEFS[m].unit;
    return (n: number | null) => {
      if (n == null) return "—";
      if (unit === "money") return fmtMoney(n, currency, locale, 2);
      if (unit === "pct") return fmtPct(n, locale, 2);
      if (unit === "perMoney") return fmtNumber(n, locale, 0);
      return m === "ROAS" ? `${fmtNumber(n, locale, 2)}x` : fmtNumber(n, locale, 2);
    };
  };
  const matchText = (b: NonNullable<ReturnType<typeof pickBenchmark<(typeof benchRows)[number]>>>) => {
    const parts = [
      b.platform && t(`platform.${b.platform}`),
      b.country,
      b.industry,
      b.businessSize,
      b.productType,
      b.isB2B == null ? null : b.isB2B ? "B2B" : "B2C",
      b.objective && t(`objective.${b.objective}`),
      b.audienceType,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : t("benchmarks.generic");
  };

  const cards: BenchmarkCardData[] = BENCHMARK_METRICS.map((m) => {
    const def = METRIC_DEFS[m];
    const b = picked.get(m) ?? null;
    const value = accountValue(m);
    const fmt = formatter(m);
    const higherIsBetter = b?.higherIsBetter ?? def.higherIsBetter;
    const bm = b
      ? {
          p25: convertBenchmarkValue(b.p25, def.unit, factorFor(b)),
          median: convertBenchmarkValue(b.median, def.unit, factorFor(b))!,
          p75: convertBenchmarkValue(b.p75, def.unit, factorFor(b)),
          higherIsBetter,
        }
      : null;
    const rating: Rating = bm ? rateAgainst(value, bm) : "none";
    let diff: BenchmarkCardData["diff"] = null;
    if (bm && value != null && bm.median) {
      const rel = (value - bm.median) / Math.abs(bm.median);
      const better = higherIsBetter ? rel : -rel;
      const tone: Tone = Math.abs(rel) < 0.03 ? "neutral" : better > 0 ? "good" : "bad";
      const absText = def.unit === "pct" ? `${value - bm.median >= 0 ? "+" : ""}${fmtNumber((value - bm.median) * 100, locale, 2)} ${t("benchmarks.pp")}` : `${value - bm.median >= 0 ? "+" : "−"}${fmt(Math.abs(value - bm.median))}`;
      diff = { abs: absText, pct: `${rel >= 0 ? "+" : ""}${fmtPct(rel, locale, 1)}`, tone };
    }
    const recKey = rating === "good" ? `benchmarks.rec_${m}_good` : `benchmarks.rec_${m}`;
    return {
      metric: m,
      label: t(`benchmarks.m_${m}`),
      definition: t(`benchmarks.def_${m}`, { currency }),
      higherIsBetter,
      value,
      p25: bm?.p25 ?? null,
      median: bm?.median ?? null,
      p75: bm?.p75 ?? null,
      fmt,
      diff,
      percentile: bm ? estimatePercentile(value, bm) : null,
      rating,
      recommendation: t(recKey),
      bench: b
        ? {
            source: b.sourceName,
            sourceUrl: b.sourceUrl && /^https?:\/\//.test(b.sourceUrl) ? b.sourceUrl : null,
            asOf: fmtDate(b.asOf, locale),
            sampleSize: b.sampleSize != null ? fmtNumber(b.sampleSize, locale) : null,
            period: b.periodLabel,
            scope: b.organizationId ? t("benchmarks.scopeCompany") : t("benchmarks.scopeMarket"),
            estimate: b.isEstimate,
            manual: b.isManual,
            match: matchText(b),
          }
        : null,
    };
  });

  const counts = cards.reduce((acc, c) => ({ ...acc, [c.rating]: acc[c.rating] + 1 }), { good: 0, average: 0, bad: 0, none: 0 } as Record<Rating, number>);
  const anyEstimate = cards.some((c) => c.bench?.estimate);

  // Filter options from the benchmark library (+ the client's own profile values).
  const opt = (xs: (string | null | undefined)[]) => distinct(xs).map((v) => ({ value: v, label: v }));
  const fields: BenchmarkFilterField[] = [
    { key: "country", label: t("filter.country"), value: crit.country.value ?? "", defaulted: crit.country.defaulted, options: opt([...benchRows.map((b) => b.country), profile?.country]) },
    { key: "industry", label: t("benchmarks.industry"), value: crit.industry.value ?? "", defaulted: crit.industry.defaulted, options: opt([...benchRows.map((b) => b.industry), profile?.industry]) },
    { key: "size", label: t("benchmarks.businessSize"), value: crit.size.value ?? "", options: opt(benchRows.map((b) => b.businessSize)) },
    { key: "ptype", label: t("benchmarks.productType"), value: crit.ptype.value ?? "", options: opt(benchRows.map((b) => b.productType)) },
    { key: "b2b", label: t("benchmarks.b2b"), value: crit.b2b.value ?? "", defaulted: crit.b2b.defaulted, options: [{ value: "b2b", label: "B2B" }, { value: "b2c", label: "B2C" }] },
    { key: "platform", label: t("filter.platform"), value: crit.platform.value ?? "", defaulted: crit.platform.defaulted, options: BENCHMARK_PLATFORMS.map((p) => ({ value: p, label: t(`platform.${p}`) })) },
    { key: "objective", label: t("filter.objective"), value: crit.objective.value ?? "", options: Object.values(Objective).map((o) => ({ value: o, label: t(`objective.${o}`) })) },
    { key: "period", label: t("benchmarks.period"), value: crit.period.value ?? "", options: opt(benchRows.map((b) => b.periodLabel)) },
    { key: "atype", label: t("benchmarks.audienceType"), value: crit.atype.value ?? "", options: opt(benchRows.map((b) => b.audienceType)) },
  ];

  const manual: ManualBenchmark[] = benchRows
    .filter((b) => b.organizationId === ctx.user.organizationId && b.isManual)
    .map((b) => {
      const metric = BENCHMARK_METRICS.includes(b.metric as BenchmarkMetric) ? (b.metric as BenchmarkMetric) : "CPL";
      const scale = (n: number | null) => (n == null ? null : METRIC_DEFS[metric].unit === "pct" ? Math.round(n * 100 * 10000) / 10000 : n);
      return {
        id: b.id,
        metric,
        platform: b.platform,
        country: b.country,
        industry: b.industry,
        businessSize: b.businessSize,
        productType: b.productType,
        isB2B: b.isB2B,
        objective: b.objective,
        audienceType: b.audienceType,
        p25: scale(b.p25),
        median: scale(b.median)!,
        p75: scale(b.p75),
        higherIsBetter: b.higherIsBetter,
        sourceName: b.sourceName,
        sourceUrl: b.sourceUrl,
        sampleSize: b.sampleSize,
        periodLabel: b.periodLabel,
        asOf: b.asOf.toISOString(),
        isEstimate: b.isEstimate,
      };
    });

  const ratingLabels: Record<Rating, string> = { good: t("tone.good"), average: t("tone.average"), bad: t("tone.bad"), none: t("benchmarks.noRating") };
  const cardLabels = {
    yours: t("benchmarks.yourValue"),
    median: t("benchmarks.marketMedian"),
    range: "P25–P75",
    difference: t("benchmarks.difference"),
    percentile: t("benchmarks.percentile"),
    percentileHint: t("benchmarks.percentileHint"),
    rating: ratingLabels,
    source: t("ui.source"),
    asOf: t("benchmarks.asOf"),
    sample: t("benchmarks.sampleSize"),
    period: t("benchmarks.period"),
    estimate: t("ui.estimate"),
    estimateHint: t("benchmarks.estimateHint"),
    manual: t("benchmarks.companyBenchmark"),
    noBenchmark: t("benchmarks.noBenchmark"),
    noValue: t("benchmarks.noValue"),
    higher: t("benchmarks.higherBetter"),
    lower: t("benchmarks.lowerBetter"),
    matched: t("benchmarks.matchedOn"),
  };
  const meta = <DataMeta source={source} updated={ctx.rel(updated)} demo={ctx.isDemo} labels={ctx.metaLabels} estimate={anyEstimate} />;

  return (
    <div id="benchmarks-root" className="space-y-6">
      <PageHeader
        title={t("benchmarks.title")}
        description={`${ctx.client?.name ?? t("filter.allClients")} · ${fmtDate(f.from, locale)} – ${fmtDate(f.to, locale)} · ${t("benchmarks.subtitle")}`}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={<ExportMenu dataset="benchmarks" query={exportQuery} targetId="benchmarks-root" fileName="benchmarks" />}
      />

      {anyEstimate && <Callout tone="warning" title={t("benchmarks.estimateTitle")}>{t("benchmarks.estimateBody")}</Callout>}
      {!ctx.client && <Callout tone="info">{t("benchmarks.allClientsNote")}</Callout>}

      <Card>
        <CardHeader title={t("benchmarks.filtersTitle")} subtitle={t("benchmarks.filtersHint")} />
        <CardBody>
          <BenchmarkFilters fields={fields} resetKeys={[...PAGE_KEYS, "country", "platform", "objective"]} />
        </CardBody>
      </Card>

      <section aria-labelledby="bm-h" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="bm-h" className="text-sm font-semibold">{t("benchmarks.scorecard")}</h2>
            <div className="mt-1">{meta}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="good"><span className="num">{counts.good}</span> {t("tone.good")}</Badge>
            <Badge tone="warning"><span className="num">{counts.average}</span> {t("tone.average")}</Badge>
            <Badge tone="bad"><span className="num">{counts.bad}</span> {t("tone.bad")}</Badge>
            {counts.none > 0 && <Badge><span className="num">{counts.none}</span> {t("benchmarks.noRating")}</Badge>}
          </div>
        </div>
        <p className="text-xs text-muted">
          {t("benchmarks.methodNote")} {factor !== 1 && t("benchmarks.currencyNote", { orgCurrency: ctx.org.currency, currency, source: ctx.fx.source ?? "" })}
        </p>
        {benchRows.length === 0 ? (
          <Card>
            <EmptyState title={t("benchmarks.emptyLibrary")} hint={t("benchmarks.emptyLibraryHint")} />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <BenchmarkCard key={c.metric} d={c} labels={cardLabels} />
            ))}
          </div>
        )}
      </section>

      <Card id="company-benchmarks">
        <CardHeader
          title={t("benchmarks.manualTitle")}
          subtitle={t("benchmarks.manualSubtitle", { currency: ctx.org.currency })}
          meta={<DataMeta source={t("source.MANUAL")} labels={ctx.metaLabels} />}
        />
        <CardBody>
          <ManualBenchmarks rows={manual} canEdit={ctx.can("benchmarks:edit")} platforms={BENCHMARK_PLATFORMS} objectives={Object.values(Objective)} orgCurrency={ctx.org.currency} />
        </CardBody>
      </Card>
    </div>
  );
}
