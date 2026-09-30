import "server-only";
import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Most specific benchmark per metric: org manual > matching industry/country > global.
 * Returned rows always carry sourceName / asOf / isEstimate so the UI can label them.
 */
export async function benchmarksFor(opts: { organizationId: string; platforms: Platform[]; country?: string | null; industry?: string | null }) {
  const platforms = opts.platforms.length ? opts.platforms : (["META"] as Platform[]);
  const rows = await db.benchmark.findMany({
    where: { OR: [{ organizationId: null }, { organizationId: opts.organizationId }], platform: { in: platforms } },
    orderBy: { asOf: "desc" },
  });
  const score = (b: (typeof rows)[number]) =>
    (b.organizationId ? 4 : 0) + (opts.industry && b.industry === opts.industry ? 2 : 0) + (opts.country && b.country === opts.country ? 1 : 0) + (b.platform === platforms[0] ? 0.5 : 0);
  // Never apply a benchmark for a different industry/country than the one requested.
  const applicable = rows.filter((b) => (!b.industry || !opts.industry || b.industry === opts.industry) && (!b.country || !opts.country || b.country === opts.country));
  const best = new Map<string, (typeof rows)[number]>();
  for (const b of applicable) {
    const cur = best.get(b.metric);
    if (!cur || score(b) > score(cur)) best.set(b.metric, b);
  }
  return [...best.values()];
}
