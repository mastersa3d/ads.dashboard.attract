import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { safeEqual } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { enqueue } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

/**
 * Meta Webhooks (developers.facebook.com/docs/graph-api/webhooks).
 *  GET  — subscription verification: echoes hub.challenge when hub.verify_token matches META_WEBHOOK_VERIFY_TOKEN.
 *  POST — payload signed with X-Hub-Signature-256 (HMAC-SHA256 of the raw body with META_APP_SECRET).
 *         For every changed Page / ad account we know, an incremental sync is queued (never inline).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return new NextResponse("Not configured", { status: 503 });
  if (sp.get("hub.mode") === "subscribe" && safeEqual(sp.get("hub.verify_token") ?? "", expected)) {
    return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`webhook:meta:${ip}`, 120, 60_000).ok) return new NextResponse("Too many requests", { status: 429 });
  const secret = process.env.META_APP_SECRET;
  if (!secret) return new NextResponse("Not configured", { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  if (!safeEqual(sig, expected)) return new NextResponse("Invalid signature", { status: 401 });

  let body: { object?: string; entry?: { id?: string }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  const ids = [...new Set((body.entry ?? []).map((e) => String(e.id ?? "")).filter(Boolean))].slice(0, 100);
  const externalIds = ids.flatMap((id) => [id, `act_${id}`]);
  const accounts = await db.adAccount.findMany({
    where: { externalId: { in: externalIds }, platform: { in: ["META", "FACEBOOK", "INSTAGRAM"] }, integrationId: { not: null } },
    select: { integration: { select: { id: true, organizationId: true, enabled: true } } },
  });
  let queued = 0;
  for (const a of accounts) {
    if (!a.integration?.enabled) continue;
    const r = await enqueue("sync.integration", { integrationId: a.integration.id, reason: "webhook" }, { organizationId: a.integration.organizationId, dedupeKey: `sync:${a.integration.id}:webhook` });
    if (!r.deduped) queued++;
  }
  logger.info("webhook.meta", { object: body.object, entries: ids.length, queued });
  // Meta expects a fast 200; work happens in the queue.
  return NextResponse.json({ ok: true });
}
