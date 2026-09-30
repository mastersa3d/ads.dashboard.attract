"use client";

import { useI18n } from "@/lib/i18n/client";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { saveCompetitor } from "@/app/actions/competitors";
import { ActionForm } from "./action-form";
import { SOCIAL_KEYS } from "@/lib/competitors/constants";

export const COMPETITOR_PLATFORMS = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "LINKEDIN", "YOUTUBE", "X", "GOOGLE_ADS"] as const;

export type FollowerStat = { count: number; growthPct: number | null; asOf: string; source: string };

export type CompetitorFormValue = {
  id: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
  socialLinks: Record<string, string>;
  activePlatforms: string[];
  followers: Record<string, FollowerStat>;
  postingPerWeek: number | null;
  contentTypes: string[];
  pillars: string[];
  engagementLevel: string | null;
  recurringMessages: string[];
  designStyle: string | null;
  ctas: string[];
  landingPages: string[];
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  notes: string | null;
};

/** Create (name + basics) or fully edit a competitor profile. Lists are one item per line. */
export function CompetitorForm({ clientId, value, onDone }: { clientId: string; value?: CompetitorFormValue; onDone?: () => void }) {
  const { t } = useI18n();
  const v = value;
  const lines = (xs?: string[]) => (xs ?? []).join("\n");
  const full = Boolean(v);
  return (
    <ActionForm action={saveCompetitor} hidden={{ clientId, id: v?.id }} submitLabel={t("ui.save")} resetOnOk={!full} onOk={onDone}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`${t("competitors.f.name")} *`} htmlFor="c-name">
          <Input id="c-name" name="name" required maxLength={120} defaultValue={v?.name} />
        </Field>
        <Field label={t("competitors.f.website")} htmlFor="c-web">
          <Input id="c-web" name="website" type="url" inputMode="url" placeholder="https://" defaultValue={v?.website ?? ""} />
        </Field>
        <Field label={t("competitors.f.logoUrl")} htmlFor="c-logo">
          <Input id="c-logo" name="logoUrl" type="url" placeholder="https://" defaultValue={v?.logoUrl ?? ""} />
        </Field>
        <Field label={t("competitors.f.metaPageId")} htmlFor="c-page" hint={t("competitors.f.metaPageIdHint")}>
          <Input id="c-page" name="metaPageId" inputMode="numeric" pattern="\d*" defaultValue={v?.socialLinks.metaPageId ?? ""} />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted">{t("competitors.f.activePlatforms")}</legend>
        <div className="flex flex-wrap gap-2">
          {COMPETITOR_PLATFORMS.map((p) => (
            <label key={p} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm">
              <input type="checkbox" name="activePlatforms" value={p} defaultChecked={v?.activePlatforms.includes(p)} className="accent-[var(--brand)]" />
              {t(`platform.${p}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {full && (
        <>
          <details className="rounded-lg border border-border p-3" open>
            <summary className="cursor-pointer text-sm font-medium">{t("competitors.f.socialAndFollowers")}</summary>
            <p className="mt-1 text-[11px] text-subtle">{t("competitors.f.followersHint")}</p>
            <div className="mt-3 space-y-3">
              {SOCIAL_KEYS.map((k) => {
                const f = v?.followers[k];
                return (
                  <div key={k} className="grid gap-2 rounded-lg bg-surface-2/60 p-2 sm:grid-cols-[1fr_7rem_6rem_9rem_8rem]">
                    <Field label={t(`competitors.social.${k}`)} htmlFor={`sl-${k}`}>
                      <Input id={`sl-${k}`} name={`sl_${k}`} type="url" placeholder="https://" defaultValue={v?.socialLinks[k] ?? ""} />
                    </Field>
                    <Field label={t("competitors.f.followers")} htmlFor={`fc-${k}`}>
                      <Input id={`fc-${k}`} name={`fc_${k}`} type="number" min={0} inputMode="numeric" defaultValue={f?.count ?? ""} />
                    </Field>
                    <Field label={t("competitors.f.growthPct")} htmlFor={`fg-${k}`}>
                      <Input id={`fg-${k}`} name={`fg_${k}`} type="number" step="0.1" defaultValue={f?.growthPct == null ? "" : Math.round(f.growthPct * 1000) / 10} />
                    </Field>
                    <Field label={t("competitors.f.asOf")} htmlFor={`fd-${k}`}>
                      <Input id={`fd-${k}`} name={`fd_${k}`} type="date" defaultValue={f?.asOf?.slice(0, 10) ?? ""} />
                    </Field>
                    <Field label={t("ui.source")} htmlFor={`fs-${k}`}>
                      <Input id={`fs-${k}`} name={`fs_${k}`} maxLength={80} placeholder={t("source.MANUAL")} defaultValue={f?.source ?? ""} />
                    </Field>
                  </div>
                );
              })}
            </div>
          </details>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("competitors.f.postingPerWeek")} htmlFor="c-ppw">
              <Input id="c-ppw" name="postingPerWeek" type="number" min={0} step="0.1" defaultValue={v?.postingPerWeek ?? ""} />
            </Field>
            <Field label={t("competitors.f.engagementLevel")} htmlFor="c-eng">
              <Select
                id="c-eng"
                name="engagementLevel"
                defaultValue={v?.engagementLevel ?? ""}
                placeholder="—"
                options={["LOW", "MEDIUM", "HIGH"].map((x) => ({ value: x, label: t(`competitors.level.${x}`) }))}
              />
            </Field>
            <Field label={t("competitors.f.contentTypes")} htmlFor="c-ct" hint={t("competitors.f.commaHint")}>
              <Input id="c-ct" name="contentTypes" defaultValue={(v?.contentTypes ?? []).join(", ")} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["pillars", v?.pillars],
                ["recurringMessages", v?.recurringMessages],
                ["strengths", v?.strengths],
                ["weaknesses", v?.weaknesses],
                ["opportunities", v?.opportunities],
                ["landingPages", v?.landingPages],
              ] as const
            ).map(([k, xs]) => (
              <Field key={k} label={t(`competitors.f.${k}`)} htmlFor={`c-${k}`} hint={t("competitors.f.lineHint")}>
                <Textarea id={`c-${k}`} name={k} rows={3} defaultValue={lines(xs)} />
              </Field>
            ))}
            <Field label={t("competitors.f.ctas")} htmlFor="c-ctas" hint={t("competitors.f.commaHint")}>
              <Input id="c-ctas" name="ctas" defaultValue={(v?.ctas ?? []).join(", ")} />
            </Field>
            <Field label={t("competitors.f.designStyle")} htmlFor="c-style">
              <Textarea id="c-style" name="designStyle" rows={3} maxLength={1000} defaultValue={v?.designStyle ?? ""} />
            </Field>
          </div>
          <Field label={t("ui.notes")} htmlFor="c-notes">
            <Textarea id="c-notes" name="notes" rows={3} maxLength={4000} defaultValue={v?.notes ?? ""} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}
