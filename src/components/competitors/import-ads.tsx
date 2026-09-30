"use client";

import { DownloadCloud } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Callout, Field, Input } from "@/components/ui/primitives";
import { importMetaAds, saveCompetitorPost } from "@/app/actions/competitors";
import { ActionForm } from "./action-form";
import { AD_PLATFORMS, CONTENT_TYPES } from "./ad-form";
import { Select } from "@/components/ui/primitives";

/** "Import from Meta Ad Library" (official API). Shows setup steps when the token is missing. */
export function ImportAds({ competitorId, configured, pageId, country }: { competitorId: string; configured: boolean; pageId: string | null; country: string | null }) {
  const { t } = useI18n();
  if (!configured)
    return (
      <Callout tone="warning" title={t("competitors.import.setupTitle")}>
        <ol className="ms-4 list-decimal space-y-0.5 text-xs">
          <li>{t("competitors.import.setup1")}</li>
          <li>{t("competitors.import.setup2")}</li>
          <li>
            {t("competitors.import.setup3")} <code dir="ltr" className="rounded bg-surface px-1">META_AD_LIBRARY_TOKEN</code>
          </li>
          <li>{t("competitors.import.setup4")}</li>
        </ol>
      </Callout>
    );
  return (
    <ActionForm action={importMetaAds} hidden={{ competitorId }} submitLabel={<><DownloadCloud className="size-4" aria-hidden /> {t("competitors.import.button")}</>}>
      <p className="text-xs text-muted">{t("competitors.import.hint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("competitors.f.metaPageId")} htmlFor={`imp-page-${competitorId}`} hint={t("competitors.import.pageHint")}>
          <Input id={`imp-page-${competitorId}`} name="pageId" inputMode="numeric" pattern="\d*" defaultValue={pageId ?? ""} />
        </Field>
        <Field label={t("filter.country")} htmlFor={`imp-cty-${competitorId}`} hint={t("competitors.import.countryHint")}>
          <Input id={`imp-cty-${competitorId}`} name="country" maxLength={2} defaultValue={country ?? ""} dir="ltr" className="uppercase" />
        </Field>
      </div>
    </ActionForm>
  );
}

/** Manual post entry — feeds top posts and the seasonal analysis. */
export function PostForm({ competitorId }: { competitorId: string }) {
  const { t } = useI18n();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={saveCompetitorPost} hidden={{ competitorId }} submitLabel={t("ui.add")} resetOnOk>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={`${t("filter.platform")} *`} htmlFor={`p-pl-${competitorId}`}>
          <Select id={`p-pl-${competitorId}`} name="platform" defaultValue="INSTAGRAM" options={AD_PLATFORMS.filter((p) => p !== "META" && p !== "GOOGLE_ADS").map((p) => ({ value: p, label: t(`platform.${p}`) }))} />
        </Field>
        <Field label={`${t("competitors.posts.postedAt")} *`} htmlFor={`p-at-${competitorId}`}>
          <Input id={`p-at-${competitorId}`} name="postedAt" type="date" required max={today} />
        </Field>
        <Field label={t("competitors.ads.format")} htmlFor={`p-type-${competitorId}`}>
          <Select id={`p-type-${competitorId}`} name="type" placeholder="—" options={CONTENT_TYPES.map((c) => ({ value: c, label: t(`contentType.${c}`) }))} />
        </Field>
        <Field label={t("competitors.posts.engagements")} htmlFor={`p-eng-${competitorId}`}>
          <Input id={`p-eng-${competitorId}`} name="engagements" type="number" min={0} />
        </Field>
        <Field label={t("competitors.posts.topic")} htmlFor={`p-topic-${competitorId}`} className="sm:col-span-2">
          <Input id={`p-topic-${competitorId}`} name="topic" maxLength={200} />
        </Field>
        <Field label={t("competitors.posts.occasion")} htmlFor={`p-occ-${competitorId}`} hint={t("competitors.posts.occasionHint")}>
          <Input id={`p-occ-${competitorId}`} name="occasion" maxLength={120} />
        </Field>
        <Field label={t("competitors.posts.url")} htmlFor={`p-url-${competitorId}`}>
          <Input id={`p-url-${competitorId}`} name="url" type="url" placeholder="https://" />
        </Field>
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" name="isTopPost" className="accent-[var(--brand)]" /> {t("competitors.posts.isTopPost")}
      </label>
    </ActionForm>
  );
}
