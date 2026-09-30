import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { runSchedulers } from "@/lib/jobs/scheduler";
import { runBatch } from "@/lib/jobs/handlers";
import type { JobType } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * HTTP trigger for shared hosting without a long-running worker (e.g. Hostinger hPanel cron):
 *
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/tick
 *
 * Tasks: tick (schedule + run due jobs) | sync | alerts | reports | tokens (run only that job type).
 * The secret is only accepted in a header (never in the URL, which ends up in access logs).
 * Jobs are claimed with SKIP LOCKED, so this is safe alongside a worker process.
 */

const TASK_TYPES: Record<string, JobType[] | null> = {
  tick: null,
  sync: ["sync.integration"],
  alerts: ["alerts.evaluate"],
  reports: ["report.send"],
  tokens: ["token.check"],
};

const BUDGET_MS = 45_000;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return null;
  const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.headers.get("x-cron-secret") ?? "";
  return safeEqual(header, secret);
}

async function handle(req: NextRequest, { params }: { params: Promise<{ task: string }> }) {
  const { task } = await params;
  const ok = authorized(req);
  if (ok === null) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (!ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!(task in TASK_TYPES)) return NextResponse.json({ error: "UNKNOWN_TASK" }, { status: 404 });

  const started = Date.now();
  const scheduled = await runSchedulers();
  const types = TASK_TYPES[task] ?? undefined;
  let processed = 0;
  // Claim one job at a time so we never hold jobs we don't have time to finish.
  while (Date.now() - started < BUDGET_MS) {
    const n = await runBatch(1, { types });
    if (n === 0) break;
    processed += n;
  }
  logger.info("cron.run", { task, processed, ms: Date.now() - started });
  return NextResponse.json({ ok: true, task, scheduled, processed, ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = handle;
export const GET = handle;
