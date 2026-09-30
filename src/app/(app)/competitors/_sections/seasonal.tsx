import Link from "next/link";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { fmtDate, fmtNumber, type Locale } from "@/lib/format";
import { analyseSeason, windowFor } from "@/lib/competitors/seasonal";
import { sourcesLabel } from "@/lib/competitors/views";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, EmptyState, SimpleTable, cx } from "@/components/ui/primitives";
import { GroupedBarChart } from "@/components/charts/charts";

const SPAN = 2; // months per seasonal window

export async function SeasonalSection({ ctx, sp, base }: { ctx: PageContext; sp: RawParams; base: string }) {
  const { t, locale, scope } = ctx;
  const lc = locale as Locale;
  const sep = lc === "ar" ? "، " : ", ";
  const now = new Date();
  const m = Number(typeof sp.smonth === "string" ? sp.smonth : NaN);
  const month = Number.isInteger(m) && m >= 0 && m <= 11 ? m : now.getUTCMonth();
  const w = { month, span: SPAN };
  const thisWin = windowFor(now.getUTCFullYear(), w);

  const [posts, ads, plan] = await Promise.all([
    db.competitorPost.findMany({
      where: { competitor: { ...scope, state: "ACCEPTED" } },
      select: { postedAt: true, type: true, topic: true, occasion: true, engagements: true, source: true, competitor: { select: { name: true } } },
    }),
    db.competitorAd.findMany({
      where: { competitor: { ...scope, state: "ACCEPTED" } },
      select: { firstSeen: true, lastSeen: true, format: true, offer: true, creativeIdea: true, source: true, competitor: { select: { name: true } } },
    }),
    db.contentItem.findMany({
      where: { ...scope, OR: [{ publishAt: { gte: thisWin.from, lt: thisWin.to } }, { publishAt: null }] },
      select: { title: true, pillar: true, campaignName: true, publishAt: true },
      take: 1000,
    }),
  ]);
  const a = analyseSeason(
    posts.map((p) => ({ competitor: p.competitor.name, postedAt: p.postedAt, type: p.type, topic: p.topic, occasion: p.occasion, engagements: p.engagements })),
    ads.map((x) => ({ competitor: x.competitor.name, firstSeen: x.firstSeen, lastSeen: x.lastSeen, format: x.format, offer: x.offer, creativeIdea: x.creativeIdea })),
    plan,
    w,
    now,
  );
  const years = a.years.slice(-4);
  const monthName = (mm: number) => fmtDate(new Date(Date.UTC(2024, mm, 1)), lc, { month: "short" });
  const windowLabel = `${monthName(month)} – ${monthName((month + SPAN - 1) % 12)}`;
  const meta = (
    <DataMeta
      source={sourcesLabel([...posts.map((p) => p.source), ...ads.map((x) => x.source)], t, t("competitors.source.adLibrary"))}
      demo={ctx.isDemo}
      labels={ctx.metaLabels}
    />
  );
  const yearCell = (byYear: Record<number, number>) =>
    years.map((y) => (
      <span key={y} className={cx("num", !byYear[y] && "text-subtle")}>
        {byYear[y] ?? 0}
      </span>
    ));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("competitors.seasonal.title")} subtitle={t("competitors.seasonal.subtitle", { window: windowLabel })} />
        <CardBody>
          <nav aria-label={t("competitors.seasonal.pickWindow")} className="flex flex-wrap gap-1.5">
            {Array.from({ length: 12 }, (_, i) => (
              <Link
                key={i}
                href={`${base}tab=seasonal&smonth=${i}`}
                aria-current={i === month ? "true" : undefined}
                className={cx("rounded-full border px-2.5 py-1 text-xs", i === month ? "border-brand bg-brand-soft font-medium text-brand" : "border-border text-muted hover:bg-surface-2")}
              >
                {monthName(i)}
              </Link>
            ))}
          </nav>
        </CardBody>
      </Card>

      {!a.hasHistory ? (
        <Card>
          <EmptyState title={t("competitors.seasonal.noHistory")} hint={t("competitors.seasonal.noHistoryHint", { window: windowLabel })} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader title={t("competitors.seasonal.yoyTitle")} subtitle={t("competitors.seasonal.yoySubtitle", { window: windowLabel })} meta={meta} />
              <CardBody className="space-y-3">
                <GroupedBarChart
                  data={a.perYear.filter((r) => years.includes(r.year)).map((r) => ({ label: String(r.year), posts: r.posts, ads: r.ads }))}
                  series={[
                    { key: "posts", label: t("competitors.seasonal.posts") },
                    { key: "ads", label: t("competitors.seasonal.ads") },
                  ]}
                />
                <SimpleTable
                  head={[t("competitors.seasonal.year"), t("competitors.seasonal.posts"), t("competitors.seasonal.ads"), t("competitors.seasonal.avgEngagement"), t("competitors.seasonal.activeCompetitors")]}
                  rows={a.perYear
                    .filter((r) => years.includes(r.year))
                    .map((r) => [
                      <span key="y" className="num font-medium">
                        {r.year}
                        {r.year === a.currentYear && <span className="ms-1 text-xs font-normal text-subtle">({t("competitors.seasonal.thisYear")})</span>}
                      </span>,
                      <span key="p" className="num">{fmtNumber(r.posts, lc)}</span>,
                      <span key="a" className="num">{fmtNumber(r.ads, lc)}</span>,
                      <span key="e" className="num">{r.avgEngagement == null ? "—" : fmtNumber(r.avgEngagement, lc)}</span>,
                      <span key="c" className="num">{fmtNumber(r.competitors, lc)}</span>,
                    ])}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("competitors.seasonal.occasionsTitle")} subtitle={t("competitors.seasonal.occasionsSubtitle")} meta={meta} />
              <CardBody>
                {a.occasions.length ? (
                  <GroupedBarChart
                    data={a.occasions.slice(0, 8).map((o) => Object.fromEntries([["label", o.label], ...years.map((y) => [String(y), o.byYear[y] ?? 0])]))}
                    series={years.map((y) => ({ key: String(y), label: String(y) }))}
                  />
                ) : (
                  <EmptyState title={t("competitors.seasonal.noOccasions")} />
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title={t("competitors.seasonal.opportunitiesTitle")} subtitle={t("competitors.seasonal.opportunitiesSubtitle")} meta={meta} />
            <CardBody>
              {a.opportunities.length ? (
                <ul className="grid gap-2 md:grid-cols-2">
                  {a.opportunities.map((o) => (
                    <li key={o.label} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{o.label}</span>
                        <Badge tone={o.kind === "NOT_PLANNED" ? "warning" : "good"}>{t(`competitors.seasonal.opp.${o.kind}`)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">{t(`competitors.seasonal.opp.${o.kind}Hint`, { year: o.lastYear, competitors: o.competitors.join(sep) })}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={t("competitors.seasonal.noOpportunities")} />
              )}
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader title={t("competitors.seasonal.occasionTable")} meta={meta} />
              <SimpleTable
                head={[t("competitors.seasonal.occasion"), ...years.map(String), t("competitors.seasonal.competitors")]}
                rows={a.occasions.map((o) => [<span key="l" className="font-medium">{o.label}</span>, ...yearCell(o.byYear), <span key="c" className="text-xs text-muted">{o.competitors.join(sep)}</span>])}
                empty={<EmptyState title={t("competitors.seasonal.noOccasions")} />}
              />
            </Card>
            <Card>
              <CardHeader title={t("competitors.seasonal.recurringTitle")} subtitle={t("competitors.seasonal.recurringSubtitle")} meta={meta} />
              <SimpleTable
                head={[t("competitors.seasonal.idea"), t("competitors.seasonal.years"), t("competitors.seasonal.competitors")]}
                rows={a.recurringIdeas.slice(0, 15).map((r) => [
                  <span key="l" className="font-medium">{r.label}</span>,
                  <span key="y" className="num text-xs">{r.years.join(", ")}</span>,
                  <span key="c" className="text-xs text-muted">{r.competitors.join(sep)}</span>,
                ])}
                empty={<EmptyState title={t("competitors.seasonal.noRecurring")} />}
              />
            </Card>
            <Card>
              <CardHeader title={t("competitors.seasonal.offersTitle")} subtitle={t("competitors.seasonal.offersSubtitle")} meta={meta} />
              <SimpleTable
                head={[t("competitors.ads.offer"), t("competitors.seasonal.timesSeen")]}
                rows={a.offers.map((o) => [o.label, <span key="n" className="num">{o.n}</span>])}
                empty={<EmptyState title={t("competitors.seasonal.noOffers")} />}
              />
            </Card>
            <Card>
              <CardHeader title={t("competitors.seasonal.formatsTitle")} subtitle={t("competitors.seasonal.formatsSubtitle")} meta={meta} />
              <SimpleTable
                head={[t("competitors.ads.format"), ...years.map(String), t("competitors.seasonal.yearsSeen")]}
                rows={a.adFormats.map((f) => [
                  t(`contentType.${f.label}`),
                  ...yearCell(f.byYear),
                  <Badge key="r" tone={f.yearsSeen >= 2 ? "warning" : "neutral"}>
                    {f.yearsSeen >= 2 ? t("competitors.seasonal.repeated") : t("competitors.seasonal.once")}
                  </Badge>,
                ])}
                empty={<EmptyState title={t("competitors.seasonal.noAds")} />}
              />
            </Card>
          </div>
          <Callout tone="info">{t("competitors.seasonal.method")}</Callout>
        </>
      )}
    </div>
  );
}
