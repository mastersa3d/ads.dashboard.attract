import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { aiEnabled } from "@/lib/ai/claude";
import { Badge, Card, CardBody, DataMeta, DemoBadge, PageHeader, Progress, type Tone } from "@/components/ui/primitives";
import { ExportMenu } from "@/components/ui/export-menu";
import { ClientPicker } from "@/components/strategy/client-picker";
import { SectionNav } from "@/components/strategy/section-nav";
import { SectionCard } from "@/components/strategy/section-card";
import { StatusActions } from "@/components/strategy/status-actions";
import { AiAssistant, type SuggestionView } from "@/components/strategy/ai-assistant";
import { isFilled, readSections, SECTION_IDS } from "@/components/strategy/sections";

export const metadata = { title: "Strategy Builder" };

const STATUS_TONE: Record<string, Tone> = { DRAFT: "neutral", IN_REVIEW: "warning", APPROVED: "good" };

export default async function StrategyPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "strategy:view");
  const { t, locale, client } = ctx;

  if (!client) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("strategy.title")} description={t("strategy.description")} />
        <ClientPicker path="/strategy" sp={sp} clients={ctx.clients} title={t("strategy.pickClient")} hint={t("strategy.pickClientHint")} demoLabel={t("ui.demoData")} />
      </div>
    );
  }

  const canEdit = ctx.can("strategy:edit");
  const canApprove = ctx.can("strategy:approve");
  const strategy = await db.strategy.findUnique({ where: { clientId: client.id } });
  const [approver, recs] = await Promise.all([
    strategy?.approvedById ? db.user.findFirst({ where: { id: strategy.approvedById, organizationId: ctx.user.organizationId }, select: { name: true } }) : null,
    canEdit && strategy
      ? db.aiRecommendation.findMany({ where: { clientId: client.id, strategyId: strategy.id, area: { startsWith: "strategy." } }, orderBy: { createdAt: "desc" }, take: 30 })
      : Promise.resolve([]),
  ]);

  const sections = readSections(strategy?.sections);
  const filled = SECTION_IDS.filter((id) => isFilled(sections[id]));
  const status = (strategy?.status ?? "DRAFT") as "DRAFT" | "IN_REVIEW" | "APPROVED";
  const toView = (r: (typeof recs)[number]): SuggestionView => {
    const body = (r.body ?? {}) as { lines?: unknown; method?: unknown; generatedAt?: unknown };
    return {
      id: r.id,
      area: r.area,
      title: r.title,
      lines: Array.isArray(body.lines) ? body.lines.filter((x): x is string => typeof x === "string") : [],
      reasoning: r.reasoning,
      confidence: r.confidence,
      dataSources: r.dataSources,
      method: body.method === "ai" ? "ai" : "rules",
      generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : r.createdAt.toISOString(),
      state: r.state,
    };
  };
  const pendingRecs = recs.filter((r) => r.state === "PENDING").map(toView);
  const historyRecs = recs.filter((r) => r.state !== "PENDING").slice(0, 10).map(toView);
  const lastGenerated = recs[0]?.createdAt ?? null;

  return (
    <div id="strategy-root" className="space-y-5">
      <PageHeader
        title={t("strategy.title")}
        description={`${client.name} · ${t("strategy.description")}`}
        badges={
          <>
            <Badge tone={STATUS_TONE[status]}>{t(`strategy.status.${status}`)}</Badge>
            <Badge tone="neutral">
              {t("strategy.version")} <span className="num">{strategy?.version ?? 1}</span>
            </Badge>
            {client.isDemo && <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} />}
          </>
        }
        actions={
          <>
            <StatusActions clientId={client.id} status={status} canEdit={canEdit} canApprove={canApprove} hasStrategy={Boolean(strategy)} />
            <ExportMenu targetId="strategy-root" fileName={`strategy-${client.name}`} />
          </>
        }
      />

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">{t("strategy.completeness")}</p>
            <p className="num mt-0.5 text-lg font-semibold">
              {filled.length} / {SECTION_IDS.length}
            </p>
            <div className="mt-1.5">
              <Progress value={filled.length / SECTION_IDS.length} tone={filled.length === SECTION_IDS.length ? "good" : "brand"} label={t("strategy.completeness")} />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted">{t("strategy.lastUpdated")}</p>
            <p className="mt-0.5 text-sm font-medium">{strategy ? fmtDateTime(strategy.updatedAt, locale, ctx.timezone) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("strategy.approval")}</p>
            <p className="mt-0.5 text-sm font-medium">
              {status === "APPROVED" && strategy?.approvedAt ? t("strategy.approvedBy", { name: approver?.name ?? "—", date: fmtDate(strategy.approvedAt, locale) }) : t(`strategy.statusHint.${status}`)}
            </p>
          </div>
        </CardBody>
      </Card>

      {canEdit && (
        <AiAssistant
          clientId={client.id}
          aiEnabled={aiEnabled()}
          canGenerate={ctx.can("ai:use")}
          canDecide={canEdit}
          pending={pendingRecs}
          history={historyRecs}
          meta={<DataMeta source={t("strategy.ai.metaSource")} updated={ctx.rel(lastGenerated)} demo={client.isDemo} estimate labels={ctx.metaLabels} />}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside>
          <SectionNav filled={filled} />
        </aside>
        <div className="space-y-4">
          <DataMeta source={t("strategy.metaSource")} updated={ctx.rel(strategy?.updatedAt)} demo={client.isDemo} labels={ctx.metaLabels} />
          {SECTION_IDS.map((id) => (
            <SectionCard key={id} clientId={client.id} id={id} content={sections[id]} canEdit={canEdit} />
          ))}
        </div>
      </div>
    </div>
  );
}
