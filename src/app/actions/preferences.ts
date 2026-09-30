"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertUser, destroySession, getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { FILTER_KEYS } from "@/lib/filters";

const YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: "ar" | "en") {
  if (locale !== "ar" && locale !== "en") return;
  (await cookies()).set("locale", locale, { path: "/", maxAge: YEAR, sameSite: "lax" });
  const user = await getCurrentUser();
  if (user) await db.user.update({ where: { id: user.id }, data: { locale } });
  revalidatePath("/", "layout");
}

export async function setTheme(theme: "light" | "dark") {
  (await cookies()).set("theme", theme === "dark" ? "dark" : "light", { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function logout() {
  const user = await getCurrentUser();
  if (user) await audit(user, { action: "logout", entity: "Session", entityId: user.sessionId });
  await destroySession();
  redirect("/login");
}

const viewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  path: z.string().startsWith("/").max(200),
  query: z.string().max(2000),
  shared: z.boolean(),
});

export async function saveView(input: z.infer<typeof viewSchema>) {
  const user = await assertUser();
  const data = viewSchema.parse(input);
  // keep only known filter keys — never persist arbitrary params
  const q = new URLSearchParams(data.query);
  const clean = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = q.get(k);
    if (v) clean.set(k, v);
  }
  const view = await db.savedView.create({
    data: { organizationId: user.organizationId, userId: user.id, name: data.name, path: data.path, query: clean.toString(), shared: data.shared },
  });
  await audit(user, { action: "create", entity: "SavedView", entityId: view.id, summary: data.name });
  revalidatePath("/", "layout");
  return { id: view.id };
}

export async function deleteView(id: string) {
  const user = await assertUser();
  await db.savedView.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/", "layout");
}
