"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Platform } from "@prisma/client";
import { Platform as PlatformEnum } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth/session";
import { accessibleClientIds } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import type { ActionResult } from "@/components/admin/action-result";
import { CURRENCIES, NOTIFICATION_TYPES, THRESHOLD_TYPES, isTimezone } from "@/components/admin/constants";
import { ActionError, formFields, guarded, orNull } from "@/components/admin/server-action";
import { ONBOARDING_STEPS, markOnboardingStep, mergeOrgSettings, orgSettings, type OnboardingStep } from "@/components/settings/org-settings";

const hexOrEmpty = z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal(""));
const optText = (max: number) => z.string().max(max).optional().default("");
const urlOrEmpty = z
  .string()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v) || (v.startsWith("/") && !v.startsWith("//")), "url")
  .default("");

function revalidateSettings() {
  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

// ───────────── organisation ─────────────

export async function updateGeneral(_: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("settings:manage");
    const d = z.object({ appName: optText(80), defaultLocale: z.enum(["ar", "en"]) }).parse(formFields(form));
    await db.organization.update({ where: { id: user.organizationId }, data: { defaultLocale: d.defaultLocale } });
    await mergeOrgSettings(user.organizationId, { appName: d.appName || undefined });
    await audit(user, { action: "update", entity: "Organization", entityId: user.organizationId, summary: "General settings", diff: d });
    revalidateSettings();
    return { ok: "ui.saved" };
  });
}

const companySchema = z.object({
  name: z.string().trim().min(2).max(120),
  country: z.string().regex(/^[A-Z]{2}$/).or(z.literal("")).default(""),
  industry: optText(120),
  legalName: optText(200),
  taxId: optText(60),
  address: optText(500),
  phone: optText(40),
  email: z.email().max(200).or(z.literal("")).default(""),
  website: urlOrEmpty,
  about: optText(2000),
  // onboarding wizard reuses this form and also sets currency / timezone / locale
  currency: z.string().refine((c) => CURRENCIES.includes(c)).optional(),
  timezone: z.string().refine(isTimezone).optional(),
  defaultLocale: z.enum(["ar", "en"]).optional(),
  onboarding: z.literal("company").optional(),
});

export async function updateCompany(_: ActionResult, form: FormData): Promise<ActionResult> {
  let next = false;
  const res = await guarded(async () => {
    const user = await assertUser("settings:manage");
    const d = companySchema.parse(formFields(form));
    await db.organization.update({
      where: { id: user.organizationId },
      data: {
        name: d.name,
        country: orNull(d.country),
        industry: orNull(d.industry),
        ...(d.currency ? { currency: d.currency } : {}),
        ...(d.timezone ? { timezone: d.timezone } : {}),
        ...(d.defaultLocale ? { defaultLocale: d.defaultLocale } : {}),
      },
    });
    const { legalName, taxId, address, phone, email, website, about } = d;
    await mergeOrgSettings(user.organizationId, { company: { legalName, taxId, address, phone, email, website, about } });
    await audit(user, { action: "update", entity: "Organization", entityId: user.organizationId, summary: "Company profile", diff: d });
    if (d.onboarding === "company") {
      await markOnboardingStep(user, "company");
      next = true;
    }
    revalidateSettings();
    return { ok: "ui.saved" };
  });
  if (next && res?.ok) redirect("/onboarding?step=client");
  return res;
}

export async function updateOrgBranding(_: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("settings:manage");
    const f = formFields(form);
    const d = z
      .object({
        logoUrl: urlOrEmpty,
        primaryColor: hexOrEmpty,
        customDomain: z
          .string()
          .toLowerCase()
          .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/)
          .or(z.literal(""))
          .default(""),
      })
      .parse(f);
    const customDomain = orNull(d.customDomain);
    if (customDomain && (await db.organization.findFirst({ where: { customDomain, id: { not: user.organizationId } } }))) throw new ActionError("settings.errDomainTaken");
    await db.organization.update({ where: { id: user.organizationId }, data: { logoUrl: orNull(d.logoUrl), primaryColor: orNull(d.primaryColor), customDomain } });
    await audit(user, { action: "update", entity: "Organization", entityId: user.organizationId, summary: "Branding", diff: d });
    revalidateSettings();
    return { ok: "ui.saved" };
  });
}

/** Base currency + manual FX table (Organization.settings.fx, consumed by lib/fx.ts). */
export async function updateCurrency(_: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("settings:manage");
    const f = formFields(form);
    const currency = z.string().refine((c) => CURRENCIES.includes(c)).parse(f.currency);
    const base = z.string().regex(/^[A-Z]{3}$/).parse(f.fxBase);
    const codes = form.getAll("fxCode").map(String);
    const values = form.getAll("fxRate").map(String);
    const rates: Record<string, number> = {};
    codes.forEach((raw, i) => {
      const code = raw.trim().toUpperCase();
      const v = (values[i] ?? "").trim();
      if (!code && !v) return;
      if (!/^[A-Z]{3}$/.test(code)) throw new ActionError("settings.errFxCode");
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 1e7) throw new ActionError("settings.errFxRate");
      rates[code] = n;
    });
    rates[base] = 1; // rates are "units per 1 base currency"
    const source = z.string().max(200).parse(f.fxSource || "Manual");
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(f.fxAsOf ?? "") ? new Date(f.fxAsOf + "T00:00:00.000Z").toISOString() : new Date().toISOString();
    await db.organization.update({ where: { id: user.organizationId }, data: { currency } });
    await mergeOrgSettings(user.organizationId, { fx: { base, rates, asOf, source } });
    await audit(user, { action: "update", entity: "Organization", entityId: user.organizationId, summary: "Currency & FX rates", diff: { currency, base, rates, asOf, source } });
    revalidateSettings();
    return { ok: "ui.saved" };
  });
}

export async function updateTimezone(_: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("settings:manage");
    const timezone = z.string().refine(isTimezone).parse(formFields(form).timezone);
    await db.organization.update({ where: { id: user.organizationId }, data: { timezone } });
    await audit(user, { action: "update", entity: "Organization", entityId: user.organizationId, summary: `Timezone: ${timezone}` });
    revalidateSettings();
    return { ok: "ui.saved" };
  });
}

// ───────────── notification preferences (per user) ─────────────

/** Defaults (all clients) — one row per type with clientId = null. */
export async function saveNotificationDefaults(_: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    const existing = await db.notificationPreference.findMany({ where: { userId: user.id, clientId: null } });
    const ops = NOTIFICATION_TYPES.map((type) => {
      const inApp = form.get(`inApp:${type}`) === "on";
      const email = form.get(`email:${type}`) === "on";
      const raw = String(form.get(`threshold:${type}`) ?? "").trim();
      const threshold = THRESHOLD_TYPES.includes(type) && raw ? Number(raw) : null;
      if (threshold != null && (!Number.isFinite(threshold) || threshold < 0 || threshold > 10000)) throw new ActionError("settings.errThreshold");
      const row = existing.find((e) => e.type === type);
      // Postgres treats NULL clientIds as distinct, so the composite unique can't be used for upsert here.
      return row
        ? db.notificationPreference.update({ where: { id: row.id }, data: { inApp, email, threshold } })
        : db.notificationPreference.create({ data: { userId: user.id, type, inApp, email, threshold } });
    });
    await db.$transaction(ops);
    await audit(user, { action: "update", entity: "NotificationPreference", entityId: user.id, summary: "Notification defaults" });
    revalidatePath("/settings");
    return { ok: "ui.saved" };
  });
}

const overrideSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  clientId: z.string().min(1),
  platform: z.enum(Object.values(PlatformEnum) as [Platform, ...Platform[]]).or(z.literal("")).default(""),
  threshold: z.string().optional().default(""),
});

/** A client-specific rule (optionally narrowed to one platform) that overrides the defaults. */
export async function addNotificationOverride(_: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    const d = overrideSchema.parse(formFields(form));
    if (!(await accessibleClientIds(user)).includes(d.clientId)) throw new ActionError("settings.errNotFound");
    const threshold = d.threshold ? Number(d.threshold) : null;
    if (threshold != null && (!Number.isFinite(threshold) || threshold < 0 || threshold > 10000)) throw new ActionError("settings.errThreshold");
    const data = { platform: (d.platform || null) as Platform | null, inApp: form.get("inApp") === "on", email: form.get("email") === "on", threshold };
    const row = await db.notificationPreference.upsert({
      where: { userId_type_clientId: { userId: user.id, type: d.type, clientId: d.clientId } },
      create: { userId: user.id, type: d.type, clientId: d.clientId, ...data },
      update: data,
    });
    await audit(user, { action: "update", entity: "NotificationPreference", entityId: row.id, clientId: d.clientId, summary: `Override ${d.type}`, diff: { ...d, ...data } });
    revalidatePath("/settings");
    return { ok: "ui.saved" };
  });
}

export async function deleteNotificationOverride(id: string): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser();
    const { count } = await db.notificationPreference.deleteMany({ where: { id, userId: user.id } });
    if (!count) throw new ActionError("settings.errNotFound");
    await audit(user, { action: "delete", entity: "NotificationPreference", entityId: id });
    revalidatePath("/settings");
    return { ok: "ui.saved" };
  });
}

// ───────────── onboarding ─────────────

/** "Continue" on wizard steps that happen elsewhere (integrations, team, budget) and "Finish". */
export async function completeOnboardingStep(step: OnboardingStep): Promise<ActionResult> {
  const res = await guarded(async () => {
    const user = await assertUser("settings:manage");
    if (!ONBOARDING_STEPS.includes(step)) throw new ActionError("settings.errInvalid");
    await markOnboardingStep(user, step);
    await audit(user, { action: "onboarding_step", entity: "Organization", entityId: user.organizationId, summary: step });
    return { ok: "ui.saved" };
  });
  if (!res?.ok) return res;
  const i = ONBOARDING_STEPS.indexOf(step);
  redirect(step === "done" ? "/dashboard" : `/onboarding?step=${ONBOARDING_STEPS[i + 1]}`);
}

/** Restart the wizard from the first step (Settings → General). */
export async function resetOnboarding(): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("settings:manage");
    const org = await db.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { settings: true } });
    await mergeOrgSettings(user.organizationId, { onboarding: { firstClientId: orgSettings(org.settings).onboarding?.firstClientId, completed: [] } });
    await audit(user, { action: "onboarding_reset", entity: "Organization", entityId: user.organizationId });
    revalidatePath("/onboarding");
    return { ok: "ui.saved" };
  });
}
