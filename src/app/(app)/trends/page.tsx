import type { RawParams } from "@/lib/filters";
import { pageContext } from "@/lib/page";
import { Callout, DemoBadge, PageHeader, Tabs } from "@/components/ui/primitives";
import { ExportMenu } from "@/components/ui/export-menu";
import { ClientPicker } from "@/components/competitors/client-picker";
import { SignalsSection } from "./_sections/signals";
import { TrendIdeasSection } from "./_sections/ideas";
import { SourcesSection } from "./_sections/sources";

export const metadata = { title: "Trends & Opportunities" };

const TABS = ["signals", "ideas", "sources"] as const;
type Tab = (typeof TABS)[number];

export default async function TrendsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "trends:view");
  const { t } = ctx;
  const tabParam = typeof sp.tab === "string" ? sp.tab : "";
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : "signals";

  if (!ctx.client) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("trends.title")} description={t("trends.subtitle")} />
        <ClientPicker clients={ctx.clients.map((c) => ({ id: c.id, name: c.name, isDemo: c.isDemo }))} path="/trends" query={ctx.query} title={t("trends.picker.title")} hint={t("trends.picker.hint")} />
      </div>
    );
  }

  const base = `/trends?${ctx.query}${ctx.query ? "&" : ""}`;
  return (
    <div id="trends-root" className="space-y-6">
      <PageHeader
        title={t("trends.title")}
        description={`${ctx.client.name} · ${t("trends.subtitle")}`}
        badges={ctx.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
        actions={<ExportMenu targetId="trends-root" fileName={`trends-${tab}`} />}
      />
      {ctx.isDemo && <Callout tone="demo">{t("trends.demoBanner")}</Callout>}
      <Tabs active={tab} tabs={TABS.map((k) => ({ key: k, label: t(`trends.tab.${k}`), href: `${base}tab=${k}` }))} />
      {tab === "signals" && <SignalsSection ctx={ctx} />}
      {tab === "ideas" && <TrendIdeasSection ctx={ctx} sp={sp} base={base} />}
      {tab === "sources" && <SourcesSection ctx={ctx} />}
    </div>
  );
}
