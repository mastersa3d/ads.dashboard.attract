import "server-only";
import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { isoDay, toNum } from "@/lib/format";
import type { PageContext } from "@/lib/page";
import type { PlanFormDefaults, PlanFormValues } from "@/components/budget/plan-form";
import { periodEnd, type CostAssumption } from "./allocation";
import { planningDefaults } from "./defaults";
import { readAssumptions, type PlanWithLinesLite } from "./plan";

/** Everything the plan form needs: initial values (new or existing plan) and planning defaults. */
export async function planFormData(ctx: PageContext, clientId: string, plan?: PlanWithLinesLite | null) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, name: true, currency: true, country: true, industry: true, products: true, audiences: true, branches: true } });
  const currency = plan?.currency ?? client.currency;
  const d = await planningDefaults({ clientId, organizationId: ctx.user.organizationId, orgCurrency: ctx.org.currency, currency, fx: ctx.fx, country: client.country, industry: client.industry });
  const campaignCountries = await db.campaign.findMany({ where: { clientId, country: { not: null } }, select: { country: true }, distinct: ["country"] });

  let initial: PlanFormValues;
  if (plan) {
    const a = readAssumptions(plan.assumptions);
    const platforms = a.platforms.length ? a.platforms : ([...new Set(plan.lines.map((l) => l.platform).filter(Boolean))] as Platform[]);
    const costs: Partial<Record<Platform, CostAssumption>> = {};
    for (const p of platforms) costs[p] = a.costs[p] ? { ...{ cpm: null, cpc: null, cpl: null, cvr: null, aov: null }, ...a.costs[p] } : (d.costs[p] ?? { cpm: null, cpc: null, cpl: null, cvr: null, aov: null });
    initial = {
      id: plan.id,
      clientId,
      name: plan.name,
      period: plan.period,
      scenario: plan.scenario,
      startDate: isoDay(plan.startDate),
      endDate: isoDay(plan.endDate),
      totalBudget: toNum(plan.totalBudget),
      currency: plan.currency,
      objective: plan.objective,
      platforms,
      products: a.products,
      audiences: a.audiences,
      regions: a.regions,
      campaignIds: a.campaignIds.length ? a.campaignIds : plan.lines.map((l) => l.campaignId).filter((x): x is string => Boolean(x)),
      costs,
      weights: a.weights,
      platformShares: a.platformShares,
      plannedContent: plan.plannedContent,
      notes: a.notes ?? "",
    };
  } else {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const monthly = Object.values(d.history).reduce((s, h) => s + (h?.spend ?? 0), 0) / 3;
    initial = {
      clientId,
      name: "",
      period: "MONTHLY",
      scenario: "BALANCED",
      startDate: isoDay(start),
      endDate: isoDay(periodEnd(start, "MONTHLY")),
      totalBudget: monthly > 0 ? Math.round(monthly / 100) * 100 : 0,
      currency,
      objective: null,
      platforms: d.platforms,
      products: [],
      audiences: [],
      regions: [],
      campaignIds: d.campaigns.filter((c) => c.status === "ACTIVE").map((c) => c.id),
      costs: Object.fromEntries(d.platforms.map((p) => [p, d.costs[p] ?? { cpm: null, cpc: null, cpl: null, cvr: null, aov: null }])),
      weights: null,
      platformShares: null,
      plannedContent: 0,
      notes: "",
    };
  }

  const defaults: PlanFormDefaults = { ...d, historyFrom: isoDay(d.historyFrom), historyTo: isoDay(d.historyTo) };
  return {
    client,
    initial,
    defaults,
    suggestions: { products: client.products, audiences: client.audiences, regions: [...new Set([...client.branches, ...campaignCountries.map((c) => c.country!).filter(Boolean)])] },
    currencies: [...new Set([currency, client.currency, ctx.org.currency, ...Object.keys(ctx.fx.rates)])],
  };
}
