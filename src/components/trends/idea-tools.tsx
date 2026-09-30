"use client";

import { Bot, Check, Cpu, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmtPct, type Locale } from "@/lib/format";
import { Badge, Callout, Field, Select } from "@/components/ui/primitives";
import { decideIdeaSuggestion, generateIdeaSuggestions } from "@/app/actions/trends";
import { ActionButton, ActionForm } from "@/components/competitors/action-form";

export type PendingIdea = {
  id: string;
  title: string;
  reason: string;
  confidence: number;
  engine: "ai" | "rules";
  source: "COMPETITOR" | "TREND" | "ORIGINAL";
  platform: string | null;
  format: string | null;
  hook: string | null;
  competitorName: string | null;
  keyword: string | null;
  createdAt: string;
};

/** "Generate ideas" — AI when enabled, rule-based fallback otherwise. Results wait for review. */
export function GenerateIdeas({ clientId, sources, aiAvailable, defaultSource }: { clientId: string; sources: PendingIdea["source"][]; aiAvailable: boolean; defaultSource?: PendingIdea["source"] }) {
  const { t } = useI18n();
  return (
    <ActionForm
      action={generateIdeaSuggestions}
      hidden={{ clientId, source: sources.length === 1 ? sources[0] : undefined }}
      submitLabel={
        <>
          <Sparkles className="size-4" aria-hidden /> {t("trends.gen.button")}
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {sources.length > 1 && (
          <Field label={t("trends.gen.source")} htmlFor={`gen-src-${clientId}`}>
            <Select id={`gen-src-${clientId}`} name="source" defaultValue={defaultSource ?? sources[0]} options={sources.map((s) => ({ value: s, label: t(`trends.source.${s}`) }))} />
          </Field>
        )}
        <Field label={t("trends.gen.count")} htmlFor={`gen-n-${clientId}`}>
          <Select id={`gen-n-${clientId}`} name="count" defaultValue="6" options={["3", "6", "10"].map((n) => ({ value: n, label: n }))} />
        </Field>
      </div>
      <p className="flex items-start gap-1.5 text-[11px] text-subtle">
        {aiAvailable ? <Bot className="mt-px size-3.5 shrink-0" aria-hidden /> : <Cpu className="mt-px size-3.5 shrink-0" aria-hidden />}
        {aiAvailable ? t("trends.gen.aiOn") : t("trends.gen.aiOff")} {t("trends.gen.guard")}
      </p>
    </ActionForm>
  );
}

/** Pending generated ideas: a human accepts (→ Idea) or rejects each one. */
export function PendingIdeas({ items, canDecide }: { items: PendingIdea[]; canDecide: boolean }) {
  const { t, locale } = useI18n();
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      <Callout tone="warning" title={t("trends.pending.title", { n: items.length })}>
        {t("trends.pending.hint")}
      </Callout>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-dashed border-warn/60 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={p.engine === "ai" ? "warning" : "info"}>
                {p.engine === "ai" ? <Bot className="size-3" aria-hidden /> : <Cpu className="size-3" aria-hidden />}
                {p.engine === "ai" ? t("trends.idea.ai") : t("trends.pending.rules")}
              </Badge>
              <Badge>{t(`trends.source.${p.source}`)}</Badge>
              <span className="num text-subtle">
                {t("ui.confidence")}: {fmtPct(p.confidence, locale as Locale, 0)}
              </span>
            </div>
            <p className="text-sm font-semibold">{p.title}</p>
            <p className="text-muted">{p.reason}</p>
            <p className="text-subtle">
              {[p.competitorName, p.keyword && `“${p.keyword}”`, p.platform && t(`platform.${p.platform}`), p.format && t(`contentType.${p.format}`)].filter(Boolean).join(" · ")}
            </p>
            {p.hook && (
              <p>
                <span className="text-subtle">{t("trends.idea.hook")}: </span>
                <q>{p.hook}</q>
              </p>
            )}
            {canDecide && (
              <div className="mt-auto flex gap-2 pt-1">
                <ActionButton action={decideIdeaSuggestion} hidden={{ recId: p.id, decision: "ACCEPT" }} label={t("trends.pending.accept")} variant="success" icon={<Check className="size-3.5" aria-hidden />} />
                <ActionButton action={decideIdeaSuggestion} hidden={{ recId: p.id, decision: "REJECT" }} label={t("ui.reject")} icon={<X className="size-3.5" aria-hidden />} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
