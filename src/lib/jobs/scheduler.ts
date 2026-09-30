import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueueDueReports } from "@/lib/reports/send";
import { enqueue, prune, recoverStale } from "./queue";

/**
 * Stateless, idempotent scheduler: safe to call every minute from the worker loop or from the
 * CRON_SECRET-protected HTTP trigger. Each periodic job carries a time-bucket dedupe key, so no
 * matter how often (or from how many processes) this runs, each job is enqueued once per bucket.
 *
 *   every 15 min  sync.integration   for each enabled CONNECTED / SYNC_FAILED integration with credentials
 *   hourly        alerts.evaluate    per organization
 *   daily         token.check        refresh / expire tokens
 *   every tick    report.send        for reports whose schedule is due
 */

export const SYNC_INTERVAL_MIN = 15;

const bucket = (now: Date, minutes: number) => new Date(Math.floor(now.getTime() / (minutes * 60_000)) * minutes * 60_000).toISOString();

export async function runSchedulers(now = new Date()) {
  const result = { sync: 0, alerts: 0, expiryChecks: 0, reports: 0, recovered: 0 };
  result.recovered = await recoverStale(now);

  const due = new Date(now.getTime() - SYNC_INTERVAL_MIN * 60_000);
  const integrations = await db.integration.findMany({
    where: {
      enabled: true,
      accessTokenEnc: { not: null },
      status: { in: ["CONNECTED", "SYNC_FAILED"] },
      accounts: { some: {} },
      OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: due } }],
    },
    select: { id: true, organizationId: true },
  });
  const syncBucket = bucket(now, SYNC_INTERVAL_MIN);
  for (const i of integrations) {
    const r = await enqueue("sync.integration", { integrationId: i.id }, { organizationId: i.organizationId, dedupeKey: `sync:${i.id}:${syncBucket}`, dedupeAnyStatus: true, maxAttempts: 4 });
    if (!r.deduped) result.sync++;
  }

  const orgs = await db.organization.findMany({ select: { id: true } });
  const hour = bucket(now, 60);
  for (const o of orgs) {
    const r = await enqueue("alerts.evaluate", { organizationId: o.id }, { organizationId: o.id, dedupeKey: `alerts:${o.id}:${hour}`, dedupeAnyStatus: true, maxAttempts: 3 });
    if (!r.deduped) result.alerts++;
  }

  const day = now.toISOString().slice(0, 10);
  const tok = await enqueue("token.check", {}, { dedupeKey: `tokens:${day}`, dedupeAnyStatus: true, maxAttempts: 3 });
  if (!tok.deduped) {
    result.expiryChecks++;
    await prune(30); // once a day, drop finished jobs older than 30 days
  }

  result.reports = await enqueueDueReports(now);
  if (result.sync || result.alerts || result.expiryChecks || result.reports) logger.info("scheduler.enqueued", result);
  return result;
}
