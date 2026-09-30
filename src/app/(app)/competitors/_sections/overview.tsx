import Link from "next/link";
import { ChevronRight, Globe, Plus, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import { fmtCompact, fmtDate, fmtNumber, fmtPct, type Locale } from "@/lib/format";
import { aiEnabled } from "@/lib/ai/claude";
import { adLibraryConfigured } from "@/lib/competitors/meta-ad-library";
import { advertisingIntensity, isNewAd } from "@/lib/competitors/intensity";
import { parseFollowers, sourcesLabel } from "@/lib/competitors/views";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, EmptyState, EstimateBadge } from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { RankBarChart } from "@/components/charts/charts";
import { IntensityMeter } from "@/components/competitors/intensity-meter";
import { SuggestionCard } from "@/components/competitors/suggestion-card";
import { CompetitorForm } from "@/components/competitors/competitor-form";
import { ActionForm } from "@/components/competitors/action-form";
import { generateSuggestions } from "@/app/actions/competitors";

const MAX_MANUAL = 4;
const MAX_SUGGESTED = 4;

export async function OverviewSection({ ctx }: { ctx: PageContext }) {
  const { t, locale, scope, filters } = ctx;
  const lc = locale as Locale;
  const clientId = ctx.client!.id;
  const now = new Date();
  const competitors = await db.competitor.findMany({
    where: { ...scope, state: { in: ["ACCEPTED", "PENDING"] } },
    include: { ads: filters.platforms.length ? { where: { platform: { in: filters.platforms } } } : true },
    orderBy: [{ origin: "asc" }, { createdAt: "asc" }],
  });
  const tracked = competitors.filter((c) => c.state === "ACCEPTED");
  const pending = competitors.filter((c) => c.state === "PENDING");
  const manualCount = competitors.filter((c) => c.origin === "MANUAL").length;
  const suggestedSlots = MAX_SUGGESTED - competitors.filter((c) => c.origin === "SUGGESTED").length;
  const canEdit = ctx.can("competitors:edit");

  const rows = tracked.map((c) => ({ c, intensity: advertisingIntensity(c.ads, now), followers: parseFollowers(c.followers) }));
  const allAds = tracked.flatMap((c) => c.ads);
  const updated = [...competitors.map((c) => c.updatedAt), ...allAds.map((a) => a.createdAt)].sort((a, b) => b.getTime() - a.getTime())[0];
  const apiLabel = t("competitors.source.adLibrary");
  const meta = (estimate = false) => (
    <DataMeta source={sourcesLabel([...tracked.map((c) => c.source), ...allAds.map((a) => a.source)], t, apiLabel)} updated={ctx.rel(updated)} demo={ctx.isDemo} estimate={estimate} labels={ctx.metaLabels} />
  );
  const q = ctx.query ? `?${ctx.query}` : "";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard locale={lc} label={t("competitors.kpi.tracked")} value={fmtNumber(tracked.length, lc)} />
        <KpiCard locale={lc} label={t("competitors.kpi.manual")} value={`${manualCount}/${MAX_MANUAL}`} />
        <KpiCard locale={lc} label={t("competitors.kpi.pending")} value={fmtNumber(pending.length, lc)} />
        <KpiCard locale={lc} label={t("competitors.kpi.activeAds")} value={fmtNumber(allAds.filter((a) => a.isActive).length, lc)} />
        <KpiCard locale={lc} label={t("competitors.kpi.newAds")} value={fmtNumber(allAds.filter((a) => isNewAd(a, now)).length, lc)} />
      </div>

      <Card>
        <CardHeader title={t("competitors.tracked.title")} subtitle={t("competitors.tracked.subtitle", { max: MAX_MANUAL })} meta={meta()} />
        <CardBody className="space-y-4">
          {tracked.length === 0 ? (
            <EmptyState title={t("competitors.tracked.empty")} hint={canEdit ? t("competitors.tracked.emptyHint") : undefined} />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rows.map(({ c, intensity, followers }) => {
                const fl = Object.entries(followers);
                return (
                  <li key={c.id} className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
                    <div className="flex items-start gap-3">
                      {c.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- external logo URLs of arbitrary hosts
                        <img src={c.logoUrl} alt="" className="size-10 shrink-0 rounded-lg border border-border object-cover" />
                      ) : (
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-sm font-bold text-brand" aria-hidden>
                          {c.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <Link href={`/competitors/${c.id}${q}`} className="block truncate text-sm font-semibold hover:text-brand">
                          {c.name}
                        </Link>
                        {c.website && (
                          <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 text-xs text-muted hover:text-brand">
                            <Globe className="size-3 shrink-0" aria-hidden /> <span className="truncate" dir="ltr">{c.website.replace(/^https?:\/\//, "")}</span>
                          </a>
                        )}
                      </div>
                      <Badge tone={c.origin === "MANUAL" ? "neutral" : "info"}>{t(`competitors.origin.${c.origin}`)}</Badge>
                    </div>
                    {c.activePlatforms.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {c.activePlatforms.map((p) => (
                          <Badge key={p}>{t(`platform.${p}`)}</Badge>
                        ))}
                      </div>
                    )}
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-subtle">{t("competitors.f.followers")}</dt>
                        <dd>
                          {fl.length ? (
                            <span title={fl.map(([k, f]) => `${t(`competitors.social.${k}`)}: ${f.source}, ${f.asOf.slice(0, 10)}`).join("\n")}>
                              {fl.map(([k, f]) => (
                                <span key={k} className="me-2 inline-block">
                                  <span className="num font-medium">{fmtCompact(f.count, lc)}</span> <span className="text-subtle">{t(`competitors.social.${k}`)}</span>
                                  {f.growthPct != null && <span className={`num ms-1 ${f.growthPct >= 0 ? "text-good" : "text-bad"}`}>{fmtPct(f.growthPct, lc, 1)}</span>}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="text-subtle">{t("competitors.noData")}</span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-subtle">{t("competitors.f.postingPerWeek")}</dt>
                        <dd className="num">{c.postingPerWeek != null ? fmtNumber(c.postingPerWeek, lc, 1) : <span className="text-subtle">{t("competitors.noData")}</span>}</dd>
                      </div>
                      <div>
                        <dt className="text-subtle">{t("competitors.f.engagementLevel")}</dt>
                        <dd>{c.engagementLevel ? t(`competitors.level.${c.engagementLevel}`) : <span className="text-subtle">—</span>}</dd>
                      </div>
                      <div>
                        <dt className="text-subtle">{t("competitors.kpi.activeAds")}</dt>
                        <dd className="num">
                          {fmtNumber(c.ads.filter((a) => a.isActive).length, lc)} / {fmtNumber(c.ads.length, lc)}
                        </dd>
                      </div>
                    </dl>
                    <IntensityMeter intensity={intensity} compact />
                    <Link href={`/competitors/${c.id}${q}`} className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                      {t("competitors.openProfile")} <ChevronRight className="size-3.5 flip-rtl" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {canEdit &&
            (manualCount < MAX_MANUAL ? (
              <details className="rounded-lg border border-border p-3">
                <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-brand">
                  <Plus className="size-4" aria-hidden /> {t("competitors.add")} <span className="num text-xs text-subtle">({t("competitors.slotsLeft", { n: MAX_MANUAL - manualCount })})</span>
                </summary>
                <div className="mt-3">
                  <CompetitorForm clientId={clientId} />
                </div>
              </details>
            ) : (
              <Callout tone="info">{t("competitors.err.maxManual", { max: MAX_MANUAL })}</Callout>
            ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-4 text-brand" aria-hidden /> {t("competitors.suggest.title")}
            </span>
          }
          subtitle={t("competitors.suggest.subtitle", { max: MAX_SUGGESTED })}
          meta={<DataMeta source={t("competitors.suggest.sources")} updated={ctx.rel(pending[0]?.createdAt)} demo={ctx.isDemo} labels={ctx.metaLabels} />}
        />
        <CardBody className="space-y-4">
          {pending.length === 0 ? (
            <EmptyState title={t("competitors.suggest.empty")} hint={canEdit ? t("competitors.suggest.emptyHint") : undefined} />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {pending.map((s) => (
                <li key={s.id}>
                  <SuggestionCard
                    s={{ id: s.id, name: s.name, website: s.website, reason: s.suggestionReason, platforms: s.activePlatforms, source: s.source, notes: s.notes, createdAt: s.createdAt.toISOString() }}
                    canEdit={canEdit}
                    manualSlotsLeft={MAX_MANUAL - manualCount}
                  />
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="space-y-2 border-t border-border pt-3">
              <ul className="flex flex-wrap gap-2 text-xs">
                <li>
                  <Badge tone={adLibraryConfigured() ? "good" : "neutral"}>
                    {t("competitors.source.adLibrary")}: {adLibraryConfigured() ? t("competitors.status.on") : t("competitors.status.off")}
                  </Badge>
                </li>
                <li>
                  <Badge tone="good">
                    {t("competitors.suggest.signal.workspace")}: {t("competitors.status.on")}
                  </Badge>
                </li>
                <li>
                  <Badge tone={aiEnabled() && ctx.can("ai:use") ? "good" : "neutral"}>
                    AI: {aiEnabled() && ctx.can("ai:use") ? t("competitors.status.on") : t("competitors.status.off")}
                  </Badge>
                </li>
              </ul>
              {suggestedSlots > 0 ? (
                <ActionForm action={generateSuggestions} hidden={{ clientId }} submitVariant="secondary" submitLabel={t("competitors.suggest.generate", { n: suggestedSlots })} />
              ) : (
                <p className="text-xs text-subtle">{t("competitors.err.maxSuggested", { max: MAX_SUGGESTED })}</p>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader
            title={t("competitors.intensity.compareTitle")}
            subtitle={t("competitors.intensity.compareSubtitle")}
            meta={meta(true)}
            actions={<EstimateBadge label={t("ui.estimate")} hint={t("competitors.intensity.disclaimer")} />}
          />
          <CardBody>
            {rows.some((r) => r.intensity) ? (
              <RankBarChart
                data={rows
                  .filter((r) => r.intensity)
                  .sort((a, b) => b.intensity!.score - a.intensity!.score)
                  .map((r) => ({ label: r.c.name, value: r.intensity!.score }))}
                valueKey="value"
                colorByIndex
              />
            ) : (
              <EmptyState title={t("competitors.intensity.noAds")} hint={t("competitors.ads.emptyHint")} />
            )}
            <p className="mt-2 text-[11px] text-subtle">{t("competitors.intensity.disclaimer")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("competitors.spend.title")} subtitle={t("competitors.spend.subtitle")} meta={meta()} />
          <CardBody>
            {(() => {
              const withSpend = allAds.filter((a) => a.officialSpendMin != null || a.officialSpendMax != null);
              if (!withSpend.length) return <EmptyState title={t("competitors.spend.none")} hint={t("competitors.spend.noneHint")} />;
              return (
                <ul className="space-y-2 text-sm">
                  {tracked
                    .map((c) => ({ c, ads: c.ads.filter((a) => a.officialSpendMin != null || a.officialSpendMax != null) }))
                    .filter((x) => x.ads.length)
                    .map(({ c, ads }) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted">
                          {t("competitors.spend.adsWithRanges", { n: ads.length })} · {fmtDate(ads[0].lastSeen, lc)}
                        </span>
                      </li>
                    ))}
                </ul>
              );
            })()}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
