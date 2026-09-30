import type { RawParams } from "@/lib/filters";
import { pageContext } from "@/lib/page";
import { DemoBadge, PageHeader, Callout, Tabs } from "@/components/ui/primitives";
import { ExportMenu } from "@/components/ui/export-menu";
import { ClientPicker } from "@/components/competitors/client-picker";
import { OverviewSection } from "./_sections/overview";
import { AdsSection } from "./_sections/ads";
import { IdeasSection } from "./_sections/ideas";
import { SeasonalSection } from "./_sections/seasonal";

export const metadata = { title: "Competitor Intelligence" };

const TABS = ["overview", "ads", "ideas", "seasonal"] as const;
type Tab = (typeof TABS)[number];

export default async function CompetitorsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "competitors:view");
  const { t } = ctx;
  const tabParam = typeof sp.tab === "string" ? sp.tab : "";
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : "overview";

  if (!ctx.client) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("competitors.title")} description={t("competitors.subtitle")} />
        <ClientPicker
          clients={ctx.clients.map((c) => ({ id: c.id, name: c.name, isDemo: c.isDemo }))}
          path="/competitors"
          query={ctx.query}
          title={t("competitors.picker.title")}
          hint={t("competitors.picker.hint")}
        />
      </div>
    );
  }

  const base = `/competitors?${ctx.query}${ctx.query ? "&" : ""}`;
  return (
    <div id="competitors-root" className="space-y-6">
      <PageHeader
        title={t("competitors.title")}
        description={`${ctx.client.name} · ${t("competitors.subtitle")}`}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={<ExportMenu targetId="competitors-root" fileName={`competitors-${tab}`} />}
      />
      {ctx.isDemo && <Callout tone="demo">{t("competitors.demoBanner")}</Callout>}
      <Tabs active={tab} tabs={TABS.map((k) => ({ key: k, label: t(`competitors.tab.${k}`), href: `${base}tab=${k}` }))} />
      {tab === "overview" && <OverviewSection ctx={ctx} />}
      {tab === "ads" && <AdsSection ctx={ctx} />}
      {tab === "ideas" && <IdeasSection ctx={ctx} />}
      {tab === "seasonal" && <SeasonalSection ctx={ctx} sp={sp} base={base} />}
    </div>
  );
}
