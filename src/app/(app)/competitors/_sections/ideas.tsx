import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import { aiEnabled } from "@/lib/ai/claude";
import { toIdeaView, toPendingIdea } from "@/lib/competitors/views";
import { Callout, Card, CardBody, CardHeader, DataMeta } from "@/components/ui/primitives";
import { IdeaBoard } from "@/components/trends/idea-board";
import { IdeaForm } from "@/components/trends/idea-form";
import { GenerateIdeas, PendingIdeas, type PendingIdea } from "@/components/trends/idea-tools";

/** Competitor Idea Bank: ideas inspired by competitors, adapted — never copied. */
export async function IdeasSection({ ctx }: { ctx: PageContext }) {
  const { t, scope } = ctx;
  const clientId = ctx.client!.id;
  const [ideas, recs] = await Promise.all([
    db.idea.findMany({ where: { ...scope, source: "COMPETITOR" }, orderBy: { createdAt: "desc" } }),
    db.aiRecommendation.findMany({ where: { ...scope, area: "ideas.competitor", state: "PENDING" }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const canEdit = ctx.can("competitors:edit");
  const pending = recs.map(toPendingIdea).filter((p): p is PendingIdea => Boolean(p));
  const updated = [...ideas.map((i) => i.createdAt), ...recs.map((r) => r.createdAt)].sort((a, b) => b.getTime() - a.getTime())[0];
  const demo = ideas.some((i) => i.dataSource === "DEMO");

  return (
    <div className="space-y-4">
      <Callout tone="info" title={t("competitors.ideas.guardTitle")}>
        {t("competitors.ideas.guard")}
      </Callout>
      {canEdit && (
        <Card>
          <CardHeader title={t("trends.gen.title")} subtitle={t("competitors.ideas.genSubtitle")} />
          <CardBody className="space-y-4">
            <GenerateIdeas clientId={clientId} sources={["COMPETITOR"]} aiAvailable={aiEnabled() && ctx.can("ai:use")} />
            <PendingIdeas items={pending} canDecide={canEdit} />
          </CardBody>
        </Card>
      )}
      {!canEdit && pending.length > 0 && <PendingIdeas items={pending} canDecide={false} />}
      <Card>
        <CardHeader
          title={t("competitors.ideas.title")}
          subtitle={t("competitors.ideas.subtitle", { n: ideas.length })}
          meta={<DataMeta source={t("competitors.ideas.source")} updated={ctx.rel(updated)} demo={ctx.isDemo || demo} labels={ctx.metaLabels} />}
        />
        <CardBody className="space-y-4">
          {ideas.length > 0 && ideas.length < 10 && <Callout tone="warning">{t("competitors.ideas.belowTarget", { n: ideas.length })}</Callout>}
          <IdeaBoard
            ideas={ideas.map(toIdeaView)}
            clientId={clientId}
            canEdit={canEdit}
            canCalendar={ctx.can("content:create")}
            emptyTitle={t("competitors.ideas.empty")}
            emptyHint={canEdit ? t("competitors.ideas.emptyHint") : undefined}
          />
          {canEdit && (
            <details className="rounded-lg border border-border p-3">
              <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-brand">
                <Plus className="size-4" aria-hidden /> {t("trends.idea.addManual")}
              </summary>
              <div className="mt-3">
                <IdeaForm clientId={clientId} source="COMPETITOR" />
              </div>
            </details>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
