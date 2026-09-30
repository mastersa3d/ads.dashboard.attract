import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { planFormData } from "@/lib/budget/form";
import { PAID_PLATFORMS } from "@/lib/budget/plan";
import { DemoBadge, PageHeader } from "@/components/ui/primitives";
import { ClientPicker } from "@/components/strategy/client-picker";
import { PlanForm } from "@/components/budget/plan-form";

export const metadata = { title: "New budget plan" };

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "budget:edit");
  const { t, client } = ctx;
  if (!client) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("budget.newPlan")} description={t("budget.form.description")} />
        <ClientPicker path="/budget/new" sp={sp} clients={ctx.clients} title={t("budget.pickClient")} hint={t("budget.pickClientHint")} demoLabel={t("ui.demoData")} />
      </div>
    );
  }
  const data = await planFormData(ctx, client.id);
  return (
    <div className="space-y-5">
      <PageHeader
        title={t("budget.newPlan")}
        description={`${client.name} · ${t("budget.form.description")}`}
        badges={client.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
      />
      <PlanForm initial={data.initial} defaults={data.defaults} suggestions={data.suggestions} currencies={data.currencies} fx={ctx.fx} paidPlatforms={PAID_PLATFORMS} />
    </div>
  );
}
