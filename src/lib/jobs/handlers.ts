import type { Job } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { syncIntegration, checkTokens } from "@/lib/integrations/service";
import { evaluateAlerts } from "@/lib/alerts/engine";
import { sendReport } from "@/lib/reports/send";
import { claim, complete, fail, PermanentJobError, type JobType } from "./queue";

/**
 * Job handlers. Each validates its payload with Zod; invalid payloads are dead-lettered at once.
 * Failures that retrying cannot fix (expired token, missing permission, unconfigured app) throw
 * PermanentJobError; transient ones (rate limits, network, 5xx) are retried with backoff.
 */

const syncPayload = z.object({ integrationId: z.string().min(1) });
const alertsPayload = z.object({ organizationId: z.string().optional() });
const reportPayload = z.object({ reportId: z.string().min(1), scheduled: z.boolean().optional() });
const publishPayload = z.object({ contentId: z.string().min(1), requestedById: z.string().min(1) });

function parse<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const r = schema.safeParse(payload);
  if (!r.success) throw new PermanentJobError(`Invalid payload: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return r.data;
}

export const HANDLERS: Record<JobType, (job: Job) => Promise<unknown>> = {
  async "sync.integration"(job) {
    const { integrationId } = parse(syncPayload, job.payload);
    const r = await syncIntegration(integrationId);
    if (r.status === "FAILED") {
      if (r.code === "AUTH" || r.code === "PERMISSION" || r.code === "NOT_CONFIGURED" || r.code === "UNSUPPORTED") throw new PermanentJobError(r.message);
      throw new Error(r.message);
    }
    return r;
  },

  async "alerts.evaluate"(job) {
    const { organizationId } = parse(alertsPayload, job.payload);
    return evaluateAlerts({ organizationId });
  },

  async "report.send"(job) {
    const { reportId, scheduled } = parse(reportPayload, job.payload);
    return sendReport(reportId, { scheduled });
  },

  async "token.check"() {
    return checkTokens();
  },

  /**
   * Publishing to social platforms needs each platform's publishing permission (e.g. Meta
   * pages_manage_posts / instagram_content_publish, TikTok Content Posting API approval), which this
   * installation has not been granted. Only content that is APPROVED and explicitly requested by a
   * user is ever accepted; the request is recorded and the job ends without contacting any platform.
   */
  async "content.publish"(job) {
    const { contentId, requestedById } = parse(publishPayload, job.payload);
    const item = await db.contentItem.findUnique({ where: { id: contentId }, select: { id: true, status: true, clientId: true, client: { select: { organizationId: true } } } });
    if (!item) throw new PermanentJobError("Content item no longer exists");
    if (item.status !== "APPROVED" && item.status !== "SCHEDULED") throw new PermanentJobError(`Only approved content can be published (status ${item.status})`);
    await db.auditLog.create({
      data: {
        organizationId: item.client.organizationId,
        userId: requestedById,
        clientId: item.clientId,
        action: "publish_requested",
        entity: "ContentItem",
        entityId: item.id,
        summary: "Automatic publishing requires platform publishing permission — not performed. Publish manually and add the post URL.",
      },
    });
    throw new PermanentJobError("Requires platform publishing permission — publish manually");
  },
};

/** Claims and runs up to `limit` jobs. Returns how many were processed. */
export async function runBatch(limit = 5, opts: { types?: readonly JobType[] } = {}) {
  const jobs = await claim(limit, opts.types);
  for (const job of jobs) {
    const started = Date.now();
    const handler = HANDLERS[job.type as JobType];
    try {
      if (!handler) throw new PermanentJobError(`Unknown job type ${job.type}`);
      const result = await handler(job);
      await complete(job.id);
      logger.info("job.succeeded", { jobId: job.id, type: job.type, attempt: job.attempts, ms: Date.now() - started, result: result as Record<string, unknown> });
    } catch (e) {
      const { dead } = await fail(job, e);
      logger[dead ? "error" : "warn"]("job.failed", { jobId: job.id, type: job.type, attempt: job.attempts, dead, message: (e as Error)?.message });
    }
  }
  return jobs.length;
}
