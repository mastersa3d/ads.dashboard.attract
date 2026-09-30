"use client";

import { Check, Globe, RefreshCw, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Field, Input } from "@/components/ui/primitives";
import { decideSuggestion, replaceSuggestion } from "@/app/actions/competitors";
import { ActionButton, ActionForm } from "./action-form";

export type SuggestionView = { id: string; name: string; website: string | null; reason: string | null; platforms: string[]; source: string; notes: string | null; createdAt: string };

/** A PENDING system suggestion: Accept, Reject, or Replace (reject + manual / regenerate). */
export function SuggestionCard({ s, canEdit, manualSlotsLeft }: { s: SuggestionView; canEdit: boolean; manualSlotsLeft: number }) {
  const { t } = useI18n();
  const signal = s.source === "API" ? "adLibrary" : s.source === "ESTIMATE" ? "ai" : s.source === "DEMO" ? "demo" : "workspace";
  return (
    <article className="flex h-full flex-col gap-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold">{s.name}</h4>
          {s.website && (
            <a href={s.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
              <Globe className="size-3" aria-hidden /> <span className="truncate" dir="ltr">{s.website.replace(/^https?:\/\//, "")}</span>
            </a>
          )}
        </div>
        <Badge tone={signal === "ai" ? "warning" : signal === "demo" ? "demo" : "info"}>
          <Sparkles className="size-3" aria-hidden /> {t(`competitors.suggest.signal.${signal}`)}
        </Badge>
      </div>
      {s.reason && (
        <p className="text-xs text-muted">
          <span className="font-medium text-text">{t("competitors.suggest.why")}: </span>
          {s.reason}
        </p>
      )}
      {s.notes && <p className="text-[11px] text-warn">{s.notes}</p>}
      {s.platforms.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.platforms.map((p) => (
            <Badge key={p}>{t(`platform.${p}`)}</Badge>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="mt-auto space-y-2 pt-1">
          <div className="flex flex-wrap gap-2">
            <ActionButton action={decideSuggestion} hidden={{ competitorId: s.id, decision: "ACCEPT" }} label={t("competitors.suggest.accept")} variant="success" icon={<Check className="size-3.5" aria-hidden />} />
            <ActionButton action={decideSuggestion} hidden={{ competitorId: s.id, decision: "REJECT" }} label={t("ui.reject")} variant="secondary" icon={<X className="size-3.5" aria-hidden />} />
          </div>
          <details className="text-xs">
            <summary className="inline-flex cursor-pointer items-center gap-1 text-brand hover:underline">
              <RefreshCw className="size-3" aria-hidden /> {t("competitors.suggest.replace")}
            </summary>
            <div className="mt-2 space-y-3 rounded-lg bg-surface-2 p-2">
              <ActionButton action={replaceSuggestion} hidden={{ competitorId: s.id, mode: "generate" }} label={t("competitors.suggest.replaceGenerate")} />
              {manualSlotsLeft > 0 ? (
                <ActionForm action={replaceSuggestion} hidden={{ competitorId: s.id, mode: "manual" }} submitLabel={t("competitors.suggest.replaceManual")} submitVariant="secondary">
                  <Field label={t("competitors.f.name")} htmlFor={`rn-${s.id}`}>
                    <Input id={`rn-${s.id}`} name="name" required maxLength={120} />
                  </Field>
                  <Field label={t("competitors.f.website")} htmlFor={`rw-${s.id}`}>
                    <Input id={`rw-${s.id}`} name="website" type="url" placeholder="https://" />
                  </Field>
                </ActionForm>
              ) : (
                <p className="text-[11px] text-subtle">{t("competitors.err.maxManual", { max: 4 })}</p>
              )}
            </div>
          </details>
        </div>
      )}
    </article>
  );
}
