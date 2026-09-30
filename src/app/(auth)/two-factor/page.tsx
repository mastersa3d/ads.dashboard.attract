import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/session";
import { twoFactorAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.totpEnabled || user.twoFactorOk) redirect("/dashboard");
  const { t } = await getI18n();
  const { next } = await searchParams;
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("auth.twoFactorTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t("auth.twoFactorSubtitle")}</p>
      <AuthForm action={twoFactorAction} hidden={{ next: next ?? "" }} submit={t("auth.verify")} fields={[{ name: "code", label: t("auth.code"), autoComplete: "one-time-code", inputMode: "numeric" }]} />
    </div>
  );
}
