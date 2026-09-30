import { LogOut, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import { fmtDateTime, fmtRelative, type Locale } from "@/lib/format";
import { Badge, Button, Callout, Card, CardBody, CardHeader, DataMeta, Field, Input, SimpleTable } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { ActionButton } from "@/components/admin/action-button";
import { describeAgent } from "@/components/users/user-agent";
import { TotpSetup } from "./totp-setup";
import { changePassword, disableTotp, revokeMySession, signOutOtherSessions } from "@/app/actions/security";
import { signOutEverywhere } from "@/app/actions/auth";

/** The signed-in user's own security: 2FA, password, sessions. */
export async function SecurityTab({ ctx }: { ctx: PageContext }) {
  const { t, locale, user } = ctx;
  const sessions = await db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
  const others = sessions.filter((s) => s.id !== user.sessionId).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("settings.2faTitle")}
          subtitle={t("settings.2faHint")}
          actions={user.totpEnabled ? <Badge tone="good"><ShieldCheck className="size-3" aria-hidden /> {t("users.on")}</Badge> : <Badge tone="warning">{t("users.off")}</Badge>}
        />
        <CardBody>
          {user.totpEnabled ? (
            <div className="space-y-3">
              <Callout tone="good">{t("settings.2faOnBody")}</Callout>
              <ActionForm action={disableTotp} submitLabel={t("settings.2faDisable")} submitVariant="danger" resetOnSuccess>
                <Field label={t("settings.2faCodeToDisable")} htmlFor="totp-off">
                  <Input id="totp-off" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required dir="ltr" className="num max-w-40 tracking-widest" />
                </Field>
              </ActionForm>
            </div>
          ) : (
            <div className="space-y-3">
              {(user.role === "SUPER_ADMIN" || user.role === "COMPANY_MANAGER") && <Callout tone="warning">{t("settings.2faRecommended")}</Callout>}
              <TotpSetup />
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("settings.passwordTitle")} subtitle={t("settings.passwordHint")} />
        <CardBody>
          <ActionForm action={changePassword} submitLabel={t("settings.changePassword")} resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("settings.currentPassword")} htmlFor="pw-cur">
                <Input id="pw-cur" name="current" type="password" autoComplete="current-password" required />
              </Field>
              <Field label={t("settings.newPassword")} htmlFor="pw-new" hint={t("auth.passwordRules")}>
                <Input id="pw-new" name="password" type="password" autoComplete="new-password" required minLength={10} />
              </Field>
              <Field label={t("settings.confirmPassword")} htmlFor="pw-conf">
                <Input id="pw-conf" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("users.activeSessions")}
          subtitle={t("settings.mySessionsHint")}
          meta={<DataMeta source={t("users.sessionSource")} updated={ctx.rel(sessions[0]?.lastSeenAt)} labels={ctx.metaLabels} />}
          actions={
            <div className="flex flex-wrap gap-2">
              {others > 0 && (
                <ActionButton action={signOutOtherSessions} confirm={t("settings.signOutOthersConfirm")}>
                  {t("settings.signOutOthers")}
                </ActionButton>
              )}
              <form action={signOutEverywhere}>
                <Button size="sm" variant="danger">
                  <LogOut className="size-3.5 flip-rtl" aria-hidden /> {t("users.revokeAll")}
                </Button>
              </form>
            </div>
          }
        />
        <SimpleTable
          head={[t("users.device"), t("users.ip"), t("users.started"), t("users.lastSeen"), ""]}
          rows={sessions.map((s) => [
            <span key="d" className="text-xs">
              {describeAgent(s.userAgent)} {s.id === user.sessionId && <Badge tone="info" className="ms-1">{t("users.thisDevice")}</Badge>}
            </span>,
            <span key="i" className="num text-xs" dir="ltr">{s.ip ?? "—"}</span>,
            <span key="c" className="text-xs">{fmtDateTime(s.createdAt, locale)}</span>,
            <span key="l" className="text-xs">{fmtRelative(s.lastSeenAt, locale as Locale)}</span>,
            s.id === user.sessionId ? (
              <span key="a" />
            ) : (
              <ActionButton key="a" action={revokeMySession.bind(null, s.id)} variant="ghost">
                <LogOut className="size-3.5 text-bad flip-rtl" aria-hidden /> {t("users.revoke")}
              </ActionButton>
            ),
          ])}
        />
      </Card>
    </div>
  );
}
