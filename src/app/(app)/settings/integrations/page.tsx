import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleSlash } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { fmtDateTime, fmtDate, fmtNumber } from "@/lib/format";
import { mask } from "@/lib/crypto";
import { CONNECTORS, isConfigured } from "@/lib/integrations/registry";
import { connectorOf } from "@/lib/integrations/service";
import { expiryState, missingScopes, STATUS_TONE } from "@/lib/integrations/status";
import { redirectUriFor } from "@/lib/integrations/oauth-state";
import { CORE_ENV, envReadiness } from "@/lib/integrations/env";
import { queueStats } from "@/lib/jobs/queue";
import { SYNC_INTERVAL_MIN } from "@/lib/jobs/scheduler";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, EmptyState, Grid, PageHeader, SimpleTable, Stat, Tabs, cx } from "@/components/ui/primitives";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { AddIntegrationForm } from "@/components/integrations/add-integration";
import { TokenUpdate } from "@/components/integrations/token-update";

export const metadata = { title: "Integrations" };

const TABS = ["integrations", "tokens", "sync"] as const;
type Tab = (typeof TABS)[number];
const OAUTH_ERRORS = ["STATE", "FORBIDDEN", "NOT_FOUND", "UNSUPPORTED", "NOT_CONFIGURED"];

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "integrations:view");
  const { t, locale, user } = ctx;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "integrations";
  const canManage = ctx.can("integrations:manage");

  // Tenant scope: this org's integrations for accessible clients + org-wide ones.
  const where = { organizationId: user.organizationId, OR: [{ clientId: { in: ctx.clientIds } }, { clientId: null }] };
  const integrations = await db.integration.findMany({
    where,
    include: { client: { select: { name: true, isDemo: true } }, accounts: { select: { id: true, name: true, externalId: true } } },
    orderBy: [{ client: { name: "asc" } }, { platform: "asc" }, { createdAt: "asc" }],
  });
  const isDemo = integrations.some((i) => i.client?.isDemo);
  const byStatus = integrations.reduce<Record<string, number>>((acc, i) => ((acc[i.status] = (acc[i.status] ?? 0) + 1), acc), {});

  const tabs = TABS.map((k) => ({ key: k, label: t(`integrations.tab.${k}`), href: `/settings/integrations${k === "integrations" ? "" : `?tab=${k}`}` }));
  const oauthError = typeof sp.oauthError === "string" ? sp.oauthError : null;
  const connected = typeof sp.connected === "string" ? sp.connected : null;

  return (
    <div className="space-y-5">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text no-print">
        <ArrowLeft className="size-4 flip-rtl" aria-hidden /> {t("integrations.backToSettings")}
      </Link>
      <PageHeader title={t("integrations.title")} description={t("integrations.description")} />
      <Tabs tabs={tabs} active={tab} />
      {connected && <Callout tone="good">{t("integrations.result.connected")}</Callout>}
      {oauthError && (
        <Callout tone="bad">
          {t("integrations.result.oauthError", { message: OAUTH_ERRORS.includes(oauthError) ? (oauthError === "NOT_CONFIGURED" ? t("integrations.notConfigured") : oauthError === "STATE" ? t("ui.error") : t("ui.accessDenied")) : oauthError })}
        </Callout>
      )}
      {!canManage && <Callout tone="info">{t("integrations.readOnly")}</Callout>}

      {tab === "integrations" && (
        <>
          <Grid cols={6}>
            {(["CONNECTED", "SYNCING", "SYNC_FAILED", "EXPIRED", "PERMISSION_MISSING", "DISCONNECTED"] as const).map((s) => (
              <Card key={s} className="p-3">
                <Stat label={<Badge tone={STATUS_TONE[s]}>{t(`integrationStatus.${s}`)}</Badge>} value={fmtNumber(byStatus[s] ?? 0, locale)} />
              </Card>
            ))}
          </Grid>
          {canManage && (
            <Card>
              <CardHeader title={t("integrations.add")} subtitle={t("integrations.addHint")} />
              <CardBody>
                <AddIntegrationForm
                  connectors={CONNECTORS.map((c) => ({ id: c.id, name: c.displayName, orgWide: c.capabilities.some((x) => x === "email" || x === "storage" || x === "calendar") }))}
                  clients={ctx.clients.map((c) => ({ id: c.id, name: c.name }))}
                />
              </CardBody>
            </Card>
          )}
          {integrations.length === 0 ? (
            <Card>
              <EmptyState title={t("integrations.none")} hint={t("integrations.noneHint")} />
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {integrations.map((i) => {
                const connector = connectorOf(i);
                return (
                  <IntegrationCard
                    key={i.id}
                    // Explicit pick: encrypted token columns never travel further than this line.
                    i={{
                      id: i.id,
                      label: i.label,
                      platform: i.platform,
                      status: i.status,
                      enabled: i.enabled,
                      hasToken: Boolean(i.accessTokenEnc || i.tokenLast4),
                      tokenLast4: i.tokenLast4,
                      tokenExpiresAt: i.tokenExpiresAt,
                      scopesGranted: i.scopesGranted,
                      scopesRequired: i.scopesRequired,
                      lastSyncAt: i.lastSyncAt,
                      lastSuccessAt: i.lastSuccessAt,
                      lastError: i.lastError,
                      updatedAt: i.updatedAt,
                      client: i.client,
                      accounts: i.accounts,
                    }}
                    connector={connector}
                    configured={isConfigured(connector)}
                    canManage={canManage}
                    t={t}
                    locale={locale}
                    rel={ctx.rel}
                    metaLabels={ctx.metaLabels}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "tokens" && (
        <Card>
          <CardHeader
            title={t("integrations.tokens.title")}
            subtitle={t("integrations.tokens.hint")}
            meta={<DataMeta source={t("integrations.source.integrations")} updated={ctx.rel(integrations.reduce<Date | null>((m, i) => (!m || i.updatedAt > m ? i.updatedAt : m), null))} demo={isDemo} labels={ctx.metaLabels} />}
          />
          <SimpleTable
            head={[t("integrations.col.integration"), t("integrations.tokens.auth"), t("integrations.token"), t("integrations.expires"), t("integrations.tokens.refreshable"), t("integrations.scopesGranted"), t("integrations.missingPermissions"), ...(canManage ? [t("ui.actions")] : [])]}
            empty={<EmptyState title={t("integrations.none")} />}
            rows={integrations.map((i) => {
              const c = connectorOf(i);
              const exp = expiryState(i.tokenExpiresAt);
              const missing = i.scopesGranted.length ? missingScopes(i.scopesRequired, i.scopesGranted) : [];
              return [
                <div key="n" className="min-w-40">
                  <p className="font-medium">{i.label}</p>
                  <p className="text-xs text-muted">{c.displayName} · {i.client?.name ?? t("integrations.orgWide")}</p>
                </div>,
                t(`integrations.authType.${c.authType}`),
                <span key="t" className="num font-mono text-xs">{c.authType === "none" ? "—" : mask(i.tokenLast4)}</span>,
                <span key="e" className={cx("whitespace-nowrap", exp.state === "expired" ? "text-bad" : exp.state === "soon" ? "text-warn" : "")}>
                  {exp.state === "none" ? (i.tokenLast4 ? t("integrations.noExpiry") : "—") : fmtDate(i.tokenExpiresAt, locale)}
                  {exp.state === "expired" && <Badge tone="bad" className="ms-1">{t("integrations.expiredOn")}</Badge>}
                  {exp.state === "soon" && <Badge tone="warning" className="ms-1">{t("integrations.expiresIn", { days: exp.daysLeft ?? 0 })}</Badge>}
                </span>,
                i.refreshTokenEnc || (c.refreshToken && c.platform === "META") ? t("ui.yes") : t("ui.no"),
                <span key="g" className="text-xs text-muted">{i.scopesGranted.length ? i.scopesGranted.join(", ") : "—"}</span>,
                missing.length ? <span key="m" className="text-xs text-warn">{missing.join(", ")}</span> : <span key="m" className="text-subtle">—</span>,
                ...(canManage ? [c.manualToken ? <TokenUpdate key="u" integrationId={i.id} /> : <span key="u" className="text-xs text-subtle">{c.authType === "oauth2" ? t("integrations.notManual") : "—"}</span>] : []),
              ];
            })}
          />
        </Card>
      )}

      {tab === "sync" && <SyncTab ctx={ctx} integrations={integrations} selected={typeof sp.integration === "string" ? sp.integration : null} isDemo={isDemo} />}
    </div>
  );
}

async function SyncTab({
  ctx,
  integrations,
  selected,
  isDemo,
}: {
  ctx: Awaited<ReturnType<typeof pageContext>>;
  integrations: { id: string; label: string; platform: string; syncCursor: unknown }[];
  selected: string | null;
  isDemo: boolean;
}) {
  const { t, locale, user } = ctx;
  const ids = integrations.map((i) => i.id);
  const chosen = selected && ids.includes(selected) ? selected : null;
  const [runs, jobs, stats] = await Promise.all([
    db.syncRun.findMany({ where: { integrationId: chosen ?? { in: ids } }, include: { integration: { select: { label: true } } }, orderBy: { startedAt: "desc" }, take: 100 }),
    db.job.findMany({ where: { OR: [{ organizationId: user.organizationId }, { organizationId: null }] }, orderBy: { updatedAt: "desc" }, take: 30 }),
    queueStats(),
  ]);
  const jobTone = { QUEUED: "info", RUNNING: "brand", SUCCEEDED: "good", FAILED: "bad" } as const;
  const lastRun = runs[0]?.startedAt ?? null;
  const lastJob = jobs[0]?.updatedAt ?? null;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={t("integrations.sync.schedule")} />
        <CardBody className="space-y-3 text-sm">
          <p>{t("integrations.sync.scheduleText", { min: SYNC_INTERVAL_MIN })}</p>
          <p className="text-xs text-muted">{t("integrations.sync.workerHint")}</p>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted">{t("integrations.sync.queue")}:</span>
            {(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const).map((s) => (
              <Badge key={s} tone={jobTone[s]}>
                {t(`integrations.jobStatus.${s}`)} <span className="num">{fmtNumber(stats[s] ?? 0, locale)}</span>
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={chosen ? t("integrations.sync.runsFor", { name: integrations.find((i) => i.id === chosen)!.label }) : t("integrations.sync.runs")}
          meta={<DataMeta source={t("integrations.source.syncRuns")} updated={ctx.rel(lastRun)} demo={isDemo} labels={ctx.metaLabels} />}
          actions={
            <nav className="flex flex-wrap gap-1" aria-label={t("integrations.sync.runs")}>
              <Link href="/settings/integrations?tab=sync" className={cx("rounded-md px-2 py-1 text-xs", !chosen ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2")}>
                {t("integrations.sync.allIntegrations")}
              </Link>
            </nav>
          }
        />
        <SimpleTable
          head={[t("integrations.col.started"), t("integrations.col.integration"), t("integrations.col.kind"), t("integrations.col.status"), t("integrations.col.duration"), t("integrations.col.rows"), t("integrations.col.message")]}
          empty={<EmptyState title={t("integrations.sync.noRuns")} />}
          rows={runs.map((r) => [
            <span key="s" className="num whitespace-nowrap text-xs">{fmtDateTime(r.startedAt, locale)}</span>,
            <Link key="i" href={`/settings/integrations?tab=sync&integration=${r.integrationId}`} className="text-brand hover:underline">
              {r.integration.label}
            </Link>,
            t(`integrations.kind.${r.kind}`),
            <Badge key="st" tone={jobTone[r.status]}>{t(`integrations.jobStatus.${r.status}`)}</Badge>,
            <span key="d" className="num text-xs">{r.finishedAt ? `${Math.max(0, Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000))}s` : "—"}</span>,
            <span key="n" className="num">{fmtNumber(r.rowsUpserted, locale)}</span>,
            <span key="m" className="block max-w-md text-xs break-words text-muted">{r.message ?? "—"}</span>,
          ])}
        />
      </Card>

      <Card>
        <CardHeader title={t("integrations.sync.jobs")} meta={<DataMeta source={t("integrations.source.jobs")} updated={ctx.rel(lastJob)} labels={ctx.metaLabels} />} />
        <SimpleTable
          head={[t("integrations.col.job"), t("integrations.col.status"), t("integrations.col.attempts"), t("integrations.col.runAt"), t("integrations.col.error")]}
          empty={<EmptyState title={t("integrations.sync.noJobs")} />}
          rows={jobs.map((j) => [
            <code key="t" className="text-xs">{j.type}</code>,
            <Badge key="s" tone={jobTone[j.status]}>{t(`integrations.jobStatus.${j.status}`)}</Badge>,
            <span key="a" className="num">{j.attempts}/{j.maxAttempts}</span>,
            <span key="r" className="num whitespace-nowrap text-xs">{fmtDateTime(j.runAt, locale)}</span>,
            <span key="e" className="block max-w-md text-xs break-words text-muted">{j.lastError ?? "—"}</span>,
          ])}
        />
      </Card>

      <Card>
        <CardHeader title={t("integrations.sync.readiness")} subtitle={t("integrations.sync.readinessHint")} />
        <CardBody className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold text-muted">{t("integrations.sync.core")}</p>
            <EnvList items={envReadiness(CORE_ENV)} t={t} />
          </div>
          <SimpleTable
            head={[t("integrations.connector"), t("integrations.col.status"), "ENV", t("integrations.sync.redirectUri"), t("integrations.limitations")]}
            rows={CONNECTORS.map((c) => {
              const ok = isConfigured(c);
              return [
                <div key="n" className="min-w-36">
                  <p className="font-medium">{c.displayName}</p>
                  <a href={c.docsUrl} target="_blank" rel="noreferrer noopener" className="text-xs text-brand hover:underline">
                    docs
                  </a>
                </div>,
                c.envVars.length ? (
                  <Badge key="s" tone={ok ? "good" : "neutral"}>{ok ? t("integrations.sync.envSet") : t("integrations.sync.envMissing")}</Badge>
                ) : (
                  <Badge key="s" tone="info">{t("integrations.manualOnly")}</Badge>
                ),
                <EnvList key="e" items={envReadiness(c.envVars)} t={t} />,
                c.authType === "oauth2" ? <code key="u" className="text-[11px] break-all">{redirectUriFor(c.id)}</code> : "—",
                <ul key="l" className="max-w-sm list-disc space-y-0.5 ps-4 text-xs text-muted">
                  {(c.limitations ?? []).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>,
              ];
            })}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("integrations.sync.mapping")} />
        <CardBody className="space-y-2">
          {CONNECTORS.map((c) => (
            <details key={c.id} className="rounded-lg border border-border p-3 text-sm">
              <summary className="cursor-pointer font-medium select-none">{c.displayName}</summary>
              <p className="mt-2 text-xs leading-relaxed text-muted" dir="ltr">
                {c.mapping}
              </p>
              <p className="mt-1 text-[11px] text-subtle" dir="ltr">
                {c.rateLimit.policy}
              </p>
            </details>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function EnvList({ items, t }: { items: { name: string; set: boolean }[]; t: (k: string) => string }) {
  if (!items.length) return <span className="text-subtle">—</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((e) => (
        <li key={e.name}>
          <Badge tone={e.set ? "good" : "neutral"} title={e.set ? t("integrations.sync.envSet") : t("integrations.sync.envMissing")}>
            {e.set ? <CheckCircle2 className="size-3" aria-hidden /> : <CircleSlash className="size-3" aria-hidden />}
            <code className="text-[11px]">{e.name}</code>
          </Badge>
        </li>
      ))}
    </ul>
  );
}
