import Link from "next/link";
import { FileText, ExternalLink } from "lucide-react";
import type { Client } from "@prisma/client";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import { CLIENT_SCOPED_ROLES } from "@/lib/rbac";
import { fmtDate, fmtNumber, isoDay } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, DataMeta, EmptyState, Field, Input, LinkButton, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { ImageField } from "@/components/admin/image-field";
import { countryName } from "@/components/admin/constants";
import { ClientBasicsFields, ListField } from "./client-fields";
import { updateClientProfile } from "@/app/actions/clients";

type ClientWithManager = Client & { accountManager: { id: string; name: string; email: string } | null };

/** Client Profile: every descriptive field. Editors get a form, everyone else a read-only sheet. */
export async function ProfileTab({ ctx, client, canEdit }: { ctx: PageContext; client: ClientWithManager; canEdit: boolean }) {
  const { t, locale, user } = ctx;
  const internal = !CLIENT_SCOPED_ROLES.includes(user.role);
  const [managers, accounts, files, competitors] = await Promise.all([
    canEdit
      ? db.user.findMany({ where: { organizationId: user.organizationId, active: true, role: { in: ["SUPER_ADMIN", "COMPANY_MANAGER", "MARKETING_TEAM"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    db.adAccount.findMany({ where: { clientId: client.id }, select: { id: true, name: true, platform: true }, orderBy: { platform: "asc" } }),
    db.fileAsset.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.competitor.count({ where: { clientId: client.id, state: "ACCEPTED" } }),
  ]);
  const meta = <DataMeta source={t("clients.profileSource")} updated={ctx.rel(client.updatedAt)} demo={client.isDemo} labels={ctx.metaLabels} />;

  const related = (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader title={t("clients.linkedAccounts")} meta={meta} />
        <CardBody>
          {accounts.length ? (
            <ul className="space-y-1.5 text-sm">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <Badge>{t(`platform.${a.platform}`)}</Badge>
                  <span className="truncate">{a.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("clients.noAccounts")} hint={t("clients.noAccountsHint")} />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("clients.competitors")} meta={meta} />
        <CardBody className="space-y-3">
          <p className="text-sm">
            <span className="num text-2xl font-bold">{fmtNumber(competitors, locale)}</span> <span className="text-muted">{t("clients.competitorsTracked")}</span>
          </p>
          {ctx.can("competitors:view") && (
            <LinkButton href={`/competitors?client=${client.id}`} size="sm">
              {t("clients.openCompetitors")}
            </LinkButton>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("clients.importantFiles")} meta={<DataMeta source={t("clients.filesSource")} updated={ctx.rel(files[0]?.createdAt)} demo={client.isDemo} labels={ctx.metaLabels} />} />
        <CardBody>
          {files.length ? (
            <ul className="space-y-1.5 text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <FileText className="size-4 shrink-0 text-subtle" aria-hidden />
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="truncate text-brand hover:underline">
                    {f.name}
                  </a>
                  <span className="num ms-auto shrink-0 text-[11px] text-subtle">{fmtDate(f.createdAt, locale)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("clients.noFiles")} hint={ctx.can("content:view") ? t("clients.noFilesHint") : undefined} />
          )}
          {ctx.can("content:view") && (
            <Link href={`/library?client=${client.id}`} className="mt-3 inline-block text-xs text-brand hover:underline">
              {t("clients.openLibrary")}
            </Link>
          )}
        </CardBody>
      </Card>
    </div>
  );

  if (!canEdit) {
    const item = (label: string, value: React.ReactNode) => (
      <div className="rounded-lg border border-border p-3">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="mt-1 text-sm break-words whitespace-pre-line">{value || "—"}</dd>
      </div>
    );
    const list = (xs: string[]) => (xs.length ? xs.join("، ") : null);
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader title={t("clients.tab.profile")} meta={meta} />
          <CardBody>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {item(t("clients.name"), client.name)}
              {item(t("clients.industry"), client.industry)}
              {item(t("filter.country"), countryName(client.country, locale))}
              {item(t("filter.currency"), client.currency)}
              {item(t("clients.timezone"), client.timezone)}
              {item(
                t("clients.website"),
                client.website && (
                  <a href={client.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline" dir="ltr">
                    {client.website} <ExternalLink className="size-3" aria-hidden />
                  </a>
                ),
              )}
              {item(t("clients.fonts"), list(client.fonts))}
              {item(t("filter.branch"), list(client.branches))}
              {item(t("clients.products"), list(client.products))}
              {item(t("clients.audiences"), list(client.audiences))}
              {item(t("clients.contact"), [client.contactName, client.contactEmail, client.contactPhone].filter(Boolean).join(" · "))}
              {item(t("clients.accountManager"), client.accountManager?.name)}
              {item(t("clients.contractStart"), client.contractStart && fmtDate(client.contractStart, locale))}
              {item(t("clients.package"), client.package)}
              {item(t("clients.goals"), client.goals)}
              {internal && item(t("ui.notes"), client.notes)}
            </dl>
          </CardBody>
        </Card>
        {related}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("clients.tab.profile")} subtitle={t("clients.profileHint")} meta={meta} />
        <CardBody>
          <ActionForm action={updateClientProfile.bind(null, client.id)}>
            <ClientBasicsFields t={t} locale={locale} managers={managers} d={client} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("clients.cover")} htmlFor="c-cover" className="sm:col-span-2" hint={t("clients.coverHint")}>
                <ImageField id="c-cover" name="coverUrl" defaultValue={client.coverUrl} clientId={client.id} label={t("clients.cover")} />
              </Field>
              <Field label={t("clients.fonts")} htmlFor="c-fonts" hint={t("clients.fontsHint")}>
                <Input id="c-fonts" name="fonts" defaultValue={client.fonts.join(", ")} />
              </Field>
              <Field label={t("clients.contractStart")} htmlFor="c-contract">
                <Input id="c-contract" name="contractStart" type="date" defaultValue={client.contractStart ? isoDay(client.contractStart) : ""} />
              </Field>
              <ListField t={t} id="c-branches" name="branches" label={t("filter.branch")} values={client.branches} />
              <ListField t={t} id="c-products" name="products" label={t("clients.products")} values={client.products} />
              <ListField t={t} id="c-audiences" name="audiences" label={t("clients.audiences")} values={client.audiences} />
              <Field label={t("clients.goals")} htmlFor="c-goals">
                <Textarea id="c-goals" name="goals" rows={3} maxLength={4000} defaultValue={client.goals ?? ""} />
              </Field>
              <Field label={t("clients.contactName")} htmlFor="c-cn">
                <Input id="c-cn" name="contactName" maxLength={120} defaultValue={client.contactName ?? ""} />
              </Field>
              <Field label={t("clients.contactEmail")} htmlFor="c-ce">
                <Input id="c-ce" name="contactEmail" type="email" dir="ltr" defaultValue={client.contactEmail ?? ""} />
              </Field>
              <Field label={t("clients.contactPhone")} htmlFor="c-cp">
                <Input id="c-cp" name="contactPhone" type="tel" dir="ltr" maxLength={40} defaultValue={client.contactPhone ?? ""} />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" name="isB2B" defaultChecked={client.isB2B} className="size-4 accent-[var(--brand)]" /> {t("clients.isB2B")}
              </label>
              <Field label={t("clients.internalNotes")} htmlFor="c-notes" className="sm:col-span-2" hint={t("clients.internalNotesHint")}>
                <Textarea id="c-notes" name="notes" rows={4} maxLength={8000} defaultValue={client.notes ?? ""} />
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
      {related}
    </div>
  );
}
