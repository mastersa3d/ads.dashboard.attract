import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness + DB readiness for Docker/PM2/uptime monitors.
 * Returns only the app version, DB status and latency; never configuration or secrets.
 */
export async function GET() {
  const started = Date.now();
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const body = { status: dbOk ? "ok" : "degraded", version: pkg.version, db: dbOk ? "ok" : "unreachable", latencyMs: Date.now() - started, time: new Date().toISOString() };
  return NextResponse.json(body, { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
