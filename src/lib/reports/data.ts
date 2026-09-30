import "server-only";
import type { Report } from "@prisma/client";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import { fxFromSettings } from "@/lib/fx";
import { isoDay } from "@/lib/format";
import { totalsWithComparison, dailySeries, byPlatform, byEntity, organicSummary, plannedBudget, type Q } from "@/lib/queries/performance";
import { readConfig, readSummary } from "./schema";

/**
 * Everything a report page (in-app /reports/[id] or public /r/[token]) needs, computed through the
 * shared performance queries with a tenant scope of exactly the report's client.
 * Callers MUST have authorised access to `report.clientId` before calling.
 */
export async function loadReportData(report: Report) {
  const client = await db.client.findUniqueOrThrow({
    where: { id: report.clientId },
    select: { id: true, name: true, logoUrl: true, brandColors: true, currency: true, timezone: true, isDemo: true, reportTheme: true, organization: { select: { name: true, logoUrl: true, settings: true } } },
  });
  const config = readConfig(report.config);
  const summary = readSummary(report.summary);
  const f = parseFilters({
    client: client.id,
    from: isoDay(report.periodStart),
    to: isoDay(report.periodEnd),
    compare: config.compare,
    platform: config.platforms.length ? config.platforms.join(",") : undefined,
  });
  const q: Q = { scope: { clientId: client.id }, currency: client.currency, fx: fxFromSettings(client.organization.settings) };

  const [kpis, series, platforms, campaigns, organic, budget, sources, updated, tasks] = await Promise.all([
    totalsWithComparison(f, q),
    dailySeries(f, q),
    byPlatform(f, q),
    byEntity(f, q, "campaign"),
    organicSummary(f, q),
    plannedBudget(f, q),
    db.metricDaily.groupBy({ by: ["platform", "source"], where: { clientId: client.id, date: { gte: f.from, lte: f.to } } }),
    db.metricDaily.aggregate({ where: { clientId: client.id }, _max: { syncedAt: true } }),
    db.task.findMany({ where: { reportId: report.id, clientId: client.id }, include: { assignee: { select: { name: true } } }, orderBy: [{ dueDate: "asc" }] }),
  ]);

  // White label: explicit report theme > client report theme > client brand colours.
  const clientTheme = (client.reportTheme ?? {}) as { primary?: string; accent?: string; logoUrl?: string };
  const theme = {
    primary: config.theme.primary ?? clientTheme.primary ?? client.brandColors[0] ?? null,
    accent: config.theme.accent ?? clientTheme.accent ?? client.brandColors[1] ?? null,
    logoUrl: config.theme.logoUrl || clientTheme.logoUrl || client.logoUrl || null,
    whiteLabel: config.theme.whiteLabel,
  };

  return {
    client,
    config,
    summary,
    filters: f,
    kpis,
    series,
    platforms,
    campaigns,
    organic,
    budget: { planned: budget.planned, fullPeriod: budget.fullPeriod },
    demo: client.isDemo || sources.some((s) => s.source === "DEMO"),
    sourcePlatforms: [...new Set(sources.map((s) => s.platform))],
    sourceKinds: [...new Set(sources.map((s) => s.source))],
    updated: updated._max.syncedAt,
    tasks,
    theme,
  };
}

export type ReportData = Awaited<ReturnType<typeof loadReportData>>;
