import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Globe, Pencil, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import type { RawParams } from "@/lib/filters";
import { pageContext } from "@/lib/page";
import { fmtCompact, fmtDate, fmtNumber, fmtPct, type Locale } from "@/lib/format";
import { advertisingIntensity, topValues } from "@/lib/competitors/intensity";
import { adLibraryConfigured } from "@/lib/competitors/meta-ad-library";
import { parseFollowers, parseLinks, sourcesLabel, toAdView } from "@/lib/competitors/views";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, DemoBadge, EmptyState, PageHeader, SimpleTable } from "@/components/ui/primitives";
import { ExportMenu } from "@/components/ui/export-menu";
import { IntensityMeter } from "@/components/competitors/intensity-meter";
import { AdsExplorer } from "@/components/competitors/ads-explorer";
import { AdForm } from "@/components/competitors/ad-form";
import { ImportAds, PostForm } from "@/components/competitors/import-ads";
import { CompetitorForm, SOCIAL_KEYS } from "@/components/competitors/competitor-form";
import { SuggestionCard } from "@/components/competitors/suggestion-card";
import { ActionButton } from "@/components/competitors/action-form";
import { deleteCompetitor, deleteCompetitorPost } from "@/app/actions/competitors";

export const metadata = { title: "Competitor profile" };

export default async function CompetitorProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawParams> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await pageContext(sp, "competitors:view");
  const { t, locale, scope, filters } = ctx;
  const lc = locale as Locale;
  const sep = lc === "ar" ? "، " : ", ";

  // Tenant isolation: the competitor must belong to a client in scope.
  const c = await db.competitor.findFirst({
    where: { id, ...scope },
    include: {
      ads: { where: filters.platforms.length ? { platform: { in: filters.platforms } } : undefined, orderBy: { firstSeen: "desc" } },
      posts: { orderBy: { postedAt: "desc" }, take: 500 },
      client: { select: { name: true, country: true, isDemo: true, organizationId: true } },
    },
  });
  if (!c) notFound();

  const now = new Date();
  const canEdit = ctx.can("competitors:edit");
  const links = parseLinks(c.socialLinks);
  const followers = parseFollowers(c.followers);
  const intensity = advertisingIntensity(c.ads, now);
  const adViews = c.ads.map((a) => toAdView(a, c.name, now));
  const isDemo = c.client.isDemo || c.source === "DEMO";
  const manualCount = await db.competitor.count({ where: { clientId: c.clientId, origin: "MANUAL" } });

  // Observed facts from ads/posts complement the manual profile (clearly labelled as detected).
  const detectedMessages = topValues([...c.ads.filter((a) => a.isActive).map((a) => a.offer), ...c.ads.filter((a) => a.isActive).map((a) => a.message)], 3);
  const detectedCtas = topValues(c.ads.map((a) => a.cta), 4);
  const detectedLanding = topValues(c.ads.map((a) => a.landingPage), 4);
  const last30 = c.posts.filter((p) => p.postedAt >= new Date(now.getTime() - 30 * 86_400_000));
  const observedPerWeek = last30.length ? last30.length / (30 / 7) : null;
  const topPosts = [...c.posts].sort((a, b) => Number(b.isTopPost) - Number(a.isTopPost) || (b.engagements ?? -1) - (a.engagements ?? -1)).slice(0, 8);
  const q = ctx.query ? `?${ctx.query}` : "";
  const updated = [c.updatedAt, ...c.ads.map((a) => a.createdAt)].sort((a, b) => b.getTime() - a.getTime())[0];
  const meta = <DataMeta source={sourcesLabel([c.source, ...c.ads.map((a) => a.source)], t, t("competitors.source.adLibrary"))} updated={ctx.rel(updated)} demo={isDemo} labels={ctx.metaLabels} />;
  const postMeta = <DataMeta source={sourcesLabel(c.posts.map((p) => p.source), t, t("competitors.source.adLibrary"))} demo={isDemo} labels={ctx.metaLabels} />;

  const list = (xs: string[], detected?: { label: string; n: number }[]) =>
    xs.length || detected?.length ? (
      <ul className="space-y-1">
        {xs.map((x) => (
          <li key={x} className="flex gap-1.5">
            <span className="text-subtle" aria-hidden>
              •
            </span>
            <span className="min-w-0 break-words">{x}</span>
          </li>
        ))}
        {detected
          ?.filter((d) => !xs.some((x) => x.toLowerCase() === d.label.toLowerCase()))
          .map((d) => (
            <li key={`d-${d.label}`} className="flex flex-wrap items-center gap-1.5">
              <span className="min-w-0 break-words">{d.label}</span>
              <Badge tone="info">{t("competitors.profile.detected", { n: d.n })}</Badge>
            </li>
          ))}
      </ul>
    ) : (
      <span className="text-subtle">{t("competitors.noData")}</span>
    );

  const section = (label: string, body: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="mb-1 text-xs font-medium text-muted">{label}</dt>
      <dd className="text-sm">{body}</dd>
    </div>
  );

  return (
    <div id="competitor-root" className="space-y-6">
      <Link href={`/competitors${q}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-brand">
        <ArrowLeft className="size-4 flip-rtl" aria-hidden /> {t("competitors.title")}
      </Link>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            {c.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- external logo URLs of arbitrary hosts
              <img src={c.logoUrl} alt="" className="size-10 rounded-lg border border-border object-cover" />
            )}
            {c.name}
          </span>
        }
        description={`${c.client.name} · ${t(`competitors.origin.${c.origin}`)}`}
        badges={
          <>
            {c.state !== "ACCEPTED" && <Badge tone="warning">{t(`competitors.state.${c.state}`)}</Badge>}
            {isDemo && <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} />}
          </>
        }
        actions={
          <>
            <ExportMenu targetId="competitor-root" fileName={`competitor-${c.name}`} />
            {canEdit && (
              <ActionButton
                action={deleteCompetitor}
                hidden={{ competitorId: c.id, redirectTo: `/competitors${q}` }}
                label={t("ui.delete")}
                variant="danger"
                confirm={t("competitors.confirmDeleteCompetitor", { name: c.name })}
                icon={<Trash2 className="size-3.5" aria-hidden />}
              />
            )}
          </>
        }
      />

      {c.state === "PENDING" && (
        <SuggestionCard
          s={{ id: c.id, name: c.name, website: c.website, reason: c.suggestionReason, platforms: c.activePlatforms, source: c.source, notes: c.notes, createdAt: c.createdAt.toISOString() }}
          canEdit={canEdit}
          manualSlotsLeft={4 - manualCount}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("competitors.profile.title")} meta={meta} />
          <CardBody className="space-y-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              {section(
                t("competitors.f.website"),
                c.website ? (
                  <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-brand hover:underline" dir="ltr">
                    <Globe className="size-3.5" aria-hidden /> {c.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <span className="text-subtle">—</span>
                ),
              )}
              {section(
                t("competitors.profile.social"),
                SOCIAL_KEYS.some((k) => links[k]) ? (
                  <span className="flex flex-wrap gap-2">
                    {SOCIAL_KEYS.filter((k) => links[k]).map((k) => (
                      <a key={k} href={links[k]} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-brand hover:underline">
                        {t(`competitors.social.${k}`)} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ))}
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                ),
              )}
              {section(
                t("competitors.f.activePlatforms"),
                c.activePlatforms.length ? (
                  <span className="flex flex-wrap gap-1">
                    {c.activePlatforms.map((p) => (
                      <Badge key={p}>{t(`platform.${p}`)}</Badge>
                    ))}
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                ),
              )}
              {section(
                t("competitors.f.postingPerWeek"),
                <span className="space-y-0.5">
                  <span className="num block">{c.postingPerWeek != null ? `${fmtNumber(c.postingPerWeek, lc, 1)} ${t("competitors.profile.perWeek")}` : <span className="text-subtle">{t("competitors.noData")}</span>}</span>
                  {observedPerWeek != null && (
                    <span className="block text-xs text-muted">
                      {t("competitors.profile.observedRate", { n: fmtNumber(observedPerWeek, lc, 1), posts: last30.length })}
                    </span>
                  )}
                </span>,
              )}
              {section(t("competitors.f.engagementLevel"), c.engagementLevel ? t(`competitors.level.${c.engagementLevel}`) : <span className="text-subtle">—</span>)}
              {section(t("competitors.f.contentTypes"), c.contentTypes.length ? c.contentTypes.join(sep) : <span className="text-subtle">—</span>)}
            </dl>

            <div>
              <h4 className="mb-2 text-xs font-medium text-muted">{t("competitors.f.followers")}</h4>
              {Object.keys(followers).length ? (
                <SimpleTable
                  head={[t("filter.platform"), t("competitors.f.followers"), t("competitors.f.growthPct"), t("competitors.f.asOf"), t("ui.source")]}
                  rows={Object.entries(followers).map(([k, f]) => [
                    t(`competitors.social.${k}`),
                    <span key="c" className="num">{fmtCompact(f.count, lc)}</span>,
                    <span key="g" className={`num ${f.growthPct == null ? "text-subtle" : f.growthPct >= 0 ? "text-good" : "text-bad"}`}>{f.growthPct == null ? "—" : fmtPct(f.growthPct, lc, 1)}</span>,
                    <span key="d" className="num">{f.asOf ? fmtDate(f.asOf, lc) : "—"}</span>,
                    f.source,
                  ])}
                />
              ) : (
                <p className="text-sm text-subtle">{t("competitors.profile.noFollowers")}</p>
              )}
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              {section(t("competitors.f.pillars"), list(c.pillars))}
              {section(t("competitors.f.recurringMessages"), list(c.recurringMessages, detectedMessages))}
              {section(t("competitors.f.designStyle"), c.designStyle ?? <span className="text-subtle">{t("competitors.noData")}</span>)}
              {section(t("competitors.f.ctas"), list(c.ctas, detectedCtas))}
              {section(t("competitors.f.landingPages"), list(c.landingPages, detectedLanding))}
              {section(t("competitors.f.strengths"), list(c.strengths))}
              {section(t("competitors.f.weaknesses"), list(c.weaknesses))}
              {section(t("competitors.f.opportunities"), list(c.opportunities))}
            </dl>
            {c.notes && <Callout tone="info">{c.notes}</Callout>}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t("competitors.intensity.label")} meta={<DataMeta source={t("competitors.intensity.method")} demo={isDemo} estimate labels={ctx.metaLabels} />} />
            <CardBody>
              <IntensityMeter intensity={intensity} />
            </CardBody>
          </Card>
          {canEdit && (
            <Card>
              <CardHeader title={t("competitors.import.title")} subtitle={t("competitors.import.subtitle")} />
              <CardBody>
                <ImportAds competitorId={c.id} configured={adLibraryConfigured()} pageId={links.metaPageId ?? null} country={c.client.country} />
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {canEdit && (
        <Card>
          <details>
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold">
              <Pencil className="size-4 text-brand" aria-hidden /> {t("competitors.profile.edit")}
            </summary>
            <div className="border-t border-border p-4">
              <CompetitorForm
                clientId={c.clientId}
                value={{
                  id: c.id,
                  name: c.name,
                  logoUrl: c.logoUrl,
                  website: c.website,
                  socialLinks: links,
                  activePlatforms: c.activePlatforms,
                  followers,
                  postingPerWeek: c.postingPerWeek,
                  contentTypes: c.contentTypes,
                  pillars: c.pillars,
                  engagementLevel: c.engagementLevel,
                  recurringMessages: c.recurringMessages,
                  designStyle: c.designStyle,
                  ctas: c.ctas,
                  landingPages: c.landingPages,
                  strengths: c.strengths,
                  weaknesses: c.weaknesses,
                  opportunities: c.opportunities,
                  notes: c.notes,
                }}
              />
            </div>
          </details>
        </Card>
      )}

      <Card>
        <CardHeader title={t("competitors.ads.title")} subtitle={t("competitors.ads.subtitle")} meta={meta} />
        {canEdit && (
          <details className="border-b border-border">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-brand">
              <Plus className="size-4" aria-hidden /> {t("competitors.ads.addManual")}
            </summary>
            <div className="px-4 pb-4">
              <AdForm competitorId={c.id} />
            </div>
          </details>
        )}
        <AdsExplorer ads={adViews} competitors={[{ id: c.id, name: c.name }]} canEdit={canEdit} clientQuery={ctx.query} />
      </Card>

      <Card>
        <CardHeader title={t("competitors.posts.title")} subtitle={t("competitors.posts.subtitle")} meta={postMeta} />
        <CardBody className="space-y-4">
          {topPosts.length ? (
            <SimpleTable
              head={[t("competitors.posts.postedAt"), t("filter.platform"), t("competitors.ads.format"), t("competitors.posts.topic"), t("competitors.posts.occasion"), t("competitors.posts.engagements"), ""]}
              rows={topPosts.map((p) => [
                <span key="d" className="num whitespace-nowrap">{fmtDate(p.postedAt, lc)}</span>,
                t(`platform.${p.platform}`),
                p.type ? t(`contentType.${p.type}`) : "—",
                <span key="t" className="inline-flex flex-wrap items-center gap-1">
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="text-brand hover:underline">
                      {p.topic ?? t("competitors.posts.open")}
                    </a>
                  ) : (
                    (p.topic ?? "—")
                  )}
                  {p.isTopPost && <Badge tone="good">{t("competitors.posts.top")}</Badge>}
                </span>,
                p.occasion ?? "—",
                <span key="e" className="num">{p.engagements == null ? "—" : fmtNumber(p.engagements, lc)}</span>,
                canEdit ? <ActionButton key="x" action={deleteCompetitorPost} hidden={{ postId: p.id }} label={t("ui.delete")} variant="ghost" confirm={t("competitors.confirmDelete")} /> : null,
              ])}
            />
          ) : (
            <EmptyState title={t("competitors.posts.empty")} hint={t("competitors.posts.emptyHint")} />
          )}
          {canEdit && (
            <details className="rounded-lg border border-border p-3">
              <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-brand">
                <Plus className="size-4" aria-hidden /> {t("competitors.posts.add")}
              </summary>
              <div className="mt-3">
                <PostForm competitorId={c.id} />
              </div>
            </details>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
