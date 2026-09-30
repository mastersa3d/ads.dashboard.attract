import Link from "next/link";
import { Check, ArrowRight, Plug, Wallet, PartyPopper } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext, type PageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { NAV, NAV_LABEL } from "@/components/layout/nav";
import { Callout, Card, CardBody, CardHeader, LinkButton, PageHeader, cx } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { ActionButton } from "@/components/admin/action-button";
import { ClientBasicsFields } from "@/components/clients/client-fields";
import { CompanyFields } from "@/components/settings/org-tabs";
import { InviteForm } from "@/components/users/invite-form";
import { ONBOARDING_STEPS, nextOnboardingStep, orgSettings, type OnboardingStep } from "@/components/settings/org-settings";
import { createClient } from "@/app/actions/clients";
import { completeOnboardingStep, updateCompany } from "@/app/actions/settings";

export const metadata = { title: "Onboarding" };

/**
 * Setup wizard for Super Admins (resumable: progress lives in Organization.settings.onboarding).
 * Every other role — including CLIENT users arriving from an invitation — gets a short tour.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp);
  if (!ctx.can("settings:manage")) return <Tour ctx={ctx} />;

  const { t } = ctx;
  const settings = orgSettings(ctx.org.settings);
  const done = new Set(settings.onboarding?.completed ?? []);
  const requested = ONBOARDING_STEPS.find((s) => s === sp.step);
  const step: OnboardingStep = requested ?? nextOnboardingStep(settings);
  const idx = ONBOARDING_STEPS.indexOf(step);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title={t("onboarding.title")} description={t("onboarding.subtitle")} />
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label={t("onboarding.progress")}>
        {ONBOARDING_STEPS.map((s, i) => {
          const complete = done.has(s);
          const current = s === step;
          return (
            <li key={s}>
              <Link
                href={`/onboarding?step=${s}`}
                aria-current={current ? "step" : undefined}
                className={cx(
                  "flex h-full flex-col gap-1 rounded-lg border p-2 text-xs transition",
                  current ? "border-brand bg-brand-soft text-brand" : complete ? "border-good/40 text-text" : "border-border text-muted hover:border-brand/40",
                )}
              >
                <span className={cx("grid size-6 place-items-center rounded-full text-[11px] font-semibold", complete ? "bg-good text-white" : current ? "bg-brand text-brand-fg" : "bg-surface-2")}>
                  {complete ? <Check className="size-3.5" aria-hidden /> : <span className="num">{i + 1}</span>}
                </span>
                <span className="font-medium">{t(`onboarding.step.${s}`)}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      <Step ctx={ctx} step={step} />
      {step !== "done" && idx > 0 && (
        <p className="text-xs text-subtle">
          <Link href={`/onboarding?step=${ONBOARDING_STEPS[idx - 1]}`} className="hover:text-text">
            {t("ui.back")}
          </Link>
        </p>
      )}
    </div>
  );
}

function Continue({ ctx, step, label }: { ctx: PageContext; step: OnboardingStep; label?: string }) {
  return (
    <ActionButton action={completeOnboardingStep.bind(null, step)} variant="primary" size="md">
      {label ?? ctx.t("onboarding.continue")} <ArrowRight className="size-4 flip-rtl" aria-hidden />
    </ActionButton>
  );
}

async function Step({ ctx, step }: { ctx: PageContext; step: OnboardingStep }) {
  const { t, locale, user } = ctx;
  const head = <CardHeader title={t(`onboarding.step.${step}`)} subtitle={t(`onboarding.hint.${step}`)} />;

  if (step === "company") {
    return (
      <Card>
        {head}
        <CardBody>
          <ActionForm action={updateCompany} submitLabel={t("onboarding.saveContinue")}>
            <input type="hidden" name="onboarding" value="company" />
            <CompanyFields ctx={ctx} withRegional />
          </ActionForm>
        </CardBody>
      </Card>
    );
  }

  if (step === "client") {
    const [count, managers] = await Promise.all([
      db.client.count({ where: { organizationId: user.organizationId, archived: false, isDemo: false } }),
      db.user.findMany({ where: { organizationId: user.organizationId, active: true, role: { in: ["SUPER_ADMIN", "COMPANY_MANAGER", "MARKETING_TEAM"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return (
      <Card>
        {head}
        <CardBody className="space-y-4">
          {count > 0 && (
            <Callout tone="info" title={t("onboarding.haveClients", { n: count })}>
              <div className="mt-2">
                <Continue ctx={ctx} step="client" label={t("onboarding.skipStep")} />
              </div>
            </Callout>
          )}
          <ActionForm action={createClient} submitLabel={t("onboarding.createContinue")}>
            <input type="hidden" name="onboarding" value="client" />
            <input type="hidden" name="next" value="/onboarding?step=integrations" />
            <ClientBasicsFields t={t} locale={locale} managers={managers} withManager={false} d={{ currency: ctx.org.currency, timezone: ctx.org.timezone }} />
          </ActionForm>
        </CardBody>
      </Card>
    );
  }

  if (step === "integrations") {
    return (
      <Card>
        {head}
        <CardBody className="space-y-4">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {["META", "GOOGLE_ADS", "TIKTOK", "LINKEDIN", "GA4", "SEARCH_CONSOLE"].map((p) => (
              <li key={p} className="flex items-center gap-2 rounded-lg border border-border p-2">
                <Plug className="size-4 text-subtle" aria-hidden /> {t(`platform.${p}`)}
              </li>
            ))}
          </ul>
          <Callout tone="info">{t("onboarding.integrationsNote")}</Callout>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/settings/integrations">
              <Plug className="size-4" aria-hidden /> {t("onboarding.openIntegrations")}
            </LinkButton>
            <Continue ctx={ctx} step="integrations" />
          </div>
        </CardBody>
      </Card>
    );
  }

  if (step === "team") {
    const clients = await db.client.findMany({ where: { organizationId: user.organizationId, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    return (
      <Card>
        {head}
        <CardBody className="space-y-4">
          <InviteForm t={t} clients={clients} actorRole={user.role} />
          <div className="border-t border-border pt-4">
            <Continue ctx={ctx} step="team" />
          </div>
        </CardBody>
      </Card>
    );
  }

  if (step === "budget") {
    return (
      <Card>
        {head}
        <CardBody className="space-y-4">
          <p className="text-sm text-muted">{t("onboarding.budgetBody")}</p>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/budget">
              <Wallet className="size-4" aria-hidden /> {t("onboarding.openBudget")}
            </LinkButton>
            <Continue ctx={ctx} step="budget" />
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-good-soft text-good">
          <PartyPopper className="size-7" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold">{t("onboarding.doneTitle")}</h2>
        <p className="max-w-md text-sm text-muted">{t("onboarding.doneBody")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Continue ctx={ctx} step="done" label={t("onboarding.goDashboard")} />
          <LinkButton href="/help">{t("onboarding.openHelp")}</LinkButton>
        </div>
      </CardBody>
    </Card>
  );
}

/** Role-aware short tour: highlights the sections this user can actually open. */
function Tour({ ctx }: { ctx: PageContext }) {
  const { t, user } = ctx;
  const isClient = user.role === "CLIENT";
  const hidden = new Set(isClient ? ctx.clients.flatMap((c) => c.hiddenSections) : []);
  const wanted = isClient ? ["/dashboard", "/approvals", "/calendar", "/reports", "/notifications", "/help"] : ["/dashboard", "/clients", "/calendar", "/approvals", "/tasks", "/reports", "/notifications", "/help"];
  const items = NAV.flatMap((g) => g.items).filter((i) => wanted.includes(i.href) && user.perms.has(i.permission) && !hidden.has(i.section));
  const soleClient = isClient && ctx.clients.length === 1 ? ctx.clients[0] : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={soleClient ? t("onboarding.tourTitleClient", { client: soleClient.name }) : t("onboarding.tourTitle", { name: user.name.split(" ")[0] })}
        description={isClient ? t("onboarding.tourSubtitleClient") : t("onboarding.tourSubtitleTeam")}
      />
      {soleClient?.isDemo && <Callout tone="demo">{t("ui.demoDataHint")}</Callout>}
      <ol className="space-y-3">
        {items.map((i, n) => (
          <li key={i.href}>
            <Card>
              <CardBody className="flex items-start gap-3">
                <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{n + 1}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{t(NAV_LABEL[i.href])}</h2>
                  <p className="mt-0.5 text-sm text-muted">{t(`onboarding.tour.${i.section}`)}</p>
                </div>
                <LinkButton href={i.href} size="sm">
                  {t("ui.view")}
                </LinkButton>
              </CardBody>
            </Card>
          </li>
        ))}
      </ol>
      <Callout tone="info" title={t("onboarding.honestyTitle")}>
        {t("onboarding.honestyBody")}
      </Callout>
      <div className="flex flex-wrap gap-2">
        <LinkButton href="/dashboard" variant="primary">
          {t("onboarding.goDashboard")} <ArrowRight className="size-4 flip-rtl" aria-hidden />
        </LinkButton>
        <LinkButton href="/settings?tab=security">{t("onboarding.secureAccount")}</LinkButton>
      </div>
    </div>
  );
}
