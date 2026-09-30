import "server-only";
import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import type { EditorOptions } from "@/components/content/types";
import { conflictSettings } from "./conflicts";
import { integrationKey } from "./publishing";

/** Platforms a content item can be planned for (analytics-only sources are excluded). */
export const CONTENT_PLATFORMS: Platform[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN", "YOUTUBE", "X", "META", "GOOGLE_ADS", "EMAIL"];

const distinct = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x && x.trim())))].sort((a, b) => a.localeCompare(b));

/** Everything the editor drawer needs, scoped to the clients the user can access. */
export async function editorOptions(ctx: PageContext): Promise<EditorOptions> {
  const ids = ctx.clientIds;
  const scope = { clientId: { in: ids } };
  const [users, contentDims, campaigns, integrations] = await Promise.all([
    db.user.findMany({
      where: { organizationId: ctx.user.organizationId, active: true, role: { in: ["SUPER_ADMIN", "COMPANY_MANAGER", "MARKETING_TEAM"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.contentItem.findMany({ where: scope, select: { campaignName: true, pillar: true, audience: true }, distinct: ["campaignName", "pillar", "audience"], take: 1000 }),
    db.campaign.findMany({ where: scope, select: { name: true }, distinct: ["name"], take: 300 }),
    db.integration.findMany({ where: { organizationId: ctx.user.organizationId, clientId: { in: ids }, status: "CONNECTED", enabled: true }, select: { clientId: true, platform: true } }),
  ]);
  return {
    clients: ctx.clients
      .filter((c) => ids.includes(c.id))
      .map((c) => ({ id: c.id, name: c.name, timezone: c.timezone, currency: c.currency, isDemo: c.isDemo, brands: c.brands })),
    users,
    campaigns: distinct([...contentDims.map((d) => d.campaignName), ...campaigns.map((c) => c.name)]),
    pillars: distinct(contentDims.map((d) => d.pillar)),
    audiences: distinct(contentDims.map((d) => d.audience)),
    connected: integrations.filter((i) => i.clientId).map((i) => integrationKey(i.clientId as string, i.platform)),
    perms: [...ctx.user.perms],
    role: ctx.user.role,
    conflictWindowMinutes: conflictSettings(ctx.org.settings).windowMinutes,
    timezone: ctx.timezone,
    platforms: CONTENT_PLATFORMS,
  };
}
