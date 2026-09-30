"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Callout, Field, Input } from "@/components/ui/primitives";
import type { FormState } from "@/app/actions/auth";

export type AuthField = { name: string; label: string; type?: string; autoComplete?: string; hint?: string; inputMode?: "numeric"; defaultValue?: string };

export function AuthForm({ action, fields, submit, hidden, notice }: { action: (s: FormState, f: FormData) => Promise<FormState>; fields: AuthField[]; submit: string; hidden?: Record<string, string>; notice?: string }) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4">
      {notice && <Callout tone="good">{notice}</Callout>}
      {state?.error && <Callout tone="bad">{t(state.error)}</Callout>}
      {state?.ok && <Callout tone="good">{t(state.ok)}</Callout>}
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map((f) => (
        <Field key={f.name} label={f.label} htmlFor={f.name} hint={f.hint}>
          <Input id={f.name} name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} inputMode={f.inputMode} defaultValue={f.defaultValue} required />
        </Field>
      ))}
      <Button variant="primary" className="w-full" disabled={pending}>
        {pending ? t("ui.loading") : submit}
      </Button>
    </form>
  );
}
