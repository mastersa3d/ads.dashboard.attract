import type { TFunction } from "@/lib/i18n/translate";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ColorInput } from "@/components/admin/color-input";
import { ImageField } from "@/components/admin/image-field";
import { COUNTRIES, CURRENCIES, countryName, timezones } from "@/components/admin/constants";

export type ClientDefaults = {
  id?: string;
  name?: string | null;
  industry?: string | null;
  country?: string | null;
  currency?: string | null;
  timezone?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  brandColors?: string[];
  accountManagerId?: string | null;
  package?: string | null;
};

/** Selects shared by client / organisation forms. */
export function countryOptions(locale: string) {
  return COUNTRIES.map((c) => ({ value: c, label: `${countryName(c, locale)} (${c})` }));
}
export const currencyOptions = () => CURRENCIES.map((c) => ({ value: c, label: c }));
export const timezoneOptions = () => timezones().map((z) => ({ value: z, label: z.replaceAll("_", " ") }));

/** Up to four brand colour pickers submitted as repeated `brandColors`. */
export function BrandColorFields({ t, colors, name = "brandColors" }: { t: TFunction; colors?: string[]; name?: string }) {
  const values = [...(colors ?? []), "", "", "", ""].slice(0, 4);
  return (
    <Field label={t("clients.brandColors")} hint={t("clients.brandColorsHint")}>
      <div className="flex flex-wrap gap-3">
        {values.map((c, i) => (
          <ColorInput key={i} name={name} defaultValue={c} label={`${t("clients.brandColors")} ${i + 1}`} />
        ))}
      </div>
    </Field>
  );
}

/**
 * The essentials of a client (used by /clients/new, the onboarding wizard and the Profile tab).
 * Server component: rendered inside <ActionForm>, so it keeps working without client JS state.
 */
export function ClientBasicsFields({
  t,
  locale,
  d = {},
  managers,
  withManager = true,
}: {
  t: TFunction;
  locale: string;
  d?: ClientDefaults;
  managers: { id: string; name: string }[];
  withManager?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("clients.name")} htmlFor="c-name">
        <Input id="c-name" name="name" required minLength={2} maxLength={120} defaultValue={d.name ?? ""} />
      </Field>
      <Field label={t("clients.industry")} htmlFor="c-industry">
        <Input id="c-industry" name="industry" maxLength={120} defaultValue={d.industry ?? ""} placeholder={t("clients.industryPh")} />
      </Field>
      <Field label={t("filter.country")} htmlFor="c-country">
        <Select id="c-country" name="country" defaultValue={d.country ?? ""} placeholder="—" options={countryOptions(locale)} />
      </Field>
      <Field label={t("filter.currency")} htmlFor="c-currency" hint={t("clients.currencyHint")}>
        <Select id="c-currency" name="currency" defaultValue={d.currency ?? "EGP"} options={currencyOptions()} />
      </Field>
      <Field label={t("clients.timezone")} htmlFor="c-tz">
        <Select id="c-tz" name="timezone" defaultValue={d.timezone ?? "Africa/Cairo"} options={timezoneOptions()} />
      </Field>
      <Field label={t("clients.website")} htmlFor="c-web">
        <Input id="c-web" name="website" type="url" dir="ltr" placeholder="https://" defaultValue={d.website ?? ""} />
      </Field>
      <Field label={t("clients.logo")} htmlFor="c-logo" className="sm:col-span-2" hint={d.id ? t("clients.logoHint") : t("clients.logoHintNew")}>
        <ImageField id="c-logo" name="logoUrl" defaultValue={d.logoUrl} clientId={d.id} label={t("clients.logo")} />
      </Field>
      <div className="sm:col-span-2">
        <BrandColorFields t={t} colors={d.brandColors} />
      </div>
      {withManager && (
        <>
          <Field label={t("clients.accountManager")} htmlFor="c-am">
            <Select id="c-am" name="accountManagerId" defaultValue={d.accountManagerId ?? ""} placeholder="—" options={managers.map((m) => ({ value: m.id, label: m.name }))} />
          </Field>
          <Field label={t("clients.package")} htmlFor="c-pkg">
            <Input id="c-pkg" name="package" maxLength={120} defaultValue={d.package ?? ""} placeholder={t("clients.packagePh")} />
          </Field>
        </>
      )}
    </div>
  );
}

/** Textarea for list fields stored as String[] (one item per line). */
export function ListField({ t, name, label, values, id }: { t: TFunction; name: string; label: string; values?: string[]; id: string }) {
  return (
    <Field label={label} htmlFor={id} hint={t("clients.onePerLine")}>
      <Textarea id={id} name={name} rows={3} defaultValue={(values ?? []).join("\n")} />
    </Field>
  );
}
