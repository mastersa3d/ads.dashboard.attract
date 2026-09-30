import "server-only";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import { REPORT_CHARTS, REPORT_KPIS, REPORT_TYPES, TYPE_DEFAULTS } from "./schema";

/** Options for the Report Builder (clients in scope with their platforms/branding, possible owners). */
export async function builderOptions(ctx: PageContext) {
  const [clients, users] = await Promise.all([
    db.client.findMany({
      where: { id: { in: ctx.clientIds } },
      select: { id: true, name: true, brandColors: true, logoUrl: true, accounts: { select: { platform: true } } },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({ where: { organizationId: ctx.user.organizationId, active: true, role: { not: "VIEWER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    clients: clients.map((c) => ({ id: c.id, name: c.name, colors: c.brandColors, logoUrl: c.logoUrl, platforms: [...new Set(c.accounts.map((a) => a.platform))] })),
    users,
    types: REPORT_TYPES as string[],
    kpiOptions: [...REPORT_KPIS] as string[],
    chartOptions: [...REPORT_CHARTS] as string[],
    typeDefaults: TYPE_DEFAULTS as Record<string, { kpis: string[]; charts: string[] }>,
  };
}
