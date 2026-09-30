import "server-only";
import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

/** Reject cross-site state-changing requests to route handlers (server actions do this already). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin navigations / non-browser clients authenticated by cookie only via GET
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (new URL(origin).host !== host) throw new AuthError("FORBIDDEN");
}

/** Uniform JSON error responses for route handlers. */
export function handleRouteError(e: unknown) {
  if (e instanceof AuthError) {
    const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : 404;
    return NextResponse.json({ error: e.code }, { status });
  }
  if (e && typeof e === "object" && "issues" in e) return NextResponse.json({ error: "VALIDATION", issues: (e as { issues: unknown }).issues }, { status: 400 });
  logger.error("route.error", { message: (e as Error)?.message });
  return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
}
