import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { FxTable } from "@/lib/fx";

/** Typed view of Organization.settings (a free-form JSON column). */
export type OrgSettings = {
  appName?: string;
  company?: { legalName?: string; taxId?: string; address?: string; phone?: string; email?: string; website?: string; about?: string };
  fx?: FxTable;
  onboarding?: { completed?: string[]; firstClientId?: string; finishedAt?: string };
  [k: string]: unknown;
};

export const ONBOARDING_STEPS = ["company", "client", "integrations", "team", "budget", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function orgSettings(raw: unknown): OrgSettings {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as OrgSettings) : {};
}

/** Shallow-merge top-level keys into Organization.settings (read-modify-write in a transaction). */
export async function mergeOrgSettings(organizationId: string, patch: Partial<OrgSettings>) {
  return db.$transaction(async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    const next = { ...orgSettings(org.settings), ...patch };
    await tx.organization.update({ where: { id: organizationId }, data: { settings: next as Prisma.InputJsonValue } });
    return next;
  });
}

/** Records wizard progress so /onboarding resumes where the admin left off. */
export async function markOnboardingStep(user: { organizationId: string }, step: OnboardingStep, extra: { firstClientId?: string } = {}) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { settings: true } });
  const cur = orgSettings(org.settings).onboarding ?? {};
  const completed = [...new Set([...(cur.completed ?? []), step])];
  await mergeOrgSettings(user.organizationId, {
    onboarding: { ...cur, ...extra, completed, ...(step === "done" ? { finishedAt: new Date().toISOString() } : {}) },
  });
}

export function nextOnboardingStep(s: OrgSettings): OnboardingStep {
  const done = new Set(s.onboarding?.completed ?? []);
  return ONBOARDING_STEPS.find((st) => !done.has(st)) ?? "done";
}
