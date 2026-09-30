import "server-only";
import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Posting-conflict prevention: two posts for the same client + platform inside a window
 * (default 2 hours) cannibalise each other's reach. Configured per organization in
 * Organization.settings.content = { conflictWindowMinutes: number, conflictMode: "warn" | "block" }
 * (env CONTENT_CONFLICT_WINDOW_MINUTES overrides the default).
 *  - warn:  the save is paused and the user must confirm "schedule anyway"
 *  - block: the save is refused
 */

export type ConflictSettings = { windowMinutes: number; mode: "warn" | "block" };
export type Conflict = { id: string; title: string; publishAt: string; platform: Platform; status: string };

const DEFAULT_WINDOW = Number(process.env.CONTENT_CONFLICT_WINDOW_MINUTES) || 120;

export function conflictSettings(orgSettings: unknown): ConflictSettings {
  const c = (orgSettings && typeof orgSettings === "object" ? (orgSettings as Record<string, unknown>).content : null) as Record<string, unknown> | null;
  const w = Number(c?.conflictWindowMinutes);
  return {
    windowMinutes: Number.isFinite(w) && w >= 0 && w <= 24 * 60 ? w : DEFAULT_WINDOW,
    mode: c?.conflictMode === "block" ? "block" : "warn",
  };
}

export async function orgConflictSettings(organizationId: string) {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
  return conflictSettings(org?.settings);
}

/**
 * Posts of the same client + platform within ±window of each slot. `excludeIds` skips the
 * item being edited (and siblings being created in the same batch). Rejected posts don't count.
 */
export async function findConflicts(opts: {
  clientId: string;
  platform: Platform;
  slots: Date[];
  windowMinutes: number;
  excludeIds?: string[];
}): Promise<Conflict[]> {
  if (!opts.slots.length || opts.windowMinutes <= 0) return [];
  const ms = opts.windowMinutes * 60000;
  const rows = await db.contentItem.findMany({
    where: {
      clientId: opts.clientId,
      platform: opts.platform,
      status: { not: "REJECTED" },
      id: opts.excludeIds?.length ? { notIn: opts.excludeIds } : undefined,
      OR: opts.slots.map((s) => ({ publishAt: { gt: new Date(s.getTime() - ms), lt: new Date(s.getTime() + ms) } })),
    },
    select: { id: true, title: true, publishAt: true, platform: true, status: true },
    orderBy: { publishAt: "asc" },
    take: 20,
  });
  return rows.map((r) => ({ id: r.id, title: r.title, publishAt: (r.publishAt as Date).toISOString(), platform: r.platform, status: r.status }));
}
