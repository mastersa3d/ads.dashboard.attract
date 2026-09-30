import type { Client } from "@prisma/client";
import type { PageContext } from "@/lib/page";
import { NAV, NAV_LABEL } from "@/components/layout/nav";
import { Callout, Card, CardBody, CardHeader, DataMeta, Field, Input } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { ColorInput } from "@/components/admin/color-input";
import { ImageField } from "@/components/admin/image-field";
import { BrandColorFields } from "./client-fields";
import { ClientLogo } from "./client-card";
import { updateClientBranding } from "@/app/actions/clients";

type ReportTheme = { primary?: string; accent?: string; font?: string; footer?: string; showLogo?: boolean; domainNote?: string };

/**
 * White label for CLIENT-role users: their sidebar shows this logo and first brand colour, and
 * the ticked sections are removed from their navigation (keys from components/layout/nav.ts).
 */
export function BrandingTab({ ctx, client }: { ctx: PageContext; client: Client }) {
  const { t } = ctx;
  const theme = (client.reportTheme ?? {}) as ReportTheme;
  const hidden = new Set(client.hiddenSections);
  const primary = client.brandColors[0];

  return (
    <ActionForm action={updateClientBranding.bind(null, client.id)} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("clients.brandIdentity")} meta={<DataMeta source={t("clients.profileSource")} updated={ctx.rel(client.updatedAt)} demo={client.isDemo} labels={ctx.metaLabels} />} />
          <CardBody className="space-y-4">
            <Field label={t("clients.logo")} htmlFor="w-logo" hint={t("clients.logoHint")}>
              <ImageField id="w-logo" name="logoUrl" defaultValue={client.logoUrl} clientId={client.id} label={t("clients.logo")} />
            </Field>
            <BrandColorFields t={t} colors={client.brandColors} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("clients.preview")} subtitle={t("clients.previewHint")} />
          <CardBody>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-surface-2 p-3">
                <ClientLogo name={client.name} logoUrl={client.logoUrl} color={primary} />
                <span className="truncate text-sm font-semibold">{client.name}</span>
              </div>
              <div className="space-y-1 p-3 text-xs">
                <div className="rounded-md px-2 py-1.5 font-medium text-white" style={{ background: primary ?? "var(--brand)" }}>
                  {t("nav.dashboard")}
                </div>
                {NAV.flatMap((g) => g.items)
                  .filter((i) => !hidden.has(i.section) && i.section !== "dashboard")
                  .slice(0, 5)
                  .map((i) => (
                    <div key={i.href} className="px-2 py-1 text-muted">
                      {t(NAV_LABEL[i.href])}
                    </div>
                  ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("clients.hiddenSections")} subtitle={t("clients.hiddenSectionsHint")} />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NAV.map((g) => (
              <fieldset key={g.group} className="space-y-1.5">
                <legend className="mb-1 text-xs font-semibold text-muted">{t(g.group)}</legend>
                {g.items.map((i) => (
                  <label key={i.section} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="hiddenSections" value={i.section} defaultChecked={hidden.has(i.section)} disabled={i.section === "dashboard"} className="size-4 accent-[var(--brand)]" />
                    {t(NAV_LABEL[i.href])}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("clients.reportTheme")} subtitle={t("clients.reportThemeHint")} />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label={t("clients.themePrimary")}>
              <ColorInput name="themePrimary" defaultValue={theme.primary ?? primary ?? ""} label={t("clients.themePrimary")} />
            </Field>
            <Field label={t("clients.themeAccent")}>
              <ColorInput name="themeAccent" defaultValue={theme.accent ?? client.brandColors[1] ?? ""} label={t("clients.themeAccent")} />
            </Field>
            <Field label={t("clients.themeFont")} htmlFor="w-font">
              <Input id="w-font" name="themeFont" maxLength={80} defaultValue={theme.font ?? client.fonts[0] ?? ""} placeholder="IBM Plex Sans Arabic" />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="themeShowLogo" defaultChecked={theme.showLogo ?? true} className="size-4 accent-[var(--brand)]" /> {t("clients.themeShowLogo")}
            </label>
            <Field label={t("clients.themeFooter")} htmlFor="w-footer" className="sm:col-span-2">
              <Input id="w-footer" name="themeFooter" maxLength={300} defaultValue={theme.footer ?? ""} placeholder={t("clients.themeFooterPh")} />
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("clients.customDomain")} />
          <CardBody className="space-y-3">
            <Callout tone="info">{t("clients.customDomainHelp")}</Callout>
            <Field label={t("clients.domainNote")} htmlFor="w-domain" hint={t("clients.domainNoteHint")}>
              <Input id="w-domain" name="domainNote" maxLength={300} dir="ltr" defaultValue={theme.domainNote ?? ""} placeholder="reports.client-domain.com" />
            </Field>
          </CardBody>
        </Card>
      </div>
    </ActionForm>
  );
}
