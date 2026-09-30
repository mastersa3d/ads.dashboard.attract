"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Callout, cx } from "@/components/ui/primitives";
import type { ActionResult, FormAction } from "./action-result";

/**
 * Wraps server-rendered fields in a form that submits to a server action and shows the
 * translated result. Submission goes through a transition (not the native `action` prop) so the
 * browser keeps what the user typed when validation fails.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitVariant = "primary",
  className,
  resetOnSuccess = false,
  confirm,
  footer,
  disabled,
}: {
  action: FormAction;
  children: React.ReactNode;
  submitLabel?: string;
  submitVariant?: "primary" | "secondary" | "danger" | "success";
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  footer?: React.ReactNode;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<ActionResult>(undefined);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    start(async () => {
      const r = await action(state, data);
      setState(r);
      if (r?.ok && resetOnSuccess) form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} className={cx("space-y-4", className)}>
      <fieldset disabled={pending || disabled} className="contents">
        {children}
      </fieldset>
      <ResultMessage state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant={submitVariant} disabled={pending || disabled}>
          {pending ? t("ui.loading") : (submitLabel ?? t("ui.save"))}
        </Button>
        {footer}
      </div>
    </form>
  );
}

export function ResultMessage({ state }: { state: ActionResult }) {
  const { t } = useI18n();
  if (!state) return null;
  return (
    <div className="space-y-2" aria-live="polite">
      {state.error && (
        <Callout tone="bad">
          {t(state.error)}
          {state.data?.field && <span className="ms-1 text-xs opacity-80">({state.data.field})</span>}
        </Callout>
      )}
      {state.ok && <Callout tone="good">{t(state.ok)}</Callout>}
      {state.data?.link && <CopyField value={state.data.link} label={state.data.linkLabel ?? undefined} />}
    </div>
  );
}

/** Read-only value with a copy button (invitation links, TOTP secrets). */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      {label && <p className="text-xs text-muted">{label}</p>}
      <div className="flex items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs">
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            await navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? t("ui.copied") : t("ui.copyLink")}
        </Button>
      </div>
    </div>
  );
}
