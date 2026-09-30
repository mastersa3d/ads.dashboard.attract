"use client";

import { useActionState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Callout, cx } from "@/components/ui/primitives";
import type { ActionState } from "@/lib/competitors/action-result";

type Action = (s: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Form bound to a competitor/trends server action (useActionState). Shows the translated
 * success / error message returned by the action. Used by every mutation in these areas.
 */
export function ActionForm({
  action,
  hidden,
  children,
  submitLabel,
  submitVariant = "primary",
  confirm,
  resetOnOk = false,
  onOk,
  className,
  footer,
  encType,
}: {
  action: Action;
  hidden?: Record<string, string | undefined | null>;
  children?: React.ReactNode;
  submitLabel?: React.ReactNode;
  submitVariant?: "primary" | "secondary" | "danger" | "success" | "ghost";
  confirm?: string;
  resetOnOk?: boolean;
  onOk?: () => void;
  className?: string;
  footer?: React.ReactNode;
  encType?: string;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const handled = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state?.ok || state.at === handled.current) return;
    handled.current = state.at;
    if (resetOnOk) ref.current?.reset();
    onOk?.();
  }, [state, resetOnOk, onOk]);

  return (
    <form
      ref={ref}
      action={formAction}
      encType={encType}
      className={cx("space-y-3", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {hidden && Object.entries(hidden).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={v} />))}
      {children}
      {state?.error && <Callout tone="bad">{t(state.error, state.vars)}</Callout>}
      {state?.ok && <Callout tone="good">{t(state.ok, state.vars)}</Callout>}
      {(submitLabel || footer) && (
        <div className="flex flex-wrap items-center gap-2">
          {submitLabel && (
            <Button type="submit" variant={submitVariant} disabled={pending} aria-busy={pending}>
              {pending ? t("ui.loading") : submitLabel}
            </Button>
          )}
          {footer}
        </div>
      )}
    </form>
  );
}

/** One-click action (accept / reject / delete…) with an inline error line. */
export function ActionButton({
  action,
  hidden,
  label,
  variant = "secondary",
  confirm,
  icon,
  title,
}: {
  action: Action;
  hidden: Record<string, string>;
  label: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "success" | "ghost";
  confirm?: string;
  icon?: React.ReactNode;
  title?: string;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" size="sm" variant={variant} disabled={pending} title={title}>
        {icon}
        {pending ? t("ui.loading") : label}
      </Button>
      {state?.error && <span className="text-[11px] text-bad">{t(state.error, state.vars)}</span>}
    </form>
  );
}
