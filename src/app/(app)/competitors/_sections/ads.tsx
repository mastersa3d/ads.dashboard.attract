import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import { sourcesLabel, toAdView } from "@/lib/competitors/views";
import { Callout, Card, CardHeader, DataMeta, EmptyState } from "@/components/ui/primitives";
import { AdsExplorer } from "@/components/competitors/ads-explorer";

/** Ads analysis across all tracked competitors of the selected client. */
export async function AdsSection({ ctx }: { ctx: PageContext }) {
  const { t, scope, filters } = ctx;
  const competitors = await db.competitor.findMany({
    where: { ...scope, state: "ACCEPTED" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const ads = await db.competitorAd.findMany({
    where: { competitor: { ...scope, state: "ACCEPTED" }, ...(filters.platforms.length ? { platform: { in: filters.platforms } } : {}) },
    orderBy: { firstSeen: "desc" },
    take: 2000,
  });
  const names = new Map(competitors.map((c) => [c.id, c.name]));
  const now = new Date();
  const views = ads.map((a) => toAdView(a, names.get(a.competitorId) ?? "—", now));
  const updated = ads.reduce<Date | null>((m, a) => (!m || a.createdAt > m ? a.createdAt : m), null);
  const q = ctx.query;

  return (
    <div className="space-y-4">
      <Callout tone="info" title={t("competitors.ads.honestyTitle")}>
        {t("competitors.ads.honesty")}
      </Callout>
      <Card>
        <CardHeader
          title={t("competitors.ads.title")}
          subtitle={t("competitors.ads.subtitle")}
          meta={<DataMeta source={sourcesLabel(ads.map((a) => a.source), t, t("competitors.source.adLibrary"))} updated={ctx.rel(updated)} demo={ctx.isDemo} labels={ctx.metaLabels} />}
        />
        {competitors.length === 0 ? (
          <EmptyState title={t("competitors.tracked.empty")} hint={t("competitors.tracked.emptyHint")} />
        ) : (
          <AdsExplorer ads={views} competitors={competitors} canEdit={ctx.can("competitors:edit")} profileHref clientQuery={q} />
        )}
      </Card>
    </div>
  );
}
