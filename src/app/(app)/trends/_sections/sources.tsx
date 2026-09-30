import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import { searchConsoleStatus } from "@/lib/trends/search-console";
import { Callout, Card, CardBody, CardHeader, DataMeta, SimpleTable } from "@/components/ui/primitives";
import { CsvImport, SearchConsoleCard, SignalForm } from "@/components/trends/signal-tools";
import { fmtNumber, type Locale } from "@/lib/format";

/** Trend source adapters: manual entry, Google Trends CSV import, Search Console (when connected). */
export async function SourcesSection({ ctx }: { ctx: PageContext }) {
  const { t, locale, scope } = ctx;
  const lc = locale as Locale;
  const clientId = ctx.client!.id;
  const canEdit = ctx.can("trends:edit");
  const [sc, bySource] = await Promise.all([
    searchConsoleStatus(clientId),
    db.trendSignal.groupBy({ by: ["sourceName", "source"], where: scope, _count: { _all: true }, _max: { discoveredAt: true } }),
  ]);

  return (
    <div className="space-y-4">
      <Callout tone="info" title={t("trends.sources.noScrapingTitle")}>
        {t("trends.sources.noScraping")}
      </Callout>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title={t("trends.sources.searchConsole")} subtitle={t("trends.sources.searchConsoleHint")} />
          <CardBody>
            <SearchConsoleCard
              clientId={clientId}
              state={sc.state}
              site={sc.state === "CONNECTED" ? sc.site : undefined}
              lastSync={sc.state === "CONNECTED" ? ctx.rel(sc.lastSyncAt) : null}
              canManage={ctx.can("integrations:view")}
              canEdit={canEdit}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("trends.sources.inventory")} meta={<DataMeta source={t("trends.sources.inventorySource")} demo={ctx.isDemo} labels={ctx.metaLabels} />} />
          <SimpleTable
            head={[t("ui.source"), t("trends.sources.type"), t("trends.sources.count"), t("trends.sources.latest")]}
            rows={bySource
              .sort((a, b) => b._count._all - a._count._all)
              .map((r) => [r.sourceName, t(`source.${r.source}`), <span key="n" className="num">{fmtNumber(r._count._all, lc)}</span>, ctx.rel(r._max.discoveredAt) ?? "—"])}
            empty={<p className="px-4 py-6 text-center text-sm text-muted">{t("trends.all.empty")}</p>}
          />
        </Card>
      </div>
      {canEdit ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader title={t("trends.sources.googleTrends")} subtitle={t("trends.sources.googleTrendsHint")} />
            <CardBody>
              <CsvImport clientId={clientId} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("trends.sources.manual")} subtitle={t("trends.sources.manualHint")} />
            <CardBody>
              <SignalForm clientId={clientId} />
            </CardBody>
          </Card>
        </div>
      ) : (
        <Callout tone="info">{t("trends.sources.readOnly")}</Callout>
      )}
    </div>
  );
}
