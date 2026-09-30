import { Plus } from "lucide-react";
import type { IdeaSource } from "@prisma/client";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { aiEnabled } from "@/lib/ai/claude";
import { toIdeaView, toPendingIdea } from "@/lib/competitors/views";
import { Callout, Card, CardBody, CardHeader, DataMeta, Tabs } from "@/components/ui/primitives";
import { IdeaBoard } from "@/components/trends/idea-board";
import { IdeaForm } from "@/components/trends/idea-form";
import { EaseImpactMatrix } from "@/components/trends/ease-impact-matrix";
import { GenerateIdeas, PendingIdeas, type PendingIdea } from "@/components/trends/idea-tools";

const SOURCES = ["COMPETITOR", "TREND", "ORIGINAL"] as const satisfies readonly IdeaSource[];
const TARGET_PER_SOURCE = 10;

export async function TrendIdeasSection({ ctx, sp, base }: { ctx: PageContext; sp: RawParams; base: string }) {
  const { t, scope } = ctx;
  const clientId = ctx.client!.id;
  const src = (SOURCES as readonly string[]).includes(String(sp.isrc)) ? (sp.isrc as IdeaSource) : "TREND";
  const [ideas, recs] = await Promise.all([
    db.idea.findMany({ where: scope, orderBy: { createdAt: "desc" } }),
    db.aiRecommendation.findMany({ where: { ...scope, area: { startsWith: "ideas." }, state: "PENDING" }, orderBy: { createdAt: "desc" }, take: 90 }),
  ]);
  const permFor = (s: IdeaSource) => ctx.can(s === "COMPETITOR" ? "competitors:edit" : "trends:edit");
  const editableSources = SOURCES.filter(permFor);
  const counts = Object.fromEntries(SOURCES.map((s) => [s, ideas.filter((i) => i.source === s).length])) as Record<IdeaSource, number>;
  const current = ideas.filter((i) => i.source === src);
  const allPending = recs.map(toPendingIdea).filter((p): p is PendingIdea => Boolean(p));
  const pending = allPending.filter((p) => p.source === src);
  const pendingBySource = Object.fromEntries(SOURCES.map((s) => [s, allPending.filter((p) => p.source === s).length])) as Record<IdeaSource, number>;
  const updated = ideas[0]?.createdAt;
  const demo = ctx.isDemo || ideas.some((i) => i.dataSource === "DEMO");
  const meta = <DataMeta source={t("trends.ideasSource")} updated={ctx.rel(updated)} demo={demo} labels={ctx.metaLabels} />;

  return (
    <div className="space-y-4">
      <Callout tone="info" title={t("competitors.ideas.guardTitle")}>
        {t("trends.ideas.guard")}
      </Callout>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5 [&>*]:min-w-0">
        <Card className="xl:col-span-3">
          <CardHeader title={t("trends.matrix.title")} subtitle={t("trends.matrix.subtitle")} meta={meta} />
          <CardBody>
            <EaseImpactMatrix ideas={ideas.map((i) => ({ id: i.id, title: i.title, ease: i.ease, impact: i.impact, source: i.source }))} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title={t("trends.gen.title")} subtitle={t("trends.gen.subtitle")} />
          <CardBody className="space-y-3">
            <ul className="grid grid-cols-3 gap-2 text-center text-xs">
              {SOURCES.map((s) => (
                <li key={s} className="rounded-lg border border-border p-2">
                  <p className="text-muted">{t(`trends.source.${s}`)}</p>
                  <p className={`num text-lg font-semibold ${counts[s] < TARGET_PER_SOURCE ? "text-warn" : ""}`}>{counts[s]}</p>
                  <p className="text-[10px] text-subtle">{t("trends.ideas.target", { n: TARGET_PER_SOURCE })}</p>
                </li>
              ))}
            </ul>
            {editableSources.length ? (
              <GenerateIdeas clientId={clientId} sources={[...editableSources]} defaultSource={editableSources.includes(src) ? src : editableSources[0]} aiAvailable={aiEnabled() && ctx.can("ai:use")} />
            ) : (
              <p className="text-xs text-subtle">{t("trends.ideas.readOnly")}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Tabs active={src} tabs={SOURCES.map((s) => ({ key: s, label: `${t(`trends.source.${s}`)} (${counts[s]}${pendingBySource[s] ? ` + ${pendingBySource[s]} ${t("trends.pending.short")}` : ""})`, href: `${base}tab=ideas&isrc=${s}` }))} />

      {pending.length > 0 && <PendingIdeas items={pending} canDecide={permFor(src)} />}

      <Card>
        <CardHeader title={t(`trends.ideas.title.${src}`)} subtitle={t(`trends.ideas.subtitle.${src}`)} meta={meta} />
        <CardBody className="space-y-4">
          {current.length > 0 && current.length < TARGET_PER_SOURCE && <Callout tone="warning">{t("competitors.ideas.belowTarget", { n: current.length })}</Callout>}
          <IdeaBoard
            ideas={current.map(toIdeaView)}
            clientId={clientId}
            canEdit={permFor(src)}
            canCalendar={ctx.can("content:create")}
            emptyTitle={t("trends.ideas.empty")}
            emptyHint={permFor(src) ? t("trends.ideas.emptyHint") : undefined}
          />
          {permFor(src) && (
            <details className="rounded-lg border border-border p-3">
              <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-brand">
                <Plus className="size-4" aria-hidden /> {t("trends.idea.addManual")}
              </summary>
              <div className="mt-3">
                <IdeaForm clientId={clientId} source={src} />
              </div>
            </details>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
