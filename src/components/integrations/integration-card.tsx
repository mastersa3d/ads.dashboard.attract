import { AlertTriangle, Clock, KeyRound, ShieldAlert } from "lucide-react";
import type { IntegrationStatus, Platform } from "@prisma/client";
import type { TFunction } from "@/lib/i18n/translate";
import { fmtDate, fmtDateTime, type Locale } from "@/lib/format";
import { mask } from "@/lib/crypto";
import { expiryState, missingScopes, STATUS_TONE } from "@/lib/integrations/status";
import type { Connector } from "@/lib/integrations/types";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, cx } from "@/components/ui/primitives";
import { IntegrationControls } from "./integration-controls";
import { EditIntegration } from "./edit-integration";
import Link from "next/link";

export type CardIntegration = {
  id: string;
  label: string;
  platform: Platform;
  status: IntegrationStatus;
  enabled: boolean;
  hasToken: boolean;
  tokenLast4: string | null;
  tokenExpiresAt: Date | null;
  scopesGranted: string[];
  scopesRequired: string[];
  lastSyncAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
  clientId: string | null;
  client: { name: string; isDemo: boolean } | null;
  accounts: { id: string; name: string; externalId: string }[];
};

type Labels = { source: string; updated: string; demo: string; demoHint: string };

/** One integration: status, last sync, token (masked), expiry warning, missing permissions, accounts, actions. */
export function IntegrationCard({
  i,
  connector,
  configured,
  canManage,
  canEditAccounts = false,
  clients = [],
  t,
  locale,
  rel,
  metaLabels,
}: {
  i: CardIntegration;
  canEditAccounts?: boolean;
  clients?: { id: string; name: string }[];
  connector: Connector;
  configured: boolean;
  canManage: boolean;
  t: TFunction;
  locale: Locale;
  rel: (d: Date | null | undefined) => string | null;
  metaLabels: Labels;
}) {
  const exp = expiryState(i.tokenExpiresAt);
  const missing = i.scopesGranted.length ? missingScopes(i.scopesRequired, i.scopesGranted) : [];
  const needsReconnect = i.status === "EXPIRED" || i.status === "PERMISSION_MISSING" || exp.state === "expired";
  const tone = STATUS_TONE[i.status];

  return (
    <Card className={cx(!i.enabled && "opacity-75")}>
      <CardHeader
        title={i.label}
        subtitle={`${connector.displayName} · ${i.client?.name ?? t("integrations.orgWide")}`}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {!i.enabled && <Badge>{t("integrations.disabled")}</Badge>}
            {connector.placeholder && <Badge tone="info">{t("integrations.placeholder")}</Badge>}
            {connector.authType === "none" && connector.platform === "GOOGLE_TRENDS" && <Badge tone="info">{t("integrations.manualOnly")}</Badge>}
            <Badge tone={tone}>{t(`integrationStatus.${i.status}`)}</Badge>
          </div>
        }
        meta={<DataMeta source={t("integrations.source.integrations")} updated={rel(i.updatedAt)} demo={i.client?.isDemo} labels={metaLabels} />}
      />
      <CardBody className="space-y-3">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">{t("integrations.lastSuccess")}</dt>
            <dd title={i.lastSuccessAt ? fmtDateTime(i.lastSuccessAt, locale) : undefined}>{i.lastSuccessAt ? rel(i.lastSuccessAt) : <span className="text-subtle">{t("integrations.never")}</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t("integrations.lastAttempt")}</dt>
            <dd>{i.lastSyncAt ? rel(i.lastSyncAt) : <span className="text-subtle">{t("integrations.never")}</span>}</dd>
          </div>
          {connector.authType !== "none" && (
            <>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted">
                  <KeyRound className="size-3" aria-hidden /> {t("integrations.token")}
                </dt>
                <dd className="num font-mono text-xs">{mask(i.tokenLast4)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted">
                  <Clock className="size-3" aria-hidden /> {t("integrations.expires")}
                </dt>
                <dd className={cx(exp.state === "expired" ? "text-bad" : exp.state === "soon" ? "text-warn" : "")}>
                  {exp.state === "none" ? (i.hasToken ? t("integrations.noExpiry") : "—") : fmtDate(i.tokenExpiresAt, locale)}
                  {exp.state === "soon" && <span className="ms-1 text-xs">({t("integrations.expiresIn", { days: exp.daysLeft ?? 0 })})</span>}
                </dd>
              </div>
            </>
          )}
        </dl>

        {i.hasToken && exp.state === "expired" && <Callout tone="bad">{t("integrations.expiredWarning")}</Callout>}
        {i.hasToken && exp.state === "soon" && <Callout tone="warning">{t("integrations.expiryWarning", { days: exp.daysLeft ?? 0 })}</Callout>}
        {i.lastError && (
          <Callout tone="bad" title={t("integrations.lastError")}>
            <span className="break-words">{i.lastError}</span>
          </Callout>
        )}
        {missing.length > 0 && (
          <Callout tone="warning" title={<span className="inline-flex items-center gap-1"><ShieldAlert className="size-3.5" aria-hidden /> {t("integrations.missingPermissions")}</span>}>
            <p className="text-xs">{t("integrations.missingHint")}</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {missing.map((s) => (
                <li key={s}>
                  <code className="rounded bg-surface px-1.5 py-0.5 text-[11px]">{s}</code>
                </li>
              ))}
            </ul>
          </Callout>
        )}

        {(connector.syncInsights || connector.listAccounts) && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">{t("integrations.accounts")}</p>
            {i.accounts.length ? (
              <ul className="flex flex-wrap gap-1">
                {i.accounts.map((a) => (
                  <li key={a.id}>
                    <Badge tone="neutral" title={a.externalId}>
                      {a.name}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-subtle">{t("integrations.noAccounts")}</p>
            )}
            {canEditAccounts && i.clientId && (
              <Link href={`/settings/integrations?tab=accounts&acc=${i.clientId}`} className="mt-1 inline-block text-xs text-brand hover:underline">
                {t("integrations.accounts.manage")}
              </Link>
            )}
          </div>
        )}

        {connector.limitations?.length ? (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none">{t("integrations.limitations")}</summary>
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
              {connector.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        ) : null}

        {canManage && connector.authType === "oauth2" && !configured && (
          <p className="flex items-start gap-1.5 text-xs text-warn">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {t("integrations.notConfigured")} — {t("integrations.notConfiguredHint", { vars: connector.envVars.join(", ") })}
            </span>
          </p>
        )}

        {canManage && (
          <EditIntegration
            id={i.id}
            label={i.label}
            clientId={i.clientId}
            orgWide={connector.capabilities.some((c) => c === "email" || c === "storage" || c === "calendar")}
            hasAccounts={i.accounts.length > 0}
            clients={clients}
          />
        )}
        {canManage && (
          <IntegrationControls
            id={i.id}
            connectorId={connector.id}
            oauth={connector.authType === "oauth2" && Boolean(connector.authorizeUrl)}
            configured={configured}
            manualToken={Boolean(connector.manualToken)}
            hasToken={i.hasToken}
            enabled={i.enabled}
            syncable={Boolean(connector.syncInsights) && !connector.placeholder}
            listable={Boolean(connector.listAccounts)}
            needsReconnect={needsReconnect}
          />
        )}
      </CardBody>
    </Card>
  );
}
