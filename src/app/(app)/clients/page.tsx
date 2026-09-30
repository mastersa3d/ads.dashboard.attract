import Link from "next/link";
import { Plus, Archive } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { Callout, DataMeta, EmptyState, LinkButton, PageHeader, Tabs } from "@/components/ui/primitives";
import { ClientCard } from "@/components/clients/client-card";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "clients:view");
  const { t, locale, user } = ctx;
  const showArchived = sp.archived === "1" && ctx.can("clients:delete");

  // Active clients come from the tenant scope; archived ones are org-level (admins, or explicit access).
  const where: Prisma.ClientWhereInput = showArchived
    ? {
        organizationId: user.organizationId,
        archived: true,
        ...(user.role === "SUPER_ADMIN" || user.role === "COMPANY_MANAGER" ? {} : { access: { some: { userId: user.id } } }),
      }
    : { organizationId: user.organizationId, id: { in: ctx.clientIds } };

  const rows = await db.client.findMany({
    where,
    orderBy: { name: "asc" },
    include: { _count: { select: { accounts: true, brands: true } }, accountManager: { select: { name: true } } },
  });
  const updated = rows.reduce<Date | null>((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("clients.title")}
        description={t("clients.subtitle")}
        actions={ctx.can("clients:create") ? <LinkButton href="/clients/new" variant="primary"><Plus className="size-4" aria-hidden /> {t("clients.new")}</LinkButton> : undefined}
      />
      {ctx.can("clients:delete") && (
        <Tabs
          active={showArchived ? "archived" : "active"}
          tabs={[
            { key: "active", label: t("clients.activeTab"), href: "/clients" },
            { key: "archived", label: <span className="inline-flex items-center gap-1"><Archive className="size-3.5" aria-hidden /> {t("clients.archivedTab")}</span>, href: "/clients?archived=1" },
          ]}
        />
      )}
      <DataMeta source={t("clients.source")} updated={ctx.rel(updated)} demo={rows.some((r) => r.isDemo)} labels={ctx.metaLabels} />
      {showArchived && <Callout tone="info">{t("clients.archivedHint")}</Callout>}
      {rows.length === 0 ? (
        <EmptyState
          title={showArchived ? t("clients.emptyArchived") : t("clients.empty")}
          hint={showArchived ? undefined : t("clients.emptyHint")}
          action={!showArchived && ctx.can("clients:create") ? <LinkButton href="/clients/new" variant="primary">{t("clients.new")}</LinkButton> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((c) => (
            <ClientCard
              key={c.id}
              t={t}
              locale={locale}
              c={{
                id: c.id,
                name: c.name,
                logoUrl: c.logoUrl,
                coverUrl: c.coverUrl,
                brandColors: c.brandColors,
                industry: c.industry,
                country: c.country,
                currency: c.currency,
                isDemo: c.isDemo,
                archived: c.archived,
                package: c.package,
                accounts: c._count.accounts,
                brands: c._count.brands,
                manager: c.accountManager?.name ?? null,
              }}
            />
          ))}
        </div>
      )}
      {ctx.filters.clientId && !showArchived && (
        <p className="text-xs text-subtle">
          {t("clients.filteredNote")}{" "}
          <Link href="/clients" className="text-brand hover:underline">
            {t("ui.resetFilters")}
          </Link>
        </p>
      )}
    </div>
  );
}
