import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { getI18n } from "@/lib/i18n/server";
import { acceptInviteAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";
import { Callout } from "@/components/ui/primitives";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getI18n();
  const inv = await db.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { organization: { select: { name: true } } } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return <Callout tone="bad">{t("auth.linkExpired")}</Callout>;
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("auth.inviteTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t("auth.inviteSubtitle", { org: inv.organization.name })} <span className="font-medium text-text">{inv.email}</span></p>
      <AuthForm
        action={acceptInviteAction}
        hidden={{ token }}
        submit={t("auth.createAccount")}
        fields={[
          { name: "name", label: t("auth.fullName"), autoComplete: "name" },
          { name: "password", label: t("auth.password"), type: "password", autoComplete: "new-password", hint: t("auth.passwordRules") },
        ]}
      />
    </div>
  );
}
