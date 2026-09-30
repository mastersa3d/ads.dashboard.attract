import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { Callout, PageHeader, cx } from "@/components/ui/primitives";
import { BrandingTab, CompanyTab, CurrencyTab, GeneralTab, TimezoneTab } from "@/components/settings/org-tabs";
import { NotificationsTab } from "@/components/settings/notifications-tab";
import { SecurityTab } from "@/components/settings/security-tab";
import { BackupsTab, LinkTab } from "@/components/settings/info-tabs";

export const metadata = { title: "Settings" };

const ORG_TABS = ["general", "company", "branding", "currency", "timezone"] as const;
const PERSONAL_TABS = ["notifications", "security"] as const;
const ADMIN_TABS = ["benchmarks", "audit", "backups"] as const;
/** Owned by the integrations area (/settings/integrations). */
const EXTERNAL_TABS = [
  { key: "integrations", href: "/settings/integrations" },
  { key: "tokens", href: "/settings/integrations?tab=tokens" },
  { key: "sync", href: "/settings/integrations?tab=sync" },
] as const;
type Tab = (typeof ORG_TABS)[number] | (typeof PERSONAL_TABS)[number] | (typeof ADMIN_TABS)[number];

/**
 * Settings. Organisation tabs need settings:view (changes need settings:manage — Super Admin);
 * the personal tabs (notification preferences, security) are available to every signed-in user.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp);
  const { t } = ctx;
  const canView = ctx.can("settings:view");
  const canManage = ctx.can("settings:manage");
  // Legacy links (e.g. alert emails) used /settings?tab=integrations.
  const legacy = EXTERNAL_TABS.find((x) => x.key === sp.tab);

  const available: Tab[] = [...(canView ? ORG_TABS : []), ...PERSONAL_TABS, ...(canView ? ADMIN_TABS : [])];
  const tab: Tab = available.includes(sp.tab as Tab) ? (sp.tab as Tab) : available[0];
  const showExternal = ctx.can("integrations:view");

  const groups: { label: string; items: { key: string; href: string; external?: boolean }[] }[] = [
    ...(canView ? [{ label: t("settings.group.org"), items: ORG_TABS.map((k) => ({ key: k, href: `/settings?tab=${k}` })) }] : []),
    ...(showExternal ? [{ label: t("settings.group.data"), items: EXTERNAL_TABS.map((x) => ({ ...x, external: true })) }] : []),
    { label: t("settings.group.personal"), items: PERSONAL_TABS.map((k) => ({ key: k, href: `/settings?tab=${k}` })) },
    ...(canView ? [{ label: t("settings.group.admin"), items: ADMIN_TABS.map((k) => ({ key: k, href: `/settings?tab=${k}` })) }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />
      {legacy && showExternal && (
        <Callout tone="info">
          <Link href={legacy.href} className="text-brand underline">
            {t(`settings.tab.${legacy.key}`)}
          </Link>
        </Callout>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t("settings.title")} className="min-w-0 no-print">
          <div className="flex gap-4 overflow-x-auto pb-1 lg:flex-col lg:gap-5">
            {groups.map((g) => (
              <div key={g.label} className="shrink-0">
                <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">{g.label}</p>
                <ul className="flex gap-1 lg:flex-col">
                  {g.items.map((i) => (
                    <li key={i.key}>
                      <Link
                        href={i.href}
                        aria-current={!i.external && i.key === tab ? "page" : undefined}
                        className={cx(
                          "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm whitespace-nowrap",
                          !i.external && i.key === tab ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2 hover:text-text",
                        )}
                      >
                        {t(`settings.tab.${i.key}`)}
                        {i.external && <ExternalLink className="size-3 opacity-60 flip-rtl" aria-hidden />}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0 space-y-4">
          {canView && !canManage && ORG_TABS.includes(tab as (typeof ORG_TABS)[number]) && <Callout tone="info">{t("settings.readOnly")}</Callout>}
          {tab === "general" && <GeneralTab ctx={ctx} canManage={canManage} />}
          {tab === "company" && <CompanyTab ctx={ctx} canManage={canManage} />}
          {tab === "branding" && <BrandingTab ctx={ctx} canManage={canManage} />}
          {tab === "currency" && <CurrencyTab ctx={ctx} canManage={canManage} />}
          {tab === "timezone" && <TimezoneTab ctx={ctx} canManage={canManage} />}
          {tab === "notifications" && <NotificationsTab ctx={ctx} />}
          {tab === "security" && <SecurityTab ctx={ctx} />}
          {tab === "benchmarks" && <LinkTab ctx={ctx} kind="benchmarks" />}
          {tab === "audit" && <LinkTab ctx={ctx} kind="audit" />}
          {tab === "backups" && <BackupsTab ctx={ctx} />}
        </div>
      </div>
    </div>
  );
}
