"use client";

import { useI18n } from "@/lib/i18n/client";
import { Callout, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { saveCompetitorAd } from "@/app/actions/competitors";
import { ActionForm } from "./action-form";

export const AD_PLATFORMS = ["META", "FACEBOOK", "INSTAGRAM", "TIKTOK", "GOOGLE_ADS", "YOUTUBE", "LINKEDIN", "X"] as const;
export const CONTENT_TYPES = ["IMAGE", "VIDEO", "REEL", "STORY", "CAROUSEL", "TEXT", "ARTICLE", "LIVE", "SHORT", "LEAD_FORM"] as const;
export const FUNNELS = ["AWARENESS", "CONSIDERATION", "CONVERSION", "RETENTION", "ADVOCACY"] as const;

export type AdFormValue = {
  id: string;
  platform: string;
  libraryId: string | null;
  libraryUrl: string | null;
  firstSeen: string;
  lastSeen: string;
  isActive: boolean;
  placements: string[];
  format: string | null;
  creativeIdea: string | null;
  hook: string | null;
  offer: string | null;
  message: string | null;
  cta: string | null;
  product: string | null;
  audienceGuess: string | null;
  funnelGuess: string | null;
  landingPage: string | null;
  variantCount: number;
  relaunched: boolean;
  spendMin: number | null;
  spendMax: number | null;
  spendCurrency?: string | null;
  source: string;
};

/** Manual competitor-ad entry / edit. Facts imported from the official API are locked. */
export function AdForm({ competitorId, value, onDone }: { competitorId: string; value?: AdFormValue; onDone?: () => void }) {
  const { t } = useI18n();
  const v = value;
  const locked = v?.source === "API";
  const today = new Date().toISOString().slice(0, 10);
  const text = (name: keyof AdFormValue, label: string, max = 300, area = false) => (
    <Field label={label} htmlFor={`ad-${name}-${v?.id ?? "new"}`}>
      {area ? (
        <Textarea id={`ad-${name}-${v?.id ?? "new"}`} name={name} rows={2} maxLength={max} defaultValue={(v?.[name] as string | null) ?? ""} />
      ) : (
        <Input id={`ad-${name}-${v?.id ?? "new"}`} name={name} maxLength={max} defaultValue={(v?.[name] as string | null) ?? ""} />
      )}
    </Field>
  );
  const uid = v?.id ?? "new";
  return (
    <ActionForm action={saveCompetitorAd} hidden={{ competitorId, id: v?.id }} submitLabel={t("ui.save")} resetOnOk={!v} onOk={onDone}>
      {locked && <Callout tone="info">{t("competitors.ads.apiLocked")}</Callout>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={`${t("filter.platform")} *`} htmlFor={`ad-pl-${uid}`}>
          <Select id={`ad-pl-${uid}`} name="platform" disabled={locked} defaultValue={v?.platform ?? "META"} options={AD_PLATFORMS.map((p) => ({ value: p, label: t(`platform.${p}`) }))} />
        </Field>
        {locked && <input type="hidden" name="platform" value={v!.platform} />}
        <Field label={`${t("competitors.ads.firstSeen")} *`} htmlFor={`ad-fs-${uid}`}>
          <Input id={`ad-fs-${uid}`} name="firstSeen" type="date" required readOnly={locked} max={today} defaultValue={v?.firstSeen.slice(0, 10) ?? today} />
        </Field>
        <Field label={t("competitors.ads.lastSeen")} htmlFor={`ad-ls-${uid}`} hint={t("competitors.ads.lastSeenHint")}>
          <Input id={`ad-ls-${uid}`} name="lastSeen" type="date" max={today} defaultValue={v?.lastSeen.slice(0, 10) ?? ""} />
        </Field>
        <Field label={t("competitors.ads.format")} htmlFor={`ad-fmt-${uid}`}>
          <Select id={`ad-fmt-${uid}`} name="format" defaultValue={v?.format ?? ""} placeholder="—" options={CONTENT_TYPES.map((c) => ({ value: c, label: t(`contentType.${c}`) }))} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="isActive" defaultChecked={v ? v.isActive : true} className="accent-[var(--brand)]" /> {t("competitors.ads.isActive")}
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="relaunched" defaultChecked={v?.relaunched} className="accent-[var(--brand)]" /> {t("competitors.ads.relaunched")}
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("competitors.ads.libraryId")} htmlFor={`ad-lid-${uid}`}>
          <Input id={`ad-lid-${uid}`} name="libraryId" readOnly={locked} maxLength={120} defaultValue={v?.libraryId ?? ""} />
        </Field>
        <Field label={t("competitors.ads.libraryUrl")} htmlFor={`ad-lurl-${uid}`}>
          <Input id={`ad-lurl-${uid}`} name="libraryUrl" type="url" placeholder="https://" defaultValue={v?.libraryUrl ?? ""} />
        </Field>
        <Field label={t("competitors.ads.placements")} htmlFor={`ad-pls-${uid}`} hint={t("competitors.f.commaHint")}>
          <Input id={`ad-pls-${uid}`} name="placements" defaultValue={(v?.placements ?? []).join(", ")} />
        </Field>
        <Field label={t("competitors.ads.variants")} htmlFor={`ad-var-${uid}`}>
          <Input id={`ad-var-${uid}`} name="variantCount" type="number" min={1} max={500} defaultValue={v?.variantCount ?? 1} />
        </Field>
        <Field label={t("competitors.ads.funnel")} htmlFor={`ad-fun-${uid}`}>
          <Select id={`ad-fun-${uid}`} name="funnelGuess" defaultValue={v?.funnelGuess ?? ""} placeholder="—" options={FUNNELS.map((f) => ({ value: f, label: t(`funnel.${f}`) }))} />
        </Field>
        <Field label={t("competitors.ads.landingPage")} htmlFor={`ad-lp-${uid}`}>
          <Input id={`ad-lp-${uid}`} name="landingPage" type="url" placeholder="https://" defaultValue={v?.landingPage ?? ""} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {text("creativeIdea", t("competitors.ads.creativeIdea"))}
        {text("hook", t("competitors.ads.hook"))}
        {text("offer", t("competitors.ads.offer"))}
        {text("cta", t("competitors.ads.cta"), 120)}
        {text("product", t("competitors.ads.product"), 200)}
        {text("audienceGuess", t("competitors.ads.audience"))}
      </div>
      {text("message", t("competitors.ads.message"), 1000, true)}
      <details className="rounded-lg border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">{t("competitors.ads.officialSpend")}</summary>
        <p className="mt-1 text-[11px] text-subtle">{t("competitors.ads.officialSpendHint")}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label={t("competitors.ads.spendMin")} htmlFor={`ad-smin-${uid}`}>
            <Input id={`ad-smin-${uid}`} name="officialSpendMin" type="number" min={0} readOnly={locked} defaultValue={v?.spendMin ?? ""} />
          </Field>
          <Field label={t("competitors.ads.spendMax")} htmlFor={`ad-smax-${uid}`}>
            <Input id={`ad-smax-${uid}`} name="officialSpendMax" type="number" min={0} readOnly={locked} defaultValue={v?.spendMax ?? ""} />
          </Field>
        </div>
      </details>
    </ActionForm>
  );
}
