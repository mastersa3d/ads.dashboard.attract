import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { planFormData } from "@/lib/budget/form";
import { PAID_PLATFORMS } from "@/lib/budget/plan";
import { DemoBadge, PageHeader } from "@/components/ui/primitives";
import { PlanForm } from "@/components/budget/plan-form";

export const metadata = { title: "Edit budget plan" };

export default async function EditPlanPage({ params, searchParams }: { params: Promise<{ planId: string }>; searchParams: Promise<RawParams> }) {
  const [{ planId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await pageContext(sp, "budget:edit");
  const { t } = ctx;
  // Tenant scope: the plan must belong to one of the user's accessible clients.
  const plan = await db.budgetPlan.findFirst({ where: { id: planId, clientId: { in: ctx.clients.map((c) => c.id) } }, include: { lines: true } });
  if (!plan) notFound();
  const data = await planFormData(ctx, plan.clientId, plan);
  const client = ctx.clients.find((c) => c.id === plan.clientId)!;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t("budget.editPlan")}
        description={`${client.name} · ${plan.name}`}
        badges={client.isDemo ? <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} /> : undefined}
      />
      <PlanForm initial={data.initial} defaults={data.defaults} suggestions={data.suggestions} currencies={data.currencies} fx={ctx.fx} paidPlatforms={PAID_PLATFORMS} />
    </div>
  );
}
