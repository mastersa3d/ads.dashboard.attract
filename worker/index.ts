import "./server-only-shim";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { runSchedulers } from "@/lib/jobs/scheduler";
import { runBatch } from "@/lib/jobs/handlers";

/**
 * Background worker — `npm run worker` (PM2 / systemd / Docker `worker` target).
 *
 *  - every minute: schedulers enqueue periodic work (sync every 15 min, alerts hourly,
 *    token check daily, due scheduled reports) — idempotent, safe with several workers
 *  - continuously: claims jobs with FOR UPDATE SKIP LOCKED and runs them
 *  - SIGTERM / SIGINT: stops claiming, lets the current batch finish, then disconnects (graceful)
 *
 * Without a long-running process (shared hosting), call POST /api/cron/tick with the CRON_SECRET
 * every few minutes instead.
 */

/** Env vars may be set but empty (e.g. docker-compose `${VAR:-}`) — fall back instead of using 0. */
function positiveInt(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const POLL_MS = positiveInt(process.env.WORKER_POLL_MS, 5_000);
const SCHEDULE_MS = 60_000;
const BATCH = positiveInt(process.env.WORKER_BATCH, 5);

let stopping = false;
let wake: (() => void) | null = null;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info("worker.stopping", { signal });
  wake?.();
  // Hard stop if a job hangs (its lease expires and another worker will retry it).
  setTimeout(() => {
    logger.error("worker.forced_exit", { signal });
    process.exit(1);
  }, 60_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (e) => logger.error("worker.unhandled_rejection", { message: (e as Error)?.message }));

async function main() {
  logger.info("worker.started", { pid: process.pid, pollMs: POLL_MS, batch: BATCH });
  let lastSchedule = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastSchedule >= SCHEDULE_MS) {
        lastSchedule = Date.now();
        await runSchedulers();
      }
      const n = await runBatch(BATCH);
      // Keep draining while there is work; otherwise poll.
      if (n === 0 && !stopping) await sleep(POLL_MS);
    } catch (e) {
      logger.error("worker.loop_error", { message: (e as Error)?.message });
      if (!stopping) await sleep(POLL_MS * 2);
    }
  }
  await db.$disconnect();
  logger.info("worker.stopped");
  process.exit(0);
}

void main();
