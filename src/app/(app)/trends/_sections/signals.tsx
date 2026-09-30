import Link from "next/link";
import { ExternalLink, Trash2 } from "lucide-react";
import type { TrendSignal } from "@prisma/client";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import { fmtDate, fmtNumber, fmtPct, type Locale } from "@/lib/format";
import { clientGaps } from "@/lib/trends/idea-context";
import { signalValidUntil } from "@/lib/trends/signals";
import { sourcesLabel } from "@/lib/competitors/views";
import { Badge, Card, CardBody, CardHeader, DataMeta, EmptyState, cx } from "@/components/ui/primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable } from "@/components/ui/data-table";
import { ActionButton } from "@/components/competitors/action-form";
import { deleteSignal } from "@/app/actions/trends";

/** Section → the TrendSignal kinds it lists. */
const SIGNAL_SECTIONS: { key: string; kinds: string[] }[] = [
  { key: "search", kinds: ["SEARCH"] },
  { key: "rising", kinds: ["RISING"] },
  { key: "questions", kinds: ["QUESTION"] },
  { key: "topics", kinds: ["TOPIC"] },
  { key: "interests", kinds: ["INTEREST"] },
  { key: "social", kinds: ["SOCIAL"] },
  { key: "hooks", kinds: ["HOOK"] },
  { key: "formats", kinds: ["FORMAT"] },
  { key: "news", kinds: ["NEWS"] },
];

export async function SignalsSection({ ctx }: { ctx: PageContext }) {
  const { t, locale, scope } = ctx;
  const lc = locale as Locale;
  const clientId = ctx.client!.id;
  const now = new Date();
  const [signals, seasonalIdeas, evergreenIdeas, openIdeas, { gaps, pillars }] = await Promise.all([
    db.trendSignal.findMany({ where: scope, orderBy: { discoveredAt: "desc" }, take: 1000 }),
    db.idea.findMany({ where: { ...scope, isSeasonal: true }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 8 }),
    db.idea.findMany({ where: { ...scope, isEvergreen: true }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 8 }),
    db.idea.count({ where: { ...scope, addedToCalendar: false } }),
    clientGaps(clientId),
  ]);
  const canEdit = ctx.can("trends:edit");
  const live = signals.filter((s) => signalValidUntil(s) >= now);
  const updated = signals[0]?.discoveredAt;
  const meta = <DataMeta source={sourcesLabel(signals.map((s) => s.source), t, t("trends.source.api"))} updated={ctx.rel(updated)} demo={ctx.isDemo || signals.some((s) => s.source === "DEMO")} labels={ctx.metaLabels} />;
  const ideasHref = (src: string) => `/trends?${ctx.query}${ctx.query ? "&" : ""}tab=ideas&isrc=${src}`;

  const growth = (g: number | null) =>
    g == null ? (
      <span className="text-subtle">—</span>
    ) : (
      <span className={cx("num font-medium", g >= 0 ? "text-good" : "text-bad")}>
        {g >= 0 ? "+" : ""}
        {fmtPct(g, lc, 0)}
      </span>
    );

  const signalRow = (s: TrendSignal) => {
    const until = signalValidUntil(s);
    return (
      <li key={s.id} className="flex items-start justify-between gap-2 border-b border-border/60 py-2 last:border-0">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {s.sourceUrl ? (
              <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-brand">
                {s.keyword} <ExternalLink className="size-3 shrink-0 text-subtle" aria-hidden />
              </a>
            ) : (
              s.keyword
            )}
          </p>
          <p className="text-[11px] text-subtle">
            {s.sourceName} · <span className="num">{fmtDate(s.discoveredAt, lc, { month: "short", day: "numeric" })}</span> → <span className="num">{fmtDate(until, lc, { month: "short", day: "numeric" })}</span>
            {s.volumeIndex != null && (
              <>
                {" "}
                · {t("trends.signal.volumeIndex")} <span className="num">{s.volumeIndex}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {growth(s.growthPct)}
          {canEdit && <ActionButton action={deleteSignal} hidden={{ signalId: s.id }} label={<Trash2 className="size-3.5" aria-label={t("ui.delete")} />} variant="ghost" confirm={t("competitors.confirmDelete")} />}
        </div>
      </li>
    );
  };

  const ideaList = (ideas: { id: string; title: string; priority: string; source: string }[], empty: string, src: string) =>
    ideas.length ? (
      <ul className="space-y-1.5">
        {ideas.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-2 text-sm">
            <Link href={ideasHref(i.source)} className="min-w-0 hover:text-brand">
              {i.title}
            </Link>
            <Badge tone={i.priority === "HIGH" || i.priority === "CRITICAL" ? "warning" : "neutral"}>{t(`priority.${i.priority}`)}</Badge>
          </li>
        ))}
        <li>
          <Link href={ideasHref(src)} className="text-xs font-medium text-brand hover:underline">
            {t("trends.viewAllIdeas")}
          </Link>
        </li>
      </ul>
    ) : (
      <EmptyState title={empty} />
    );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard locale={lc} label={t("trends.kpi.live")} value={fmtNumber(live.length, lc)} />
        <KpiCard locale={lc} label={t("trends.kpi.rising")} value={fmtNumber(live.filter((s) => (s.growthPct ?? 0) >= 0.3).length, lc)} />
        <KpiCard locale={lc} label={t("trends.kpi.questions")} value={fmtNumber(live.filter((s) => s.kind === "QUESTION").length, lc)} />
        <KpiCard locale={lc} label={t("trends.kpi.openIdeas")} value={fmtNumber(openIdeas, lc)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SIGNAL_SECTIONS.map((sec) => {
          const rows = live.filter((s) => sec.kinds.includes(s.kind)).sort((a, b) => (b.growthPct ?? -9) - (a.growthPct ?? -9));
          return (
            <Card key={sec.key}>
              <CardHeader title={t(`trends.section.${sec.key}`)} subtitle={t(`trends.section.${sec.key}Hint`)} meta={meta} />
              <CardBody className="py-2">{rows.length ? <ul>{rows.slice(0, 8).map(signalRow)}</ul> : <EmptyState title={t("trends.section.empty")} hint={canEdit ? t("trends.section.emptyHint") : undefined} />}</CardBody>
            </Card>
          );
        })}
        <Card>
          <CardHeader title={t("trends.section.seasonal")} subtitle={t("trends.section.seasonalHint")} meta={<DataMeta source={t("trends.ideasSource")} demo={ctx.isDemo} labels={ctx.metaLabels} />} />
          <CardBody>
            {(() => {
              const seasonalSignals = live.filter((s) => s.kind === "SEASONAL");
              return (
                <div className="space-y-3">
                  {seasonalSignals.length > 0 && <ul>{seasonalSignals.slice(0, 4).map(signalRow)}</ul>}
                  {ideaList(seasonalIdeas, t("trends.section.noSeasonal"), "TREND")}
                </div>
              );
            })()}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("trends.section.evergreen")} subtitle={t("trends.section.evergreenHint")} meta={<DataMeta source={t("trends.ideasSource")} demo={ctx.isDemo} labels={ctx.metaLabels} />} />
          <CardBody>{ideaList(evergreenIdeas, t("trends.section.noEvergreen"), "ORIGINAL")}</CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={t("trends.gaps.title")}
          subtitle={t("trends.gaps.subtitle", { pillars: pillars.length ? pillars.join(lc === "ar" ? "، " : ", ") : "—" })}
          meta={<DataMeta source={t("trends.gaps.source")} demo={ctx.isDemo} labels={ctx.metaLabels} />}
        />
        <CardBody>
          {gaps.length ? (
            <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {gaps.slice(0, 18).map((g) => (
                <li key={`${g.kind}-${g.label}`} className="rounded-lg border border-border p-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={g.kind === "WHITE_SPACE" ? "good" : g.kind === "COMPETITOR_ONLY" ? "warning" : g.kind === "FORMAT" ? "info" : "brand"}>{t(`trends.gaps.kind.${g.kind}`)}</Badge>
                    <span className="font-medium">{g.kind === "FORMAT" ? t(`contentType.${g.label}`) : g.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {g.competitors.length ? t("trends.gaps.by", { list: g.competitors.join(lc === "ar" ? "، " : ", ") }) : t(`trends.gaps.kind.${g.kind}Hint`)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("trends.gaps.empty")} hint={t("trends.gaps.emptyHint")} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("trends.all.title")} subtitle={t("trends.all.subtitle")} meta={meta} />
        <DataTable
          exportName="trend-signals"
          columns={[
            { key: "keyword", label: t("trends.signal.keyword") },
            { key: "kind", label: t("trends.signal.kind") },
            { key: "source", label: t("ui.source"), hideOnMobile: true },
            { key: "discovered", label: t("trends.signal.discovered"), type: "date" },
            { key: "growth", label: t("trends.signal.growth"), type: "pct", digits: 0 },
            { key: "volume", label: t("trends.signal.volumeIndex"), type: "number", hideOnMobile: true },
            { key: "valid", label: t("trends.signal.validUntil"), type: "date", hideOnMobile: true },
            { key: "status", label: t("ui.status") },
          ]}
          rows={signals.map((s) => {
            const until = signalValidUntil(s);
            const expired = until < now;
            return {
              _id: s.id,
              keyword: s.keyword,
              kind: t(`trends.kind.${s.kind}`),
              source: `${s.sourceName} (${t(`source.${s.source}`)})`,
              discovered: s.discoveredAt.toISOString(),
              growth: s.growthPct,
              volume: s.volumeIndex,
              valid: until.toISOString(),
              status: { v: expired ? t("trends.signal.expired") : t("trends.signal.valid"), d: <Badge tone={expired ? "neutral" : "good"}>{expired ? t("trends.signal.expired") : t("trends.signal.valid")}</Badge> },
            };
          })}
          initialSort={{ key: "discovered", dir: "desc" }}
          empty={<EmptyState title={t("trends.all.empty")} hint={canEdit ? t("trends.section.emptyHint") : undefined} />}
        />
      </Card>
    </div>
  );
}
