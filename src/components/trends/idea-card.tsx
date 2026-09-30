"use client";

import { useState } from "react";
import { Bot, CalendarCheck, CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmtDate, fmtPct, type Locale } from "@/lib/format";
import { Badge, Button, DemoBadge, Field, Input, Select, cx } from "@/components/ui/primitives";
import { addIdeaToCalendar, deleteIdea } from "@/app/actions/trends";
import { ActionButton, ActionForm } from "@/components/competitors/action-form";
import { CONTENT_TYPES } from "@/components/competitors/ad-form";
import { IdeaForm, IDEA_PLATFORMS, type IdeaView } from "./idea-form";

const PRIORITY_TONE = { CRITICAL: "bad", HIGH: "warning", MEDIUM: "info", LOW: "neutral" } as const;

export function growthSpeed(g: number | null): "EXPLOSIVE" | "FAST" | "STEADY" | "COOLING" | null {
  if (g == null) return null;
  return g >= 1 ? "EXPLOSIVE" : g >= 0.3 ? "FAST" : g > 0 ? "STEADY" : "COOLING";
}

/** Full idea card: provenance, evidence, execution brief, Ease × Impact and actions. */
export function IdeaCard({ idea, clientId, canEdit, canCalendar }: { idea: IdeaView; clientId: string; canEdit: boolean; canCalendar: boolean }) {
  const { t, locale } = useI18n();
  const lc = locale as Locale;
  const [mode, setMode] = useState<"view" | "edit" | "calendar">("view");
  const speed = growthSpeed(idea.signalGrowth);
  const expired = idea.validUntil ? new Date(idea.validUntil) < new Date() : false;
  const item = (label: string, value: React.ReactNode, wide = false) =>
    value ? (
      <div className={cx("min-w-0", wide && "sm:col-span-2")}>
        <dt className="text-[11px] text-subtle">{label}</dt>
        <dd className="break-words text-xs">{value}</dd>
      </div>
    ) : null;

  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-3" aria-labelledby={`idea-${idea.id}`}>
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={PRIORITY_TONE[idea.priority as keyof typeof PRIORITY_TONE] ?? "neutral"}>{t(`priority.${idea.priority}`)}</Badge>
          {idea.aiGenerated && (
            <Badge tone="warning" title={t("trends.idea.aiHint")}>
              <Bot className="size-3" aria-hidden /> {t("trends.idea.ai")}
            </Badge>
          )}
          {idea.dataSource === "DEMO" && <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} />}
          {idea.isSeasonal && <Badge tone="brand">{t("trends.idea.seasonal")}</Badge>}
          {idea.isEvergreen && <Badge tone="good">{t("trends.idea.evergreen")}</Badge>}
          {idea.addedToCalendar && (
            <Badge tone="good">
              <CalendarCheck className="size-3" aria-hidden /> {t("trends.idea.inCalendar")}
            </Badge>
          )}
        </div>
        <h4 id={`idea-${idea.id}`} className="text-sm font-semibold leading-snug">
          {idea.title}
        </h4>
        {idea.reason && (
          <p className="text-xs text-muted">
            <span className="font-medium text-text">{t("trends.idea.why")}: </span>
            {idea.reason}
          </p>
        )}
      </header>

      {idea.source === "COMPETITOR" && (idea.originalIdea || idea.ourTwist) && (
        <dl className="grid gap-2 rounded-lg bg-surface-2 p-2.5 sm:grid-cols-2">
          {item(t("trends.idea.competitor"), idea.competitorName)}
          {item(t("trends.idea.originalIdea"), idea.originalIdea)}
          {item(t("trends.idea.whyItWorked"), idea.whyItWorked, true)}
          {item(t("trends.idea.ourTwist"), idea.ourTwist && <span className="font-medium text-good">{idea.ourTwist}</span>, true)}
        </dl>
      )}

      {(idea.source === "TREND" || idea.signalSource) && (
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-2.5">
          {item(t("trends.idea.signalSource"), idea.signalSource)}
          {item(t("trends.idea.discovered"), <span className="num">{fmtDate(idea.createdAt, lc)}</span>)}
          {item(
            t("trends.idea.growth"),
            idea.signalGrowth != null && (
              <span className={cx("num font-medium", idea.signalGrowth >= 0 ? "text-good" : "text-bad")}>
                {idea.signalGrowth >= 0 ? "+" : ""}
                {fmtPct(idea.signalGrowth, lc, 0)} · {t(`trends.speed.${speed}`)}
              </span>
            ),
          )}
          {item(
            t("trends.idea.validity"),
            idea.validUntil && (
              <span className={cx("num", expired && "text-bad")}>
                {fmtDate(idea.createdAt, lc, { month: "short", day: "numeric" })} → {fmtDate(idea.validUntil, lc)} {expired && `(${t("trends.idea.expired")})`}
              </span>
            ),
          )}
          {item(t("trends.idea.keyword"), idea.keyword)}
          {item(t("trends.idea.searchIntent"), idea.searchIntent)}
        </dl>
      )}

      <dl className="grid grid-cols-2 gap-2">
        {item(t("trends.idea.audience"), idea.audience)}
        {item(t("filter.platform"), idea.platform && t(`platform.${idea.platform}`))}
        {item(t("trends.idea.format"), idea.format && t(`contentType.${idea.format}`))}
        {item(t("filter.objective"), idea.objective && t(`objective.${idea.objective}`))}
        {item(t("filter.funnel"), idea.funnelStage && t(`funnel.${idea.funnelStage}`))}
        {item(t("trends.idea.cost"), idea.costEstimate && <>{idea.costEstimate} <span className="text-subtle">({t("ui.estimate")})</span></>)}
        {item(t("trends.idea.hook"), idea.hook && <q>{idea.hook}</q>, true)}
        {item(t("trends.idea.cta"), idea.cta)}
        {item(t("trends.idea.metrics"), idea.successMetrics.length > 0 && idea.successMetrics.join(" · "))}
        {item(t("trends.idea.captionOutline"), idea.captionOutline, true)}
        {item(t("trends.idea.visualDirection"), idea.visualDirection, true)}
      </dl>

      <div className="flex items-center gap-3 text-xs">
        <span className="text-subtle">{t("trends.idea.ease")}</span>
        <Dots n={idea.ease} tone="bg-info" label={`${t("trends.idea.ease")} ${idea.ease}/5`} />
        <span className="text-subtle">{t("trends.idea.impact")}</span>
        <Dots n={idea.impact} tone="bg-good" label={`${t("trends.idea.impact")} ${idea.impact}/5`} />
      </div>

      {(canEdit || (canCalendar && !idea.addedToCalendar)) && (
        <footer className="mt-auto flex flex-wrap gap-2 border-t border-border pt-2 no-print">
          {canCalendar && !idea.addedToCalendar && (
            <Button size="sm" variant={mode === "calendar" ? "primary" : "secondary"} onClick={() => setMode(mode === "calendar" ? "view" : "calendar")} aria-expanded={mode === "calendar"}>
              <CalendarPlus className="size-3.5" aria-hidden /> {t("trends.idea.addToCalendar")}
            </Button>
          )}
          {canEdit && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setMode(mode === "edit" ? "view" : "edit")} aria-expanded={mode === "edit"}>
                <Pencil className="size-3.5" aria-hidden /> {t("ui.edit")}
              </Button>
              <ActionButton action={deleteIdea} hidden={{ ideaId: idea.id }} label={t("ui.delete")} variant="ghost" confirm={t("competitors.confirmDelete")} icon={<Trash2 className="size-3.5" aria-hidden />} />
            </>
          )}
        </footer>
      )}
      {mode === "calendar" && (
        <div className="rounded-lg bg-surface-2 p-2.5">
          <ActionForm action={addIdeaToCalendar} hidden={{ ideaId: idea.id }} submitLabel={t("trends.idea.addToCalendar")}>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label={t("filter.platform")} htmlFor={`cal-pl-${idea.id}`}>
                <Select id={`cal-pl-${idea.id}`} name="platform" defaultValue={idea.platform ?? "INSTAGRAM"} options={IDEA_PLATFORMS.map((p) => ({ value: p, label: t(`platform.${p}`) }))} />
              </Field>
              <Field label={t("trends.idea.format")} htmlFor={`cal-ty-${idea.id}`}>
                <Select id={`cal-ty-${idea.id}`} name="type" defaultValue={idea.format ?? "IMAGE"} options={CONTENT_TYPES.map((c) => ({ value: c, label: t(`contentType.${c}`) }))} />
              </Field>
              <Field label={t("trends.idea.publishAt")} htmlFor={`cal-at-${idea.id}`} hint={t("ui.optional")}>
                <Input id={`cal-at-${idea.id}`} name="publishAt" type="date" min={new Date().toISOString().slice(0, 10)} />
              </Field>
            </div>
            <p className="text-[11px] text-subtle">{t("trends.idea.calendarHint")}</p>
          </ActionForm>
        </div>
      )}
      {mode === "edit" && (
        <div className="rounded-lg bg-surface-2 p-2.5">
          <IdeaForm clientId={clientId} source={idea.source} value={idea} onDone={() => setMode("view")} />
        </div>
      )}
    </article>
  );
}

function Dots({ n, tone, label }: { n: number; tone: string; label: string }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={label} title={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx("size-2 rounded-full", i <= n ? tone : "bg-surface-2 border border-border")} />
      ))}
    </span>
  );
}
