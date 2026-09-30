import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { accessibleClientIds, accessibleClients } from "@/lib/tenant";
import { getI18n } from "@/lib/i18n/server";
import { parseFilters, filtersToQuery, type RawParams } from "@/lib/filters";
import { fmtRelative, type Locale } from "@/lib/format";
import type { Permission } from "@/lib/rbac";
import { fxFromSettings } from "@/lib/fx";
import type { Q } from "@/lib/queries/performance";

/**
 * Standard bootstrap for every protected page:
 *
 *   export default async function Page({ searchParams }: { searchParams: Promise<RawParams> }) {
 *     const ctx = await pageContext(await searchParams, "analytics:view");
 *     const rows = await db.metricDaily.findMany({ where: { ...ctx.scope, ... } });
 *   }
 *
 * Performance queries (lib/queries/performance.ts) take `ctx.q` (scope + currency + FX).
 * `ctx.scope` is the tenant-isolation fragment `{ clientId: ... }` — ALWAYS spread it into
 * Prisma `where` clauses for client-owned models. It already honours the `client` filter.
 */
export async function pageContext(sp: RawParams, permission?: Permission) {
  const user = await requireUser(permission);
  const { t, locale } = await getI18n();
  const filters = parseFilters(sp);
  const ids = await accessibleClientIds(user);
  const clients = await accessibleClients(user);
  const selectedClientId = filters.clientId && ids.includes(filters.clientId) ? filters.clientId : ids.length === 1 ? ids[0] : undefined;
  const scope = selectedClientId ? { clientId: selectedClientId } : { clientId: { in: ids } };
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  const org = await db.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
  const currency = filters.currency ?? client?.currency ?? org.currency;
  const isDemo = client ? client.isDemo : clients.some((c) => c.isDemo);
  const query = filtersToQuery(sp);
  const fx = fxFromSettings(org.settings);
  const currencies = [...new Set(clients.filter((c) => !selectedClientId || c.id === selectedClientId).map((c) => c.currency))];
  /** Pass to performance queries: tenant scope + reporting currency + FX. */
  const q: Q = { scope, currency, fx };

  return {
    user,
    t,
    locale,
    filters,
    scope,
    clientIds: selectedClientId ? [selectedClientId] : ids,
    clients,
    client,
    org,
    currency,
    fx,
    q,
    /** true when rolled-up money was converted from other currencies (show an FX note). */
    fxApplied: currencies.some((c) => c !== currency),
    timezone: client?.timezone ?? org.timezone,
    isDemo,
    query,
    can: (p: Permission) => user.perms.has(p),
    /** Labels for <DataMeta>; pass `updated` with fmtRelative(date, locale). */
    metaLabels: {
      source: t("ui.source"),
      updated: t("ui.lastUpdated"),
      demo: t("ui.demoData"),
      demoHint: t("ui.demoDataHint"),
      estimate: t("ui.estimate"),
      estimateHint: t("ui.estimateHint"),
    },
    rel: (d: Date | null | undefined) => (d ? fmtRelative(d, locale as Locale) : null),
  };
}

export type PageContext = Awaited<ReturnType<typeof pageContext>>;

/** Latest sync timestamp for metric data in scope — shown as "Last updated" on charts. */
export async function lastMetricSync(scope: { clientId: string | { in: string[] } }) {
  const r = await db.metricDaily.aggregate({ where: scope, _max: { syncedAt: true } });
  return r._max.syncedAt;
}

/** Human-readable list of data sources in scope, e.g. "Meta Ads API, Google Ads API". */
export async function metricSources(scope: { clientId: string | { in: string[] } }, t: (k: string) => string) {
  const rows = await db.metricDaily.groupBy({ by: ["platform", "source"], where: scope });
  if (!rows.length) return "—";
  const demo = rows.some((r) => r.source === "DEMO");
  const plats = [...new Set(rows.map((r) => t(`platform.${r.platform}`)))].join(", ");
  return demo ? `${plats} (${t("source.DEMO")})` : `${plats} — ${t("source.API")}`;
}
