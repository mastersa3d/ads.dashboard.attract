import type { Job, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Postgres-backed job queue (no Redis needed on Hostinger).
 *
 *  - enqueue(): inserts a QUEUED row; `dedupeKey` (stored in payload) prevents duplicate pending jobs
 *    (or any job ever, with `dedupeAnyStatus`, for once-per-occurrence work like scheduled reports).
 *  - claim(): atomically moves due jobs to RUNNING with `SELECT … FOR UPDATE SKIP LOCKED`, so any
 *    number of workers (or the cron HTTP trigger) can run concurrently without double-processing.
 *  - fail(): re-queues with exponential backoff until maxAttempts, then dead-letters as FAILED.
 *  - recoverStale(): re-queues RUNNING jobs whose worker died (lockedAt older than the lease).
 */

export const JOB_TYPES = ["sync.integration", "alerts.evaluate", "report.send", "token.check", "content.publish"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const LEASE_MS = 15 * 60 * 1000;

/** Retry delay after the n-th failed attempt (1-based): 30s, 2m, 8m, 32m… capped at 6h. */
export function retryDelayMs(attempt: number, baseMs = 30_000, capMs = 6 * 3600_000) {
  return Math.min(capMs, baseMs * 4 ** Math.max(0, attempt - 1));
}

/** Errors that retrying cannot fix (bad credentials, missing permission, invalid payload). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown> = {},
  opts: { organizationId?: string | null; runAt?: Date; maxAttempts?: number; dedupeKey?: string; dedupeAnyStatus?: boolean } = {},
): Promise<{ id: string; deduped: boolean }> {
  if (opts.dedupeKey) {
    const existing = await db.job.findFirst({
      where: { type, ...(opts.dedupeAnyStatus ? {} : { status: { in: ["QUEUED", "RUNNING"] } }), payload: { path: ["dedupeKey"], equals: opts.dedupeKey } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, deduped: true };
  }
  const job = await db.job.create({
    data: {
      type,
      organizationId: opts.organizationId ?? null,
      payload: { ...payload, ...(opts.dedupeKey ? { dedupeKey: opts.dedupeKey } : {}) } as Prisma.InputJsonValue,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 5,
    },
  });
  return { id: job.id, deduped: false };
}

/** Claims up to `limit` due jobs. `types` restricts which job types this caller processes. */
export async function claim(limit = 5, types?: readonly string[]): Promise<Job[]> {
  const typeFilter = types?.length ? types : JOB_TYPES;
  return db.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'RUNNING'::"JobStatus", "lockedAt" = now(), "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE "status" = 'QUEUED'::"JobStatus" AND "runAt" <= now() AND "type" = ANY(${typeFilter as string[]})
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

export async function complete(id: string) {
  await db.job.update({ where: { id }, data: { status: "SUCCEEDED", lockedAt: null, lastError: null } });
}

export async function fail(job: Pick<Job, "id" | "attempts" | "maxAttempts">, error: unknown) {
  const message = ((error as Error)?.message ?? String(error)).slice(0, 1000);
  const permanent = error instanceof PermanentJobError;
  const dead = permanent || job.attempts >= job.maxAttempts;
  await db.job.update({
    where: { id: job.id },
    data: dead
      ? { status: "FAILED", lockedAt: null, lastError: message }
      : { status: "QUEUED", lockedAt: null, lastError: message, runAt: new Date(Date.now() + retryDelayMs(job.attempts)) },
  });
  return { dead };
}

export async function recoverStale(now = new Date()) {
  const cutoff = new Date(now.getTime() - LEASE_MS);
  const stale = await db.job.findMany({ where: { status: "RUNNING", lockedAt: { lt: cutoff } }, select: { id: true, attempts: true, maxAttempts: true } });
  for (const j of stale) await fail(j, new Error("Worker lease expired (process stopped while running)"));
  if (stale.length) logger.warn("jobs.recovered_stale", { count: stale.length });
  return stale.length;
}

/** Deletes finished jobs older than `days` so the table stays small. */
export async function prune(days = 30) {
  const r = await db.job.deleteMany({ where: { status: { in: ["SUCCEEDED", "FAILED"] }, updatedAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
  return r.count;
}

export async function queueStats() {
  const rows = await db.job.groupBy({ by: ["status"], _count: { _all: true } });
  const out: Record<string, number> = { QUEUED: 0, RUNNING: 0, SUCCEEDED: 0, FAILED: 0 };
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}
