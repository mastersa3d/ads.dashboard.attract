"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertUser, type CurrentUser } from "@/lib/auth/session";
import { assertClientAccess } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { NAV } from "@/components/layout/nav";
import { CURRENCIES, isTimezone } from "@/components/admin/constants";
import type { ActionResult } from "@/components/admin/action-result";
import { ActionError, formFields, formList, guarded, orNull, safePath, splitList } from "@/components/admin/server-action";
import { markOnboardingStep } from "@/app/actions/settings";

// ───────────── validation ─────────────

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Absolute http(s) URL or an app-relative path (uploads are served from the app). */
const urlOrPath = z
  .string()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v) || (v.startsWith("/") && !v.startsWith("//")), "url");
const optText = (max: number) => z.string().max(max).optional().default("");
const SECTION_KEYS = NAV.flatMap((g) => g.items.map((i) => i.section));

const baseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  industry: optText(120),
  country: z.string().regex(/^[A-Z]{2}$/).or(z.literal("")).default(""),
  currency: z.string().refine((c) => CURRENCIES.includes(c), "currency"),
  timezone: z.string().refine(isTimezone, "timezone"),
  website: urlOrPath.default(""),
  logoUrl: urlOrPath.default(""),
});

const profileSchema = baseSchema.extend({
  coverUrl: urlOrPath.default(""),
  fonts: optText(500),
  branches: optText(4000),
  contactName: optText(120),
  contactEmail: z.email().max(200).or(z.literal("")).default(""),
  contactPhone: optText(40),
  products: optText(4000),
  audiences: optText(4000),
  goals: optText(4000),
  accountManagerId: optText(40),
  contractStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
  package: optText(120),
  notes: optText(8000),
  isB2B: z.string().optional(),
});

function colorsFrom(form: FormData) {
  return formList(form, "brandColors").map((c) => hex.parse(c)).slice(0, 6);
}

async function assertManager(user: CurrentUser, id: string) {
  if (!id) return null;
  const m = await db.user.findFirst({ where: { id, organizationId: user.organizationId, active: true }, select: { id: true } });
  if (!m) throw new ActionError("settings.errInvalid");
  return m.id;
}

/** Client in the caller's organization that the caller may access (tenant check). */
async function ownClient(user: CurrentUser, clientId: string) {
  await assertClientAccess(user, clientId);
  const c = await db.client.findFirst({ where: { id: clientId, organizationId: user.organizationId } });
  if (!c) throw new ActionError("settings.errNotFound");
  return c;
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "client"
  );
}

async function uniqueSlug(organizationId: string, name: string) {
  const base = slugify(name);
  const taken = new Set((await db.client.findMany({ where: { organizationId, slug: { startsWith: base } }, select: { slug: true } })).map((c) => c.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

// ───────────── clients ─────────────

export async function createClient(_: ActionResult, form: FormData): Promise<ActionResult> {
  let target = "";
  const res = await guarded(async () => {
    const user = await assertUser("clients:create");
    const f = formFields(form);
    const data = baseSchema.parse(f);
    const client = await db.client.create({
      data: {
        organizationId: user.organizationId,
        name: data.name,
        slug: await uniqueSlug(user.organizationId, data.name),
        industry: orNull(data.industry),
        country: orNull(data.country),
        currency: data.currency,
        timezone: data.timezone,
        website: orNull(data.website),
        logoUrl: orNull(data.logoUrl),
        brandColors: colorsFrom(form),
        accountManagerId: await assertManager(user, f.accountManagerId ?? ""),
        package: orNull(f.package),
      },
    });
    // Users whose visibility is list-based must be able to see what they just created.
    if (user.role !== "SUPER_ADMIN" && user.role !== "COMPANY_MANAGER") {
      await db.clientAccess.create({ data: { userId: user.id, clientId: client.id } });
    }
    await audit(user, { action: "create", entity: "Client", entityId: client.id, clientId: client.id, summary: client.name, diff: data });
    if (f.onboarding === "client") await markOnboardingStep(user, "client", { firstClientId: client.id });
    revalidatePath("/clients");
    target = safePath(f.next) ?? `/clients/${client.id}`;
    return { ok: "ui.saved" };
  });
  if (res?.ok && target) redirect(target);
  return res;
}

export async function updateClientProfile(clientId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("clients:edit");
    const before = await ownClient(user, clientId);
    const d = profileSchema.parse(formFields(form));
    const data = {
      name: d.name,
      industry: orNull(d.industry),
      country: orNull(d.country),
      currency: d.currency,
      timezone: d.timezone,
      website: orNull(d.website),
      logoUrl: orNull(d.logoUrl),
      coverUrl: orNull(d.coverUrl),
      brandColors: colorsFrom(form),
      fonts: splitList(d.fonts, 6),
      branches: splitList(d.branches),
      contactName: orNull(d.contactName),
      contactEmail: orNull(d.contactEmail),
      contactPhone: orNull(d.contactPhone),
      products: splitList(d.products),
      audiences: splitList(d.audiences),
      goals: orNull(d.goals),
      accountManagerId: await assertManager(user, d.accountManagerId),
      contractStart: d.contractStart ? new Date(d.contractStart + "T00:00:00.000Z") : null,
      package: orNull(d.package),
      notes: orNull(d.notes),
      isB2B: d.isB2B === "on",
    };
    await db.client.update({ where: { id: before.id }, data });
    await audit(user, { action: "update", entity: "Client", entityId: clientId, clientId, summary: `Profile: ${data.name}`, diff: changed(before, data) });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return { ok: "ui.saved" };
  });
}

export async function updateClientBranding(clientId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("clients:edit");
    const before = await ownClient(user, clientId);
    const f = formFields(form);
    const logoUrl = urlOrPath.parse(f.logoUrl ?? "");
    const hidden = formList(form, "hiddenSections").filter((s) => SECTION_KEYS.includes(s));
    const theme = z
      .object({
        primary: hex.or(z.literal("")).default(""),
        accent: hex.or(z.literal("")).default(""),
        font: optText(80),
        footer: optText(300),
        showLogo: z.boolean(),
        domainNote: optText(300),
      })
      .parse({ primary: f.themePrimary, accent: f.themeAccent, font: f.themeFont, footer: f.themeFooter, showLogo: f.themeShowLogo === "on", domainNote: f.domainNote });
    const data = { logoUrl: orNull(logoUrl), brandColors: colorsFrom(form), hiddenSections: hidden, reportTheme: theme };
    await db.client.update({ where: { id: before.id }, data });
    await audit(user, { action: "update", entity: "Client", entityId: clientId, clientId, summary: "Branding & white label", diff: changed(before, data) });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/", "layout");
    return { ok: "ui.saved" };
  });
}

export async function setClientArchived(clientId: string, archived: boolean): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("clients:delete");
    // Archived clients drop out of accessibleClientIds, so restore checks org + explicit access.
    const c = await db.client.findFirst({ where: { id: clientId, organizationId: user.organizationId } });
    if (!c) throw new ActionError("settings.errNotFound");
    if (user.role !== "SUPER_ADMIN" && user.role !== "COMPANY_MANAGER") {
      const access = await db.clientAccess.findFirst({ where: { userId: user.id, clientId } });
      if (!access) throw new ActionError("ui.accessDenied");
    }
    await db.client.update({ where: { id: clientId }, data: { archived } });
    await audit(user, { action: archived ? "archive" : "restore", entity: "Client", entityId: clientId, clientId, summary: c.name });
    revalidatePath("/clients");
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/", "layout");
    return { ok: "ui.saved" };
  });
}

// ───────────── brands ─────────────

const brandSchema = z.object({ name: z.string().trim().min(1).max(120), logoUrl: urlOrPath.default("") });

export async function createBrand(clientId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("clients:edit");
    await ownClient(user, clientId);
    const d = brandSchema.parse(formFields(form));
    const brand = await db.brand.create({ data: { clientId, name: d.name, logoUrl: orNull(d.logoUrl), colors: colorsFrom(form) } });
    await audit(user, { action: "create", entity: "Brand", entityId: brand.id, clientId, summary: brand.name, diff: d });
    revalidatePath(`/clients/${clientId}`);
    return { ok: "ui.saved" };
  });
}

async function ownBrand(user: CurrentUser, brandId: string) {
  const brand = await db.brand.findFirst({ where: { id: brandId, client: { organizationId: user.organizationId } } });
  if (!brand) throw new ActionError("settings.errNotFound");
  await assertClientAccess(user, brand.clientId);
  return brand;
}

export async function updateBrand(brandId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("clients:edit");
    const before = await ownBrand(user, brandId);
    const d = brandSchema.parse(formFields(form));
    const data = { name: d.name, logoUrl: orNull(d.logoUrl), colors: colorsFrom(form) };
    await db.brand.update({ where: { id: brandId }, data });
    await audit(user, { action: "update", entity: "Brand", entityId: brandId, clientId: before.clientId, summary: d.name, diff: changed(before, data) });
    revalidatePath(`/clients/${before.clientId}`);
    return { ok: "ui.saved" };
  });
}

export async function deleteBrand(brandId: string): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("clients:edit");
    const brand = await ownBrand(user, brandId);
    await db.brand.delete({ where: { id: brandId } });
    await audit(user, { action: "delete", entity: "Brand", entityId: brandId, clientId: brand.clientId, summary: brand.name });
    revalidatePath(`/clients/${brand.clientId}`);
    return { ok: "ui.saved" };
  });
}

// ───────────── access (ClientAccess) ─────────────

export async function grantClientAccess(clientId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("users:manage");
    await ownClient(user, clientId);
    const userIds = formList(form, "userId");
    if (!userIds.length) throw new ActionError("settings.errInvalid");
    const targets = await db.user.findMany({ where: { id: { in: userIds }, organizationId: user.organizationId }, select: { id: true, email: true } });
    if (targets.length !== userIds.length) throw new ActionError("settings.errNotFound");
    await db.clientAccess.createMany({ data: targets.map((t) => ({ userId: t.id, clientId })), skipDuplicates: true });
    await audit(user, { action: "grant_access", entity: "ClientAccess", clientId, summary: targets.map((t) => t.email).join(", ") });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/users");
    return { ok: "ui.saved" };
  });
}

export async function revokeClientAccess(clientId: string, userId: string): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertUser("users:manage");
    await ownClient(user, clientId);
    const target = await db.user.findFirst({ where: { id: userId, organizationId: user.organizationId }, select: { email: true } });
    if (!target) throw new ActionError("settings.errNotFound");
    await db.clientAccess.deleteMany({ where: { userId, clientId } });
    await audit(user, { action: "revoke_access", entity: "ClientAccess", entityId: userId, clientId, summary: target.email });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/users");
    return { ok: "ui.saved" };
  });
}

/** Field-level before/after for the audit diff (only keys that changed). */
function changed(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    const prev = before[k];
    const norm = (x: unknown) => (x instanceof Date ? x.toISOString() : JSON.stringify(x ?? null));
    if (norm(prev) !== norm(v)) out[k] = { from: prev ?? null, to: v ?? null };
  }
  return out;
}
