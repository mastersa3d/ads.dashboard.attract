import { Trash2, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import type { TFunction } from "@/lib/i18n/translate";
import { Card, CardBody, CardHeader, DataMeta, EmptyState, Field, Input } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { ActionButton } from "@/components/admin/action-button";
import { ImageField } from "@/components/admin/image-field";
import { BrandColorFields } from "./client-fields";
import { ClientLogo } from "./client-card";
import { createBrand, deleteBrand, updateBrand } from "@/app/actions/clients";

function BrandFields({ t, clientId, d }: { t: TFunction; clientId: string; d?: { id: string; name: string; logoUrl: string | null; colors: string[] } }) {
  const p = d?.id ?? "new";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("clients.brandName")} htmlFor={`b-name-${p}`}>
        <Input id={`b-name-${p}`} name="name" required maxLength={120} defaultValue={d?.name ?? ""} />
      </Field>
      <Field label={t("clients.logo")} htmlFor={`b-logo-${p}`}>
        <ImageField id={`b-logo-${p}`} name="logoUrl" defaultValue={d?.logoUrl} clientId={clientId} label={t("clients.logo")} />
      </Field>
      <div className="sm:col-span-2">
        <BrandColorFields t={t} colors={d?.colors} />
      </div>
    </div>
  );
}

/** Brands (sub-brands / product lines) of a client — CRUD. */
export async function BrandsTab({ ctx, clientId, canEdit }: { ctx: PageContext; clientId: string; canEdit: boolean }) {
  const { t } = ctx;
  const brands = await db.brand.findMany({
    where: { clientId },
    orderBy: { name: "asc" },
    include: { _count: { select: { accounts: true, campaigns: true, content: true } } },
  });
  const client = ctx.clients.find((c) => c.id === clientId);
  const meta = <DataMeta source={t("clients.profileSource")} updated={ctx.rel(brands.reduce<Date | null>((m, b) => (!m || b.createdAt > m ? b.createdAt : m), null))} demo={client?.isDemo} labels={ctx.metaLabels} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("clients.tab.brands")} subtitle={t("clients.brandsHint")} meta={meta} />
        {brands.length === 0 ? (
          <EmptyState title={t("clients.noBrands")} hint={canEdit ? t("clients.noBrandsHint") : undefined} />
        ) : (
          <ul className="divide-y divide-border">
            {brands.map((b) => (
              <li key={b.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <ClientLogo name={b.name} logoUrl={b.logoUrl} color={b.colors[0]} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{b.name}</p>
                    <p className="text-xs text-muted">
                      <span className="num">{b._count.accounts}</span> {t("clients.accountsShort")} · <span className="num">{b._count.campaigns}</span> {t("clients.campaignsShort")} ·{" "}
                      <span className="num">{b._count.content}</span> {t("clients.contentShort")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {b.colors.map((c) => (
                      <span key={c} className="size-4 rounded-full border border-border" style={{ background: c }} title={c} />
                    ))}
                  </div>
                  {canEdit && (
                    <ActionButton action={deleteBrand.bind(null, b.id)} variant="ghost" confirm={t("clients.deleteBrandConfirm", { name: b.name })} title={t("ui.delete")}>
                      <Trash2 className="size-4 text-bad" aria-hidden />
                      <span className="sr-only">{t("ui.delete")}</span>
                    </ActionButton>
                  )}
                </div>
                {canEdit && (
                  <details className="mt-2">
                    <summary className="inline-flex cursor-pointer items-center gap-1 text-xs text-brand">
                      <Pencil className="size-3" aria-hidden /> {t("ui.edit")}
                    </summary>
                    <div className="mt-3 rounded-lg border border-border p-3">
                      <ActionForm action={updateBrand.bind(null, b.id)}>
                        <BrandFields t={t} clientId={clientId} d={b} />
                      </ActionForm>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canEdit && (
        <Card>
          <CardHeader title={t("clients.addBrand")} />
          <CardBody>
            <ActionForm action={createBrand.bind(null, clientId)} submitLabel={t("ui.add")} resetOnSuccess>
              <BrandFields t={t} clientId={clientId} />
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
