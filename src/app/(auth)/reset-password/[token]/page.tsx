import { getI18n } from "@/lib/i18n/server";
import { resetPasswordAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getI18n();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">{t("auth.resetTitle")}</h1>
      <AuthForm
        action={resetPasswordAction}
        hidden={{ token }}
        submit={t("auth.setPassword")}
        fields={[
          { name: "password", label: t("auth.newPassword"), type: "password", autoComplete: "new-password", hint: t("auth.passwordRules") },
          { name: "confirm", label: t("auth.confirmPassword"), type: "password", autoComplete: "new-password" },
        ]}
      />
    </div>
  );
}
