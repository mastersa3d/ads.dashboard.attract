import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/reset-password", "/invite", "/two-factor", "/r/", "/legal", "/api/health", "/api/oauth", "/api/webhooks", "/api/public", "/api/cron"];
const INDEXABLE = ["/login", "/legal"];

/**
 * Edge gate: only checks that a session cookie exists (cheap). Real validation, RBAC and
 * tenant scoping happen server-side in requireUser()/assertUser() on every request.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const hasSession = Boolean(req.cookies.get("mimd_session")?.value);

  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/dashboard" ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : "";
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  if (!INDEXABLE.some((p) => pathname.startsWith(p))) {
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
