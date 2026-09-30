import { RotateCcw, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { demoDataSummary } from "@/lib/demo-purge";
import type { PageContext } from "@/lib/page";
import { fmtDate, fmtNumber } from "@/lib/format";
import { DEFAULT_FX } from "@/lib/fx";
import { Callout, Card, CardBody, CardHeader, DataMeta, Field, Input, LinkButton, Select, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { ActionButton } from "@/components/admin/action-button";
import { ColorInput } from "@/components/admin/color-input";
import { ImageField } from "@/components/admin/image-field";
import { countryOptions, currencyOptions, timezoneOptions } from "@/components/clients/client-fields";
import { orgSettings } from "./org-settings";
import { purgeDemo, resetOnboarding, updateCompany, updateCurrency, updateGeneral, updateOrgBranding, updateTimezone } from "@/app/actions/settings";

type Props = { ctx: PageContext; canManage: boolean };

function Meta({ ctx }: { ctx: PageContext }) {
  return <DataMeta source={ctx.t("settings.orgSource")} updated={ctx.rel(ctx.org.updatedAt)} labels={ctx.metaLabels} />;
}

/** Lets a Super Admin remove every demo record so only real, verified data remains. */
async function DemoDataCard({ ctx }: { ctx: PageContext }) {
  const { t } = ctx;
  const s = await demoDataSummary(db, ctx.user.organizationId);
  if (!s.any) return null;
  return (
    <Card>
      <CardHeader title={t("settings.demoTitle")} subtitle={t("settings.demoHint")} />
      <CardBody className="space-y-3">
        <Callout tone="demo">{t("settings.demoCounts", { clients: s.clients, users: s.users, benchmarks: s.benchmarks })}</Callout>
        {ctx.user.email.endsWith("@demo.local") && <Callout tone="warning">{t("settings.demoSelfWarning")}</Callout>}
        <ActionButton action={purgeDemo} variant="danger" size="md" confirm={t("settings.demoConfirm")}>
          <Trash2 className="size-4" aria-hidden /> {t("settings.demoPurge")}
        </ActionButton>
      </CardBody>
    </Card>
  );
}

export function GeneralTab({ ctx, canManage }: Props) {
  const { t, org } = ctx;
  const s = orgSettings(org.settings);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("settings.tab.general")} subtitle={t("settings.generalHint")} meta={<Meta ctx={ctx} />} />
        <CardBody>
          <ActionForm action={updateGeneral} disabled={!canManage}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("settings.appName")} htmlFor="g-app" hint={t("settings.appNameHint")}>
                <Input id="g-app" name="appName" maxLength={80} defaultValue={s.appName ?? ""} placeholder={process.env.NEXT_PUBLIC_APP_NAME ?? t("appName")} />
              </Field>
              <Field label={t("settings.defaultLocale")} htmlFor="g-locale" hint={t("settings.defaultLocaleHint")}>
                <Select id="g-locale" name="defaultLocale" defaultValue={org.defaultLocale} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("settings.onboardingTitle")} subtitle={t("settings.onboardingHint")} />
        <CardBody className="flex flex-wrap gap-2">
          <LinkButton href="/onboarding">{t("settings.openOnboarding")}</LinkButton>
          {canManage && (
            <ActionButton action={resetOnboarding} size="md" confirm={t("settings.resetOnboardingConfirm")}>
              <RotateCcw className="size-4" aria-hidden /> {t("settings.resetOnboarding")}
            </ActionButton>
          )}
        </CardBody>
      </Card>
      {canManage && <DemoDataCard ctx={ctx} />}
    </div>
  );
}

/** Company profile form — also rendered by the onboarding wizard (withRegional + onboarding flag). */
export function CompanyFields({ ctx, withRegional = false }: { ctx: PageContext; withRegional?: boolean }) {
  const { t, org, locale } = ctx;
  const c = orgSettings(org.settings).company ?? {};
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("settings.companyName")} htmlFor="o-name">
        <Input id="o-name" name="name" required minLength={2} maxLength={120} defaultValue={org.name} />
      </Field>
      <Field label={t("settings.legalName")} htmlFor="o-legal">
        <Input id="o-legal" name="legalName" maxLength={200} defaultValue={c.legalName ?? ""} />
      </Field>
      <Field label={t("filter.country")} htmlFor="o-country">
        <Select id="o-country" name="country" defaultValue={org.country ?? ""} placeholder="—" options={countryOptions(locale)} />
      </Field>
      <Field label={t("clients.industry")} htmlFor="o-industry">
        <Input id="o-industry" name="industry" maxLength={120} defaultValue={org.industry ?? ""} />
      </Field>
      {withRegional && (
        <>
          <Field label={t("settings.baseCurrency")} htmlFor="o-cur">
            <Select id="o-cur" name="currency" defaultValue={org.currency} options={currencyOptions()} />
          </Field>
          <Field label={t("clients.timezone")} htmlFor="o-tz">
            <Select id="o-tz" name="timezone" defaultValue={org.timezone} options={timezoneOptions()} />
          </Field>
          <Field label={t("settings.defaultLocale")} htmlFor="o-loc">
            <Select id="o-loc" name="defaultLocale" defaultValue={org.defaultLocale} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
          </Field>
        </>
      )}
      <Field label={t("settings.taxId")} htmlFor="o-tax">
        <Input id="o-tax" name="taxId" maxLength={60} dir="ltr" defaultValue={c.taxId ?? ""} />
      </Field>
      <Field label={t("settings.companyEmail")} htmlFor="o-email">
        <Input id="o-email" name="email" type="email" dir="ltr" defaultValue={c.email ?? ""} />
      </Field>
      <Field label={t("clients.contactPhone")} htmlFor="o-phone">
        <Input id="o-phone" name="phone" type="tel" dir="ltr" maxLength={40} defaultValue={c.phone ?? ""} />
      </Field>
      <Field label={t("clients.website")} htmlFor="o-web">
        <Input id="o-web" name="website" type="url" dir="ltr" placeholder="https://" defaultValue={c.website ?? ""} />
      </Field>
      <Field label={t("settings.address")} htmlFor="o-addr">
        <Input id="o-addr" name="address" maxLength={500} defaultValue={c.address ?? ""} />
      </Field>
      <Field label={t("settings.about")} htmlFor="o-about" className="sm:col-span-2">
        <Textarea id="o-about" name="about" rows={3} maxLength={2000} defaultValue={c.about ?? ""} />
      </Field>
    </div>
  );
}

export function CompanyTab({ ctx, canManage }: Props) {
  return (
    <Card>
      <CardHeader title={ctx.t("settings.tab.company")} subtitle={ctx.t("settings.companyHint")} meta={<Meta ctx={ctx} />} />
      <CardBody>
        <ActionForm action={updateCompany} disabled={!canManage}>
          <CompanyFields ctx={ctx} />
        </ActionForm>
      </CardBody>
    </Card>
  );
}

export function BrandingTab({ ctx, canManage }: Props) {
  const { t, org } = ctx;
  return (
    <Card>
      <CardHeader title={t("settings.tab.branding")} subtitle={t("settings.brandingHint")} meta={<Meta ctx={ctx} />} />
      <CardBody>
        <ActionForm action={updateOrgBranding} disabled={!canManage}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("clients.logo")} htmlFor="b-logo" className="sm:col-span-2" hint={t("settings.orgLogoHint")}>
              <ImageField id="b-logo" name="logoUrl" defaultValue={org.logoUrl} label={t("clients.logo")} />
            </Field>
            <Field label={t("settings.primaryColor")} hint={t("settings.primaryColorHint")}>
              <ColorInput name="primaryColor" defaultValue={org.primaryColor} label={t("settings.primaryColor")} />
            </Field>
            <Field label={t("clients.customDomain")} htmlFor="b-domain" hint={t("settings.customDomainHint")}>
              <Input id="b-domain" name="customDomain" dir="ltr" maxLength={200} defaultValue={org.customDomain ?? ""} placeholder="dashboard.agency.com" />
            </Field>
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

/** Base currency + manual FX table. Rates are "units per 1 base currency" (lib/fx.ts). */
export function CurrencyTab({ ctx, canManage }: Props) {
  const { t, org, fx, locale } = ctx;
  const stored = orgSettings(org.settings).fx;
  const rows = [...Object.entries(fx.rates).filter(([c]) => c !== fx.base), ["", ""], ["", ""], ["", ""]] as [string, number | ""][];
  return (
    <div className="space-y-4">
      <Callout tone="warning" title={t("settings.fxEstimateTitle")}>
        {t("settings.fxEstimateBody")}
      </Callout>
      <Card>
        <CardHeader
          title={t("settings.tab.currency")}
          subtitle={t("settings.currencyHint")}
          meta={<DataMeta source={fx.source ?? DEFAULT_FX.source ?? "—"} updated={fx.asOf ? fmtDate(fx.asOf, locale) : null} estimate labels={ctx.metaLabels} />}
        />
        <CardBody>
          <ActionForm action={updateCurrency} disabled={!canManage}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t("settings.baseCurrency")} htmlFor="fx-cur" hint={t("settings.baseCurrencyHint")}>
                <Select id="fx-cur" name="currency" defaultValue={org.currency} options={currencyOptions()} />
              </Field>
              <Field label={t("settings.fxBase")} htmlFor="fx-base" hint={t("settings.fxBaseHint")}>
                <Input id="fx-base" name="fxBase" defaultValue={fx.base} maxLength={3} dir="ltr" required className="uppercase" />
              </Field>
              <Field label={t("settings.fxAsOf")} htmlFor="fx-asof">
                <Input id="fx-asof" name="fxAsOf" type="date" defaultValue={(stored?.asOf ?? new Date().toISOString()).slice(0, 10)} />
              </Field>
              <Field label={t("settings.fxSource")} htmlFor="fx-src" hint={t("settings.fxSourceHint")}>
                <Input id="fx-src" name="fxSource" maxLength={200} defaultValue={stored?.source ?? "Manual"} />
              </Field>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full max-w-xl text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="px-2 py-2 text-start font-medium">{t("settings.fxCode")}</th>
                    <th className="px-2 py-2 text-start font-medium">{t("settings.fxRate", { base: fx.base })}</th>
                    <th className="px-2 py-2 text-start font-medium">{t("settings.fxInverse", { base: fx.base })}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([code, rate], i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td className="px-2 py-1.5">
                        <Input name="fxCode" defaultValue={code} maxLength={3} dir="ltr" aria-label={t("settings.fxCode")} className="w-24 uppercase" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input name="fxRate" type="number" step="any" min="0" defaultValue={rate} dir="ltr" aria-label={t("settings.fxRate", { base: fx.base })} className="num w-36" />
                      </td>
                      <td className="num px-2 py-1.5 text-xs whitespace-nowrap text-muted" dir="ltr">{typeof rate === "number" && rate > 0 ? `1 ${code} = ${fmtNumber(1 / rate, locale, 6)} ${fx.base}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-subtle">{t("settings.fxRowsHint")}</p>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

export function TimezoneTab({ ctx, canManage }: Props) {
  const { t, org, locale } = ctx;
  const now = new Date();
  return (
    <Card>
      <CardHeader title={t("settings.tab.timezone")} subtitle={t("settings.timezoneHint")} meta={<Meta ctx={ctx} />} />
      <CardBody className="space-y-4">
        <p className="text-sm">
          {t("settings.currentTime")}: <span className="num font-medium">{new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: org.timezone }).format(now)}</span>
        </p>
        <ActionForm action={updateTimezone} disabled={!canManage}>
          <Field label={t("clients.timezone")} htmlFor="tz" className="max-w-md">
            <Select id="tz" name="timezone" defaultValue={org.timezone} options={timezoneOptions()} />
          </Field>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
