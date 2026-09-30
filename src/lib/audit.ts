import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/session";
import { sanitize } from "@/lib/sanitize";

export { sanitize };

export async function audit(
  user: Pick<CurrentUser, "id" | "email" | "organizationId"> | null,
  entry: {
    action: string;
    entity: string;
    entityId?: string | null;
    clientId?: string | null;
    summary?: string;
    diff?: unknown;
    organizationId?: string;
  },
) {
  let ip: string | null = null;
  try {
    ip = clientIp(await headers());
  } catch {
    // outside a request (worker)
  }
  const organizationId = entry.organizationId ?? user?.organizationId;
  if (!organizationId) return;
  await db.auditLog.create({
    data: {
      organizationId,
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      clientId: entry.clientId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      diff: entry.diff === undefined ? undefined : (sanitize(entry.diff) as object),
      ip,
    },
  });
}
