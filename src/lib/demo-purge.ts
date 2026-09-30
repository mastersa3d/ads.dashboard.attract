import type { PrismaClient } from "@prisma/client";

/**
 * Removes every piece of DEMO data so a workspace only holds real, verified information.
 *
 *  - Demo clients (Client.isDemo) — and, by cascade, their brands, accounts, campaigns, metrics,
 *    organic stats, strategy, budget plans, content, competitors, ideas, trends, reports, tasks,
 *    files and integrations. Rows that reference a client without a foreign key (expenses,
 *    AI recommendations, notifications) are deleted explicitly.
 *  - Illustrative / demo benchmarks (source names marked "demo" or "Illustrative").
 *  - Demo user accounts (@demo.local) except `keepUserId` (the admin running the purge).
 *  - Demo FX rates are reset to defaults.
 *
 * Real clients, users and benchmarks are never touched. Works without "server-only" so the
 * CLI script (scripts/purge-demo.ts) can use it too.
 */
export async function purgeDemoData(db: PrismaClient, opts: { organizationId?: string; keepUserId?: string } = {}) {
  const orgFilter = opts.organizationId ? { organizationId: opts.organizationId } : {};
  const demoClients = await db.client.findMany({ where: { ...orgFilter, isDemo: true }, select: { id: true } });
  const ids = demoClients.map((c) => c.id);

  const result = await db.$transaction(async (tx) => {
    const expenses = await tx.expense.deleteMany({ where: { clientId: { in: ids } } });
    const recs = await tx.aiRecommendation.deleteMany({ where: { clientId: { in: ids } } });
    const notifications = await tx.notification.deleteMany({
      where: { ...orgFilter, OR: [{ clientId: { in: ids } }, { title: { contains: "(Demo)" } }, { body: { contains: "(Demo)" } }] },
    });
    const clients = await tx.client.deleteMany({ where: { id: { in: ids } } });
    const benchmarks = await tx.benchmark.deleteMany({
      where: {
        AND: [
          { OR: [{ sourceName: { contains: "demo", mode: "insensitive" } }, { sourceName: { contains: "Illustrative", mode: "insensitive" } }] },
          ...(opts.organizationId ? [{ OR: [{ organizationId: null }, { organizationId: opts.organizationId }] }] : []),
        ],
      },
    });
    const users = await tx.user.deleteMany({
      where: { ...orgFilter, email: { endsWith: "@demo.local" }, ...(opts.keepUserId ? { id: { not: opts.keepUserId } } : {}) },
    });
    // Saved views pointing at demo clients no longer resolve — drop them.
    const views = ids.length ? await tx.savedView.deleteMany({ where: { ...orgFilter, OR: ids.map((id) => ({ query: { contains: id } })) } }) : { count: 0 };

    const orgs = await tx.organization.findMany({ where: opts.organizationId ? { id: opts.organizationId } : {}, select: { id: true, settings: true } });
    for (const o of orgs) {
      const s = (o.settings ?? {}) as Record<string, unknown> & { fx?: { source?: string } };
      if (s.fx?.source && /demo/i.test(s.fx.source)) {
        const next = { ...s };
        delete next.fx;
        await tx.organization.update({ where: { id: o.id }, data: { settings: next as object } });
      }
    }
    return { clients: clients.count, expenses: expenses.count, recommendations: recs.count, notifications: notifications.count, benchmarks: benchmarks.count, users: users.count, savedViews: views.count };
  });
  return result;
}

export async function demoDataSummary(db: PrismaClient, organizationId: string) {
  const [clients, users, benchmarks] = await Promise.all([
    db.client.count({ where: { organizationId, isDemo: true } }),
    db.user.count({ where: { organizationId, email: { endsWith: "@demo.local" } } }),
    db.benchmark.count({ where: { OR: [{ sourceName: { contains: "demo", mode: "insensitive" } }, { sourceName: { contains: "Illustrative", mode: "insensitive" } }] } }),
  ]);
  return { clients, users, benchmarks, any: clients + users + benchmarks > 0 };
}
