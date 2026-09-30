"use client";

import { useState, useTransition } from "react";
import { QrCode } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Callout, Field, Input } from "@/components/ui/primitives";
import { ActionForm, CopyField } from "@/components/admin/action-form";
import type { ActionResult } from "@/components/admin/action-result";
import { confirmTotp, startTotpSetup } from "@/app/actions/security";

/**
 * Two-step 2FA enrolment: generate a secret (QR code + manual key), then confirm with a code
 * from the authenticator app. 2FA is only switched on after the code verifies.
 */
export function TotpSetup() {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [setup, setSetup] = useState<ActionResult>(undefined);

  if (!setup?.data?.qr) {
    return (
      <div className="space-y-3">
        {setup?.error && <Callout tone="bad">{t(setup.error)}</Callout>}
        <Button type="button" variant="primary" disabled={pending} onClick={() => start(async () => setSetup(await startTotpSetup()))}>
          <QrCode className="size-4" aria-hidden /> {pending ? t("ui.loading") : t("settings.2faStart")}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[auto_1fr]">
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL generated server-side */}
      <img src={setup.data.qr} alt={t("settings.2faQrAlt")} className="size-44 rounded-lg border border-border bg-white p-2" />
      <div className="min-w-0 space-y-3">
        <ol className="list-decimal space-y-1 ps-5 text-sm">
          <li>{t("settings.2faStep1")}</li>
          <li>{t("settings.2faStep2")}</li>
        </ol>
        {setup.data.secret && <CopyField value={setup.data.secret} label={t("settings.2faManualKey")} />}
        <ActionForm action={confirmTotp} submitLabel={t("settings.2faVerify")}>
          <Field label={t("settings.2faCode")} htmlFor="totp-code">
            <Input id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required dir="ltr" className="num max-w-40 tracking-widest" />
          </Field>
        </ActionForm>
      </div>
    </div>
  );
}
