"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, BudgetPeriod, BudgetScenario, Objective, Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, AuthError, type CurrentUser } from "@/lib/auth/session";
import { assertClientAccess, accessibleClientIds } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { getI18n } from "@/lib/i18n/server";
import { fmtMoney, toNum } from "@/lib/format";
import { fxFromSettings } from "@/lib/fx";
import { allocate, COST_KEYS, type CostAssumption, type CostSource } from "@/lib/budget/allocation";
import { planningDefaults } from "@/lib/budget/defaults";
import { costSchema, lineLabel, weightsSchema, type PlanAssumptions } from "@/lib/budget/plan";

export type BudgetActionResult = { ok: true; id?: string } | { ok: false; error: string };

class BudgetError extends Error {}
function fail(e: unknown): BudgetActionResult {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  if (e instanceof z.ZodError) return { ok: false, error: "VALIDATION" };
  if (e instanceof BudgetError) return { ok: false, error: e.message };
  throw e;
}

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((s) => new Date(s + "T00:00:00.000Z"));
const tags = z.array(z.string().trim().min(1).max(120)).max(50);

const planSchema = z
  .object({
    id: z.string().optional(),
    clientId: z.string().min(1),
    name: z.string().trim().min(1).max(160),
    period: z.enum(BudgetPeriod),
    scenario: z.enum(BudgetScenario),
    startDate: day,
    endDate: day,
    totalBudget: z.number().finite().positive().max(1e12),
    currency: z.string().regex(/^[A-Z]{3}$/),
    objective: z.enum(Objective).nullable(),
    platforms: z.array(z.enum(Platform)).max(10),
    products: tags,
    audiences: tags,
    regions: tags,
    campaignIds: z.array(z.string()).max(200),
    costs: z.record(z.string(), costSchema),
    weights: weightsSchema.nullable(),
    platformShares: z.record(z.string(), z.number().min(0).max(1)).nullable(),
    plannedContent: z.number().int().min(0).max(10000),
    notes: z.string().max(4000).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, { message: "END_BEFORE_START", path: ["endDate"] });

async function loadPlan(user: CurrentUser, planId: string) {
  const plan = await db.budgetPlan.findUnique({ where: { id: planId }, include: { lines: true } });
  if (!plan) throw new AuthError("NOT_FOUND");
  await assertClientAccess(user, plan.clientId);
  return plan;
}

/**
 * Create or update a plan. The allocation is recomputed on the server from the submitted inputs
 * (the browser preview is never trusted) and saved as BudgetLine rows. Expenses tied to a line
 * are re-pointed to the equivalent new line.
 */
export async function savePlan(input: z.input<typeof planSchema>): Promise<BudgetActionResult> {
  try {
    const user = await assertUser("budget:edit");
    const data = planSchema.parse(input);
    await assertClientAccess(user, data.clientId);
    const existing = data.id ? await loadPlan(user, data.id) : null;
    if (existing && existing.clientId !== data.clientId) throw new BudgetError("CLIENT_MISMATCH");

    const [org, client] = await Promise.all([
      db.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { settings: true, currency: true } }),
      db.client.findUniqueOrThrow({ where: { id: data.clientId }, select: { country: true, industry: true } }),
    ]);
    const defaults = await planningDefaults({ clientId: data.clientId, organizationId: user.organizationId, orgCurrency: org.currency, currency: data.currency, fx: fxFromSettings(org.settings), country: client.country, industry: client.industry });

    // Only campaigns of this client on a selected platform may be linked.
    const campaigns = defaults.campaigns.filter((c) => data.campaignIds.includes(c.id) && data.platforms.includes(c.platform));
    const costs: Partial<Record<Platform, CostAssumption>> = {};
    const costSources: PlanAssumptions["costSources"] = {};
    for (const p of data.platforms) {
      const c = data.costs[p] ?? { cpm: null, cpc: null, cpl: null, cvr: null, aov: null };
      costs[p] = c;
      const d = defaults.costs[p];
      const src: Partial<Record<keyof CostAssumption, CostSource>> = {};
      for (const k of COST_KEYS) {
        if (c[k] == null) continue;
        src[k] = d?.[k] != null && Math.abs((d[k] ?? 0) - (c[k] ?? 0)) < 1e-9 ? (defaults.costSources[p]?.[k] ?? "manual") : "manual";
      }
      costSources[p] = src;
    }
    const alloc = allocate({
      total: data.totalBudget,
      platforms: data.platforms,
      objective: data.objective,
      scenario: data.scenario,
      customWeights: data.weights,
      platformShares: data.platformShares as Partial<Record<Platform, number>> | null,
      costs,
      history: defaults.history,
      campaigns,
      audiences: data.audiences,
      startDate: data.startDate,
      endDate: data.endDate,
    });

    const assumptions: PlanAssumptions = {
      version: 1,
      platforms: data.platforms,
      products: data.products,
      audiences: data.audiences,
      regions: data.regions,
      campaignIds: campaigns.map((c) => c.id),
      costs,
      costSources,
      market: Object.fromEntries(data.platforms.map((p) => [p, defaults.market[p] ?? {}])),
      previous: Object.fromEntries(data.platforms.filter((p) => defaults.previous[p]).map((p) => [p, defaults.previous[p]!])),
      weights: data.scenario === "CUSTOM" ? alloc.weights : null,
      platformShares: data.scenario === "CUSTOM" ? (data.platformShares as PlanAssumptions["platformShares"]) : null,
      phasing: alloc.weights.phasing,
      notes: data.notes,
    };
    const planData = {
      name: data.name,
      period: data.period,
      scenario: data.scenario,
      startDate: data.startDate,
      endDate: data.endDate,
      totalBudget: new Prisma.Decimal(data.totalBudget),
      currency: data.currency,
      objective: data.objective,
      assumptions: assumptions as unknown as Prisma.InputJsonValue,
      plannedContent: data.plannedContent,
    };
    const lineRows = alloc.lines.map((l) => ({
      category: l.category,
      label: l.label,
      platform: l.platform,
      campaignId: l.campaignId,
      funnelStage: l.funnelStage,
      plannedBudget: new Prisma.Decimal(l.budget),
      plannedImpressions: l.impressions,
      plannedReach: l.reach,
      plannedClicks: l.clicks,
      plannedLeads: l.leads,
      plannedSales: l.sales,
      plannedRevenue: new Prisma.Decimal(l.revenue),
    }));

    const plan = await db.$transaction(async (tx) => {
      if (!existing) {
        return tx.budgetPlan.create({ data: { ...planData, clientId: data.clientId, source: "MANUAL", lines: { create: lineRows } } });
      }
      const reopen = existing.status === "APPROVED";
      const updated = await tx.budgetPlan.update({ where: { id: existing.id }, data: { ...planData, ...(reopen ? { status: "DRAFT", approvedById: null, approvedAt: null } : {}) } });
      const oldLines = existing.lines;
      await tx.budgetLine.deleteMany({ where: { planId: existing.id } });
      const created = await Promise.all(lineRows.map((l) => tx.budgetLine.create({ data: { ...l, planId: existing.id } })));
      for (const o of oldLines) {
        const match = created.find((n) => (o.campaignId ? n.campaignId === o.campaignId : !n.campaignId && n.category === o.category && n.platform === o.platform));
        await tx.expense.updateMany({ where: { clientId: existing.clientId, planLineId: o.id }, data: { planLineId: match?.id ?? null } });
      }
      return updated;
    });

    await audit(user, {
      action: existing ? "update" : "create",
      entity: "BudgetPlan",
      entityId: plan.id,
      clientId: data.clientId,
      summary: `${data.name} · ${data.scenario} · ${data.totalBudget} ${data.currency}${existing?.status === "APPROVED" ? " (approval reset)" : ""}`,
      diff: { scenario: data.scenario, totalBudget: data.totalBudget, platforms: data.platforms, lines: lineRows.length, previousTotal: existing ? toNum(existing.totalBudget) : undefined },
    });
    revalidatePath("/budget");
    revalidatePath("/plan-vs-actual");
    return { ok: true, id: plan.id };
  } catch (e) {
    return fail(e);
  }
}

const idSchema = z.object({ planId: z.string().min(1) });

export async function deletePlan(input: z.input<typeof idSchema>): Promise<BudgetActionResult> {
  try {
    const user = await assertUser("budget:edit");
    const { planId } = idSchema.parse(input);
    const plan = await loadPlan(user, planId);
    if (plan.status === "APPROVED" && !user.perms.has("budget:approve")) throw new AuthError("FORBIDDEN");
    await db.$transaction([
      db.expense.updateMany({ where: { clientId: plan.clientId, planLineId: { in: plan.lines.map((l) => l.id) } }, data: { planLineId: null } }),
      db.budgetPlan.delete({ where: { id: plan.id } }),
    ]);
    await audit(user, { action: "delete", entity: "BudgetPlan", entityId: plan.id, clientId: plan.clientId, summary: plan.name, diff: { totalBudget: toNum(plan.totalBudget), currency: plan.currency } });
    revalidatePath("/budget");
    revalidatePath("/plan-vs-actual");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const statusSchema = z.object({ planId: z.string().min(1), status: z.enum(["APPROVED", "DRAFT"]) });

export async function setPlanStatus(input: z.input<typeof statusSchema>): Promise<BudgetActionResult> {
  try {
    const user = await assertUser("budget:approve");
    const data = statusSchema.parse(input);
    const plan = await loadPlan(user, data.planId);
    if (plan.status === data.status) return { ok: true };
    await db.budgetPlan.update({
      where: { id: plan.id },
      data: data.status === "APPROVED" ? { status: "APPROVED", approvedById: user.id, approvedAt: new Date() } : { status: "DRAFT", approvedById: null, approvedAt: null },
    });
    await audit(user, { action: data.status === "APPROVED" ? "approve" : "reopen", entity: "BudgetPlan", entityId: plan.id, clientId: plan.clientId, summary: `${plan.name}: ${plan.status} → ${data.status}` });
    revalidatePath("/budget");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const lineSchema = z.object({
  lineId: z.string().min(1),
  plannedBudget: z.number().finite().min(0).max(1e12),
  campaignId: z.string().nullable(),
  notes: z.string().max(1000).nullable(),
});

/** Manual line edit. Planned results scale with the budget (same cost assumptions). */
export async function updateLine(input: z.input<typeof lineSchema>): Promise<BudgetActionResult> {
  try {
    const user = await assertUser("budget:edit");
    const data = lineSchema.parse(input);
    const line = await db.budgetLine.findUnique({ where: { id: data.lineId }, include: { plan: true } });
    if (!line) throw new AuthError("NOT_FOUND");
    await assertClientAccess(user, line.plan.clientId);
    if (data.campaignId) {
      const c = await db.campaign.findFirst({ where: { id: data.campaignId, clientId: line.plan.clientId }, select: { id: true } });
      if (!c) throw new AuthError("NOT_FOUND");
    }
    const before = toNum(line.plannedBudget);
    const k = before > 0 ? data.plannedBudget / before : 0;
    const scale = (n: number) => Math.round(n * k);
    await db.budgetLine.update({
      where: { id: line.id },
      data: {
        plannedBudget: new Prisma.Decimal(data.plannedBudget),
        campaignId: data.campaignId,
        notes: data.notes,
        ...(before > 0
          ? { plannedImpressions: scale(line.plannedImpressions), plannedReach: scale(line.plannedReach), plannedClicks: scale(line.plannedClicks), plannedLeads: scale(line.plannedLeads), plannedSales: scale(line.plannedSales), plannedRevenue: new Prisma.Decimal(Math.round(toNum(line.plannedRevenue) * k * 100) / 100) }
          : {}),
      },
    });
    if (line.plan.status === "APPROVED") await db.budgetPlan.update({ where: { id: line.planId }, data: { status: "DRAFT", approvedById: null, approvedAt: null } });
    await audit(user, { action: "update", entity: "BudgetLine", entityId: line.id, clientId: line.plan.clientId, summary: line.label, diff: { plannedBudget: { from: before, to: data.plannedBudget }, campaignId: { from: line.campaignId, to: data.campaignId }, approvalReset: line.plan.status === "APPROVED" } });
    revalidatePath("/budget");
    revalidatePath("/plan-vs-actual");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const expenseSchema = z.object({
  clientId: z.string().min(1),
  planLineId: z.string().nullable(),
  date: day,
  amount: z.number().finite().positive().max(1e12),
  currency: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().trim().min(1).max(300),
});

export async function addExpense(input: z.input<typeof expenseSchema>): Promise<BudgetActionResult> {
  try {
    const user = await assertUser("expenses:edit");
    const data = expenseSchema.parse(input);
    await assertClientAccess(user, data.clientId);
    if (data.planLineId) {
      const line = await db.budgetLine.findFirst({ where: { id: data.planLineId, plan: { clientId: data.clientId } }, select: { id: true } });
      if (!line) throw new AuthError("NOT_FOUND");
    }
    const e = await db.expense.create({ data: { clientId: data.clientId, planLineId: data.planLineId, date: data.date, amount: new Prisma.Decimal(data.amount), currency: data.currency, description: data.description, createdById: user.id } });
    await audit(user, { action: "create", entity: "Expense", entityId: e.id, clientId: data.clientId, summary: `${data.description} · ${data.amount} ${data.currency}`, diff: data });
    revalidatePath("/budget");
    revalidatePath("/plan-vs-actual");
    return { ok: true, id: e.id };
  } catch (e) {
    return fail(e);
  }
}

const expenseIdSchema = z.object({ expenseId: z.string().min(1) });

export async function deleteExpense(input: z.input<typeof expenseIdSchema>): Promise<BudgetActionResult> {
  try {
    const user = await assertUser("expenses:edit");
    const { expenseId } = expenseIdSchema.parse(input);
    const ids = await accessibleClientIds(user);
    const e = await db.expense.findFirst({ where: { id: expenseId, clientId: { in: ids } } });
    if (!e) throw new AuthError("NOT_FOUND");
    await db.expense.delete({ where: { id: e.id } });
    await audit(user, { action: "delete", entity: "Expense", entityId: e.id, clientId: e.clientId, summary: e.description, diff: { amount: toNum(e.amount), currency: e.currency, date: e.date } });
    revalidatePath("/budget");
    revalidatePath("/plan-vs-actual");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const reallocSchema = z.object({
  planId: z.string().min(1),
  fromLineId: z.string().min(1),
  toLineId: z.string().min(1),
  amount: z.number().finite().positive(),
  reason: z.string().max(1000),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
});

/**
 * Records a human decision on a reallocation proposal (budget:approve). Approval creates a Task for
 * the team to make the change in the ad platform — nothing is changed automatically.
 */
export async function decideReallocation(input: z.input<typeof reallocSchema>): Promise<BudgetActionResult> {
  try {
    const user = await assertUser("budget:approve");
    const data = reallocSchema.parse(input);
    const plan = await loadPlan(user, data.planId);
    const from = plan.lines.find((l) => l.id === data.fromLineId);
    const to = plan.lines.find((l) => l.id === data.toLineId);
    if (!from || !to || from.id === to.id) throw new AuthError("NOT_FOUND");
    if (data.amount > toNum(from.plannedBudget)) throw new BudgetError("AMOUNT_TOO_HIGH");
    const { t, locale } = await getI18n();
    const amount = fmtMoney(data.amount, plan.currency, locale);
    const fromLabel = lineLabel(from, t);
    const toLabel = lineLabel(to, t);

    const rec = await db.aiRecommendation.create({
      data: {
        clientId: plan.clientId,
        area: "budget.reallocation",
        title: t("budget.realloc.title", { amount, from: fromLabel, to: toLabel }),
        body: { planId: plan.id, key: `${from.id}>${to.id}`, fromLineId: from.id, toLineId: to.id, amount: data.amount, currency: plan.currency, method: "rules" },
        reasoning: data.reason,
        confidence: 0.6,
        dataSources: [t("budget.realloc.source")],
        state: data.decision,
        decidedById: user.id,
        decidedAt: new Date(),
      },
    });
    let taskId: string | null = null;
    if (data.decision === "ACCEPTED") {
      const task = await db.task.create({
        data: {
          clientId: plan.clientId,
          title: t("budget.realloc.taskTitle", { amount, from: fromLabel, to: toLabel }),
          description: `${t("budget.realloc.taskBody", { plan: plan.name })}\n\n${data.reason}`,
          priority: "HIGH",
          dueDate: new Date(Date.now() + 2 * 86400000),
          createdById: user.id,
        },
      });
      taskId = task.id;
    }
    await audit(user, {
      action: data.decision === "ACCEPTED" ? "approve" : "reject",
      entity: "BudgetReallocation",
      entityId: rec.id,
      clientId: plan.clientId,
      summary: `${fromLabel} → ${toLabel}: ${amount}`,
      diff: { planId: plan.id, fromLineId: from.id, toLineId: to.id, amount: data.amount, taskId },
    });
    revalidatePath("/budget");
    return { ok: true, id: taskId ?? rec.id };
  } catch (e) {
    return fail(e);
  }
}
