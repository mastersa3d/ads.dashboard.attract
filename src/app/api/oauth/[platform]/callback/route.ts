import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { accessibleClientIds } from "@/lib/tenant";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getConnector } from "@/lib/integrations/registry";
import { asConnectorError, connectorOf, linkAccounts, saveTokens } from "@/lib/integrations/service";
import { OAUTH_COOKIE, redirectUriFor, settingsRedirect, verifyState } from "@/lib/integrations/oauth-state";

export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/<connector>/callback?code=…&state=…  (TikTok returns `auth_code`)
 * Validates the signed state cookie (CSRF), checks it belongs to the logged-in user/org, exchanges
 * the code, encrypts and stores the tokens, records a SyncRun + AuditLog, then returns to Settings.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const sp = req.nextUrl.searchParams;
  const back = (p: Record<string, string>) => {
    const res = NextResponse.redirect(settingsRedirect(req.nextUrl.origin, p));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/oauth", maxAge: 0 });
    return res;
  };

  const state = verifyState(req.cookies.get(OAUTH_COOKIE)?.value, sp.get("state"));
  if (!state || state.k !== platform) return back({ oauthError: "STATE" });

  const user = await getCurrentUser();
  if (!user || user.id !== state.u || user.organizationId !== state.o || !can(user, "integrations:manage")) return back({ oauthError: "FORBIDDEN" });

  const integration = await db.integration.findFirst({ where: { id: state.i, organizationId: user.organizationId, clientId: state.c } });
  if (!integration) return back({ oauthError: "NOT_FOUND" });
  if (integration.clientId && !(await accessibleClientIds(user)).includes(integration.clientId)) return back({ oauthError: "NOT_FOUND" });

  const providerError = sp.get("error_description") ?? sp.get("error");
  if (providerError) {
    await audit(user, { action: "connect_failed", entity: "Integration", entityId: integration.id, clientId: integration.clientId, summary: providerError.slice(0, 200) });
    return back({ oauthError: providerError.slice(0, 200), integration: integration.id });
  }

  const connector = getConnector(platform);
  const code = sp.get("code") ?? sp.get("auth_code");
  if (!connector?.exchangeCode || connector.id !== connectorOf(integration).id || !code) return back({ oauthError: "UNSUPPORTED" });

  try {
    const token = await connector.exchangeCode(code, redirectUriFor(connector.id), state.v);
    let identity: string | undefined;
    try {
      const test = await connector.testConnection(token);
      identity = test.identity;
      if (!token.scopes?.length && test.scopes?.length) token.scopes = test.scopes;
    } catch (e) {
      logger.warn("oauth.post_connect_test_failed", { integrationId: integration.id, message: asConnectorError(e).message });
    }
    await saveTokens(integration.id, token, { kind: "connect", identity });

    // Convenience: when the login can see exactly one account and none is linked yet, link it.
    if (connector.listAccounts && integration.clientId) {
      try {
        const linked = await db.adAccount.count({ where: { integrationId: integration.id } });
        if (!linked) {
          const remote = await connector.listAccounts(token);
          if (remote.length === 1) await linkAccounts(integration.id, remote);
        }
      } catch (e) {
        logger.warn("oauth.auto_link_failed", { integrationId: integration.id, message: asConnectorError(e).message });
      }
    }
    await audit(user, { action: "connect", entity: "Integration", entityId: integration.id, clientId: integration.clientId, summary: `${connector.displayName} connected${identity ? ` (${identity})` : ""}` });
    return back({ connected: integration.id });
  } catch (e) {
    const err = asConnectorError(e);
    await db.syncRun.create({ data: { integrationId: integration.id, kind: "connect", status: "FAILED", finishedAt: new Date(), message: err.message.slice(0, 500) } });
    await db.integration.update({ where: { id: integration.id }, data: { lastError: err.message } });
    await audit(user, { action: "connect_failed", entity: "Integration", entityId: integration.id, clientId: integration.clientId, summary: err.message.slice(0, 200) });
    return back({ oauthError: err.message.slice(0, 200), integration: integration.id });
  }
}
