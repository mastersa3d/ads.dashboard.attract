import "server-only";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

/**
 * Search Console adapter (official Search Analytics API) — only through a connected Integration
 * of the client. Compares the last 28 days with the 28 days before to find rising queries and
 * recurring questions. Search Console data lags ~3 days, so windows end 3 days ago.
 */

export type ScSignal = { keyword: string; kind: "SEARCH" | "RISING" | "QUESTION"; growthPct: number | null; volumeIndex: number; impressions: number; clicks: number };
export type ScStatus = { state: "CONNECTED"; integrationId: string; site: string; lastSyncAt: Date | null } | { state: "NOT_CONNECTED" | "EXPIRED" | "NO_SITE" };
export type ScResult = { ok: true; signals: ScSignal[]; site: string; range: { from: string; to: string } } | { ok: false; reason: "NOT_CONNECTED" | "EXPIRED" | "NO_SITE" | "PERMISSION" | "FAILED" };

const QUESTION_RE = /^(how|what|why|when|where|which|who|can|is|are|do|does|should|كيف|ما|ماذا|لماذا|متى|أين|هل|كم)\s/i;
const DAY = 86_400_000;

export async function searchConsoleStatus(clientId: string): Promise<ScStatus> {
  const integ = await db.integration.findFirst({
    where: { clientId, platform: "SEARCH_CONSOLE", enabled: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, status: true, accessTokenEnc: true, tokenExpiresAt: true, externalAccountId: true, lastSyncAt: true },
  });
  if (!integ || !integ.accessTokenEnc || integ.status === "DISCONNECTED") return { state: "NOT_CONNECTED" };
  if (integ.status === "EXPIRED" || (integ.tokenExpiresAt && integ.tokenExpiresAt < new Date())) return { state: "EXPIRED" };
  if (!integ.externalAccountId) return { state: "NO_SITE" };
  return { state: "CONNECTED", integrationId: integ.id, site: integ.externalAccountId, lastSyncAt: integ.lastSyncAt };
}

type Row = { keys: string[]; clicks: number; impressions: number };

async function query(site: string, token: string, from: string, to: string): Promise<Row[] | { error: number }> {
  const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: from, endDate: to, dimensions: ["query"], rowLimit: 500, dataState: "final" }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { error: res.status };
  const json = (await res.json()) as { rows?: Row[] };
  return json.rows ?? [];
}

export async function fetchSearchConsoleSignals(clientId: string, now = new Date()): Promise<ScResult> {
  const status = await searchConsoleStatus(clientId);
  if (status.state !== "CONNECTED") return { ok: false, reason: status.state };
  const integ = await db.integration.findUniqueOrThrow({ where: { id: status.integrationId }, select: { accessTokenEnc: true } });
  const token = decrypt(integ.accessTokenEnc!);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(now.getTime() - 3 * DAY);
  const from = new Date(end.getTime() - 27 * DAY);
  const prevEnd = new Date(from.getTime() - DAY);
  const prevFrom = new Date(prevEnd.getTime() - 27 * DAY);
  try {
    const [cur, prev] = await Promise.all([query(status.site, token, iso(from), iso(end)), query(status.site, token, iso(prevFrom), iso(prevEnd))]);
    for (const r of [cur, prev]) {
      if (!Array.isArray(r)) {
        logger.warn("search_console.error", { status: r.error });
        return { ok: false, reason: r.error === 401 ? "EXPIRED" : r.error === 403 ? "PERMISSION" : "FAILED" };
      }
    }
    const prevMap = new Map((prev as Row[]).map((r) => [r.keys[0], r.impressions]));
    const rows = cur as Row[];
    const max = Math.max(1, ...rows.map((r) => r.impressions));
    const signals: ScSignal[] = rows.map((r) => {
      const keyword = r.keys[0];
      const before = prevMap.get(keyword);
      const growth = before && before > 0 ? r.impressions / before - 1 : null;
      const kind: ScSignal["kind"] = QUESTION_RE.test(keyword) || keyword.includes("?") || keyword.includes("؟") ? "QUESTION" : growth != null && growth >= 0.3 ? "RISING" : "SEARCH";
      return { keyword, kind, growthPct: growth == null ? null : Math.round(growth * 1000) / 1000, volumeIndex: Math.max(1, Math.round((r.impressions / max) * 100)), impressions: r.impressions, clicks: r.clicks };
    });
    // Keep the most useful: all questions & risers, plus the top queries by impressions.
    const top = signals.filter((s) => s.kind === "SEARCH").sort((a, b) => b.impressions - a.impressions).slice(0, 40);
    const rest = signals.filter((s) => s.kind !== "SEARCH").sort((a, b) => b.impressions - a.impressions).slice(0, 60);
    return { ok: true, signals: [...rest, ...top], site: status.site, range: { from: iso(from), to: iso(end) } };
  } catch (e) {
    logger.error("search_console.network", { message: (e as Error).message });
    return { ok: false, reason: "FAILED" };
  }
}
