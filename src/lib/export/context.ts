import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/session";
import { accessibleClientIds, accessibleClients } from "@/lib/tenant";
import { getLocale } from "@/lib/i18n/server";
import { makeT, type TFunction } from "@/lib/i18n/translate";
import { parseFilters, type Filters, type RawParams } from "@/lib/filters";
import { fxFromSettings } from "@/lib/fx";
import type { Q } from "@/lib/queries/performance";
import type { Locale } from "@/lib/format";

/**
 * Route-handler twin of pageContext(): same tenant scope, reporting currency and FX rules,
 * but built for an already-asserted user (no redirects) so exports see exactly what the page saw.
 */
export async function exportContext(user: CurrentUser, sp: RawParams) {
  const locale: Locale = await getLocale();
  const t: TFunction = makeT(locale);
  const filters: Filters = parseFilters(sp);
  const [ids, clients, org] = await Promise.all([
    accessibleClientIds(user),
    accessibleClients(user),
    db.organization.findUniqueOrThrow({ where: { id: user.organizationId } }),
  ]);
  const selectedClientId = filters.clientId && ids.includes(filters.clientId) ? filters.clientId : ids.length === 1 ? ids[0] : undefined;
  const scope = selectedClientId ? { clientId: selectedClientId } : { clientId: { in: ids } };
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  const currency = filters.currency ?? client?.currency ?? org.currency;
  const q: Q = { scope, currency, fx: fxFromSettings(org.settings) };
  return { user, locale, t, filters, scope, clientIds: selectedClientId ? [selectedClientId] : ids, clients, client, org, currency, q };
}

export type ExportContext = Awaited<ReturnType<typeof exportContext>>;
