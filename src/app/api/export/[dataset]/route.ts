import { NextResponse, type NextRequest } from "next/server";
import { assertUser, AuthError } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { handleRouteError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { isoDay } from "@/lib/format";
import { filtersToQuery, type RawParams } from "@/lib/filters";
import { exportContext } from "@/lib/export/context";
import { DATASETS, EXPORT_ROW_LIMIT } from "@/lib/export/datasets";
import { csvStream, xlsxStream } from "@/lib/export/writers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/export/<dataset>?<global filters>&format=csv|xlsx
 * Authenticated, permission-checked per dataset, tenant-scoped via the same rules as pages,
 * audited, row-capped and streamed.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ dataset: string }> }) {
  try {
    const { dataset } = await params;
    const def = Object.hasOwn(DATASETS, dataset) ? DATASETS[dataset] : undefined;
    if (!def) return NextResponse.json({ error: "UNKNOWN_DATASET" }, { status: 404 });
    const format = req.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

    const user = await assertUser(def.permission);
    const limited = rateLimit(`export:${user.id}`, 20, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } });
    }

    const sp: RawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const ctx = await exportContext(user, sp);
    // White label: a section hidden from a CLIENT user can't be exported either.
    if (user.role === "CLIENT" && ctx.clients.some((c) => c.hiddenSections.includes(def.section))) throw new AuthError("FORBIDDEN");

    await audit(user, {
      action: "export",
      entity: "Export",
      entityId: dataset,
      clientId: ctx.clientIds.length === 1 ? ctx.clientIds[0] : null,
      summary: `${dataset}.${format}`,
      diff: { dataset, format, query: filtersToQuery(sp), limit: EXPORT_ROW_LIMIT },
    });

    const columns = def.columns(ctx);
    const batches = def.rows(ctx);
    const labels = { yes: ctx.t("ui.yes"), no: ctx.t("ui.no") };
    const fileName = `${dataset}-${isoDay(new Date())}.${format}`;
    const headers = {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };

    if (format === "xlsx") {
      const body = await xlsxStream({ sheetName: dataset, columns, batches, locale: ctx.locale, labels });
      return new Response(body, { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    }
    return new Response(csvStream(columns, batches, labels), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  } catch (e) {
    return handleRouteError(e);
  }
}
