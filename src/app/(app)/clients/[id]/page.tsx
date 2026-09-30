import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, LayoutDashboard } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { Badge, Callout, DemoBadge, LinkButton, Tabs } from "@/components/ui/primitives";
import { ActionButton } from "@/components/admin/action-button";
import { ClientLogo } from "@/components/clients/client-card";
import { OverviewTab } from "@/components/clients/overview-tab";
import { ProfileTab } from "@/components/clients/profile-tab";
import { BrandsTab } from "@/components/clients/brands-tab";
import { BrandingTab } from "@/components/clients/branding-tab";
import { AccessTab } from "@/components/clients/access-tab";
import { countryName } from "@/components/admin/constants";
import { setClientArchived } from "@/app/actions/clients";

export const metadata = { title: "Client overview" };

const TABS = ["overview", "profile", "brands", "branding", "access"] as const;
type Tab = (typeof TABS)[number];

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawParams> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await pageContext(sp, "clients:view");
  const { t, locale, user } = ctx;

  const accessible = ctx.clients.some((c) => c.id === id);
  const client = await db.client.findFirst({
    where: { id, organizationId: user.organizationId },
    include: { accountManager: { select: { id: true, name: true, email: true } } },
  });
  if (!client) notFound();
  // Tenant check. Archived clients drop out of the accessible set; only people who may restore them see them.
  const canSeeArchived =
    client.archived && ctx.can("clients:delete") && (user.role === "SUPER_ADMIN" || user.role === "COMPANY_MANAGER" || (await db.clientAccess.count({ where: { userId: user.id, clientId: id } })) > 0);
  if (!accessible && !canSeeArchived) notFound();

  const can = {
    edit: ctx.can("clients:edit"),
    del: ctx.can("clients:delete"),
    manageAccess: ctx.can("users:manage"),
    viewAccess: ctx.can("users:view"),
  };
  const available: Tab[] = TABS.filter((k) => (k === "branding" ? can.edit : k === "access" ? can.viewAccess : true));
  const tab: Tab = available.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";
  const primary = client.brandColors[0];

  const cover = client.coverUrl
    ? { backgroundImage: `url("${client.coverUrl.replace(/"/g, "")}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: `linear-gradient(135deg, ${primary ?? "var(--brand)"}, ${client.brandColors[1] ?? primary ?? "var(--brand)"})` };

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
        <div className="h-24 sm:h-32" style={cover} aria-hidden />
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="-mt-8 shrink-0 rounded-xl bg-surface p-0.5">
              <ClientLogo name={client.name} logoUrl={client.logoUrl} color={primary} size="lg" />
            </div>
            <div className="min-w-0 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{client.name}</h1>
                {client.isDemo && <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} />}
                {client.archived && <Badge tone="warning">{t("clients.archived")}</Badge>}
              </div>
              <p className="truncate text-sm text-muted">
                {client.industry ?? t("clients.noIndustry")} · {countryName(client.country, locale)} · <span className="num">{client.currency}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2 no-print">
            {!client.archived && (
              <LinkButton href={`/dashboard?client=${client.id}`} size="sm">
                <LayoutDashboard className="size-3.5" aria-hidden /> {t("clients.openDashboard")}
              </LinkButton>
            )}
            {can.del &&
              (client.archived ? (
                <ActionButton action={setClientArchived.bind(null, client.id, false)} variant="success">
                  <ArchiveRestore className="size-3.5" aria-hidden /> {t("clients.restore")}
                </ActionButton>
              ) : (
                <ActionButton action={setClientArchived.bind(null, client.id, true)} variant="danger" confirm={t("clients.archiveConfirm", { name: client.name })}>
                  <Archive className="size-3.5" aria-hidden /> {t("clients.archive")}
                </ActionButton>
              ))}
          </div>
        </div>
      </div>

      {client.archived ? (
        <Callout tone="warning" title={t("clients.archivedTitle")}>
          {t("clients.archivedBody")}
        </Callout>
      ) : (
        <>
          <Tabs active={tab} tabs={available.map((k) => ({ key: k, label: t(`clients.tab.${k}`), href: `/clients/${client.id}?tab=${k}` }))} />
          {tab === "overview" && <OverviewTab ctx={ctx} client={client} />}
          {tab === "profile" && <ProfileTab ctx={ctx} client={client} canEdit={can.edit} />}
          {tab === "brands" && <BrandsTab ctx={ctx} clientId={client.id} canEdit={can.edit} />}
          {tab === "branding" && <BrandingTab ctx={ctx} client={client} />}
          {tab === "access" && <AccessTab ctx={ctx} clientId={client.id} canManage={can.manageAccess} />}
        </>
      )}
    </div>
  );
}
