"use client";

import { useI18n } from "@/lib/i18n/client";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { saveIdea } from "@/app/actions/trends";
import { ActionForm } from "@/components/competitors/action-form";
import { CONTENT_TYPES, FUNNELS } from "@/components/competitors/ad-form";

export const IDEA_PLATFORMS = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "LINKEDIN", "X"] as const;
export const OBJECTIVES = ["AWARENESS", "REACH", "TRAFFIC", "ENGAGEMENT", "VIDEO_VIEWS", "LEADS", "SALES", "APP_INSTALLS", "MESSAGES"] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type IdeaView = {
  id: string;
  source: "COMPETITOR" | "TREND" | "ORIGINAL";
  title: string;
  reason: string | null;
  competitorName: string | null;
  originalIdea: string | null;
  whyItWorked: string | null;
  ourTwist: string | null;
  signalSource: string | null;
  signalGrowth: number | null;
  validUntil: string | null;
  keyword: string | null;
  searchIntent: string | null;
  platform: string | null;
  format: string | null;
  audience: string | null;
  objective: string | null;
  funnelStage: string | null;
  hook: string | null;
  cta: string | null;
  captionOutline: string | null;
  visualDirection: string | null;
  priority: string;
  ease: number;
  impact: number;
  costEstimate: string | null;
  successMetrics: string[];
  isSeasonal: boolean;
  isEvergreen: boolean;
  addedToCalendar: boolean;
  aiGenerated: boolean;
  dataSource: string;
  createdAt: string;
};

/** Create or edit an idea. Source-specific sections appear for competitor / trend ideas. */
export function IdeaForm({ clientId, source, value, onDone }: { clientId: string; source: IdeaView["source"]; value?: IdeaView; onDone?: () => void }) {
  const { t } = useI18n();
  const v = value;
  const uid = v?.id ?? `new-${source}`;
  const inp = (name: keyof IdeaView, label: string, max = 300) => (
    <Field label={label} htmlFor={`i-${name}-${uid}`}>
      <Input id={`i-${name}-${uid}`} name={name} maxLength={max} defaultValue={(v?.[name] as string | null) ?? ""} />
    </Field>
  );
  const area = (name: keyof IdeaView, label: string, max = 1000) => (
    <Field label={label} htmlFor={`i-${name}-${uid}`}>
      <Textarea id={`i-${name}-${uid}`} name={name} rows={2} maxLength={max} defaultValue={(v?.[name] as string | null) ?? ""} />
    </Field>
  );
  const sel = (name: keyof IdeaView, label: string, opts: readonly string[], prefix: string, placeholder = true) => (
    <Field label={label} htmlFor={`i-${name}-${uid}`}>
      <Select
        id={`i-${name}-${uid}`}
        name={name}
        defaultValue={(v?.[name] as string | null) ?? (placeholder ? "" : opts[1])}
        placeholder={placeholder ? "—" : undefined}
        options={opts.map((o) => ({ value: o, label: t(`${prefix}.${o}`) }))}
      />
    </Field>
  );
  return (
    <ActionForm action={saveIdea} hidden={{ clientId, source, id: v?.id }} submitLabel={t("ui.save")} resetOnOk={!v} onOk={onDone}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`${t("trends.idea.title")} *`} htmlFor={`i-title-${uid}`} className="sm:col-span-2">
          <Input id={`i-title-${uid}`} name="title" required maxLength={200} defaultValue={v?.title ?? ""} />
        </Field>
        {area("reason", t("trends.idea.why"))}
        {inp("audience", t("trends.idea.audience"), 200)}
      </div>
      {source === "COMPETITOR" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {inp("competitorName", t("trends.idea.competitor"), 120)}
          {area("originalIdea", t("trends.idea.originalIdea"), 500)}
          {area("whyItWorked", t("trends.idea.whyItWorked"), 500)}
          {area("ourTwist", t("trends.idea.ourTwist"), 800)}
        </div>
      )}
      {source === "TREND" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {inp("signalSource", t("trends.idea.signalSource"), 120)}
          <Field label={t("trends.idea.growthPct")} htmlFor={`i-growth-${uid}`}>
            <Input id={`i-growth-${uid}`} name="signalGrowth" type="number" step="0.1" defaultValue={v?.signalGrowth == null ? "" : Math.round(v.signalGrowth * 1000) / 10} />
          </Field>
          <Field label={t("trends.idea.validUntil")} htmlFor={`i-valid-${uid}`}>
            <Input id={`i-valid-${uid}`} name="validUntil" type="date" defaultValue={v?.validUntil?.slice(0, 10) ?? ""} />
          </Field>
          {inp("keyword", t("trends.idea.keyword"), 120)}
          {inp("searchIntent", t("trends.idea.searchIntent"), 60)}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sel("platform", t("filter.platform"), IDEA_PLATFORMS, "platform")}
        {sel("format", t("trends.idea.format"), CONTENT_TYPES, "contentType")}
        {sel("objective", t("filter.objective"), OBJECTIVES, "objective")}
        {sel("funnelStage", t("filter.funnel"), FUNNELS, "funnel")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {inp("hook", t("trends.idea.hook"))}
        {inp("cta", t("trends.idea.cta"), 120)}
        {area("captionOutline", t("trends.idea.captionOutline"))}
        {area("visualDirection", t("trends.idea.visualDirection"), 600)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {sel("priority", t("ui.priority"), PRIORITIES, "priority", false)}
        <Field label={t("trends.idea.ease")} htmlFor={`i-ease-${uid}`} hint={t("trends.idea.scaleHint")}>
          <Input id={`i-ease-${uid}`} name="ease" type="number" min={1} max={5} defaultValue={v?.ease ?? 3} />
        </Field>
        <Field label={t("trends.idea.impact")} htmlFor={`i-impact-${uid}`} hint={t("trends.idea.scaleHint")}>
          <Input id={`i-impact-${uid}`} name="impact" type="number" min={1} max={5} defaultValue={v?.impact ?? 3} />
        </Field>
        {inp("costEstimate", t("trends.idea.cost"), 60)}
        <Field label={t("trends.idea.metrics")} htmlFor={`i-metrics-${uid}`} hint={t("competitors.f.commaHint")}>
          <Input id={`i-metrics-${uid}`} name="successMetrics" defaultValue={(v?.successMetrics ?? []).join(", ")} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="isSeasonal" defaultChecked={v?.isSeasonal} className="accent-[var(--brand)]" /> {t("trends.idea.seasonal")}
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="isEvergreen" defaultChecked={v?.isEvergreen} className="accent-[var(--brand)]" /> {t("trends.idea.evergreen")}
        </label>
      </div>
    </ActionForm>
  );
}
