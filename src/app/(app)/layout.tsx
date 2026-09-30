import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { accessibleClientIds, accessibleClients } from "@/lib/tenant";
import { getI18n } from "@/lib/i18n/server";
import { unreadFor } from "@/lib/notifications";
import { notificationWhere } from "@/components/admin/notification-scope";
import { AppShell } from "@/components/layout/app-shell";
import { NAV, NAV_LABEL, type NavGroup } from "@/components/layout/nav";
import type { FilterOptions } from "@/components/layout/filter-bar";
import { Objective, FunnelStage, CampaignStatus, ContentStatus, ContentType } from "@prisma/client";

export const dynamic = "force-dynamic";

const distinct = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { t } = await getI18n();
  const theme = (await cookies()).get("theme")?.value === "dark" ? "dark" : "light";
  const [org, clients, ids] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: user.organizationId } }),
    accessibleClients(user),
    accessibleClientIds(user),
  ]);

  // White label: CLIENT users see their client's logo/colours and never see hidden sections.
  const soleClient = user.role === "CLIENT" && clients.length === 1 ? clients[0] : null;
  const hidden = new Set(user.role === "CLIENT" ? clients.flatMap((c) => c.hiddenSections) : []);

  const groups: NavGroup[] = NAV.map((g) => ({
    key: g.group,
    label: t(g.group),
    items: g.items.filter((i) => user.perms.has(i.permission) && !hidden.has(i.section)).map((i) => ({ ...i, label: t(NAV_LABEL[i.href]) })),
  })).filter((g) => g.items.length);

  const scope = { clientId: { in: ids } };
  const [campaigns, adSets, dims, unread, managers, creators, views] = await Promise.all([
    db.campaign.findMany({ where: scope, select: { id: true, name: true, clientId: true, country: true, branch: true, product: true, platform: true }, orderBy: { name: "asc" }, take: 500 }),
    db.adSet.findMany({ where: { campaign: scope }, select: { audience: true }, distinct: ["audience"], take: 200 }),
    db.metricDaily.findMany({ where: scope, select: { device: true, placement: true, ageRange: true, gender: true }, distinct: ["device", "placement", "ageRange", "gender"], take: 500 }),
    notificationWhere(user).then((where) => db.notification.count({ where: { AND: [where, unreadFor(user.id)] } })),
    db.user.findMany({ where: { organizationId: user.organizationId, managedClients: { some: { id: { in: ids } } } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { organizationId: user.organizationId, assignedContent: { some: { clientId: { in: ids } } } }, select: { id: true, name: true } }),
    db.savedView.findMany({ where: { organizationId: user.organizationId, OR: [{ userId: user.id }, { shared: true }] }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const filterOptions: FilterOptions = {
    clients: clients.map((c) => ({ id: c.id, name: c.name, brands: c.brands, accounts: c.accounts })),
    platforms: distinct([...clients.flatMap((c) => c.accounts.map((a) => a.platform)), ...campaigns.map((c) => c.platform)]),
    objectives: Object.values(Objective),
    funnels: Object.values(FunnelStage),
    campaignStatuses: Object.values(CampaignStatus),
    contentStatuses: Object.values(ContentStatus),
    contentTypes: Object.values(ContentType),
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, clientId: c.clientId })),
    countries: distinct(campaigns.map((c) => c.country)),
    branches: distinct(campaigns.map((c) => c.branch)),
    products: distinct(campaigns.map((c) => c.product)),
    audiences: distinct(adSets.map((a) => a.audience)),
    devices: distinct(dims.map((d) => d.device)),
    placements: distinct(dims.map((d) => d.placement)),
    ages: distinct(dims.map((d) => d.ageRange)),
    genders: distinct(dims.map((d) => d.gender)),
    currencies: distinct([org.currency, ...clients.map((c) => c.currency)]),
    managers,
    creators,
    savedViews: views.map((v) => ({ id: v.id, name: v.name, path: v.path, query: v.query, shared: v.shared, mine: v.userId === user.id })),
    lockedClientId: soleClient?.id ?? null,
  };

  return (
    <AppShell
      groups={groups}
      brandName={soleClient?.name ?? org.name}
      logoUrl={soleClient?.logoUrl ?? org.logoUrl}
      brandColor={soleClient?.brandColors[0] ?? org.primaryColor}
      user={{ name: user.name, email: user.email, roleLabel: t(`role.${user.role}`) }}
      unread={unread}
      filterOptions={filterOptions}
      theme={theme}
    >
      {children}
    </AppShell>
  );
}
