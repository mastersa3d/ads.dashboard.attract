import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { forgotPasswordAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";

export default async function ForgotPage() {
  const { t } = await getI18n();
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("auth.forgotTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t("auth.forgotSubtitle")}</p>
      <AuthForm action={forgotPasswordAction} submit={t("auth.sendLink")} fields={[{ name: "email", label: t("auth.email"), type: "email", autoComplete: "email" }]} />
      <Link href="/login" className="mt-4 inline-block text-sm text-brand hover:underline">{t("auth.backToLogin")}</Link>
    </div>
  );
}
