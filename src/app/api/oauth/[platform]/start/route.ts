import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { accessibleClientIds } from "@/lib/tenant";
import { can } from "@/lib/rbac";
import { getConnector, isConfigured } from "@/lib/integrations/registry";
import { connectorOf } from "@/lib/integrations/service";
import { newNonce, OAUTH_COOKIE, OAUTH_TTL_MS, pkcePair, redirectUriFor, settingsRedirect, signState } from "@/lib/integrations/oauth-state";

export const dynamic = "force-dynamic";

const settingsUrl = (req: NextRequest, params: Record<string, string>) => settingsRedirect(req.nextUrl.origin, params);

/**
 * GET /api/oauth/<connector>/start?integration=<id>
 * Requires integrations:manage. Binds the flow to org + client + integration + user in a signed,
 * httpOnly cookie (10 min) and redirects to the platform's official consent screen.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!can(user, "integrations:manage")) return NextResponse.redirect(settingsUrl(req, { oauthError: "FORBIDDEN" }));

  const integrationId = req.nextUrl.searchParams.get("integration") ?? "";
  const integration = await db.integration.findFirst({ where: { id: integrationId, organizationId: user.organizationId } });
  if (!integration) return NextResponse.redirect(settingsUrl(req, { oauthError: "NOT_FOUND" }));
  if (integration.clientId && !(await accessibleClientIds(user)).includes(integration.clientId)) return NextResponse.redirect(settingsUrl(req, { oauthError: "NOT_FOUND" }));

  const connector = getConnector(platform);
  if (!connector || connector.id !== connectorOf(integration).id || !connector.authorizeUrl) return NextResponse.redirect(settingsUrl(req, { oauthError: "UNSUPPORTED" }));
  if (!isConfigured(connector)) return NextResponse.redirect(settingsUrl(req, { oauthError: "NOT_CONFIGURED", integration: integration.id }));

  const nonce = newNonce();
  const pkce = connector.pkce ? pkcePair() : null;
  const signed = signState({ n: nonce, o: user.organizationId, c: integration.clientId, i: integration.id, u: user.id, k: connector.id, v: pkce?.verifier, e: Date.now() + OAUTH_TTL_MS });

  let target: string;
  try {
    target = connector.authorizeUrl(nonce, redirectUriFor(connector.id), pkce?.challenge);
  } catch {
    return NextResponse.redirect(settingsUrl(req, { oauthError: "NOT_CONFIGURED", integration: integration.id }));
  }
  const res = NextResponse.redirect(target);
  res.cookies.set(OAUTH_COOKIE, signed, {
    httpOnly: true,
    secure: process.env.APP_URL ? process.env.APP_URL.startsWith("https://") : process.env.NODE_ENV === "production",
    sameSite: "lax", // must survive the top-level redirect back from the provider
    path: "/api/oauth",
    maxAge: OAUTH_TTL_MS / 1000,
  });
  return res;
}
