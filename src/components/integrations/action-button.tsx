"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, cx } from "@/components/ui/primitives";

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Maps server error codes to readable text (AuthError codes are generic on purpose). */
export function useErrorText() {
  const { t } = useI18n();
  return (error: string) => {
    if (error === "FORBIDDEN" || error === "UNAUTHENTICATED") return t("ui.accessDenied");
    if (error === "NOT_FOUND") return t("ui.noData");
    if (error === "INTERNAL") return t("ui.error");
    return error;
  };
}

/** Inline status line under a group of action buttons. */
export function ResultLine({ result }: { result: { tone: "good" | "bad"; text: string } | null }) {
  if (!result) return null;
  return (
    <p role="status" className={cx("text-xs", result.tone === "good" ? "text-good" : "text-bad")}>
      {result.text}
    </p>
  );
}

/**
 * Button that runs a server action, shows a spinner, optional confirm dialog, and reports the
 * outcome through `onDone` (success text built by the caller from the returned data).
 */
export function ActionButton<T>({
  action,
  children,
  confirm,
  variant = "secondary",
  size = "sm",
  success,
  onDone,
  refresh = true,
  className,
  disabled,
  title,
}: {
  action: () => Promise<ActionResult<T>>;
  children: React.ReactNode;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md";
  success?: (data: T | undefined) => string;
  onDone?: (r: { tone: "good" | "bad"; text: string }) => void;
  refresh?: boolean;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const errorText = useErrorText();
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [local, setLocal] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const report = onDone ?? setLocal;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={pending || disabled}
        title={title}
        aria-busy={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            try {
              const r = await action();
              if (r.ok) report({ tone: "good", text: success ? success(r.data) : t("ui.saved") });
              else report({ tone: "bad", text: errorText(r.error) });
              if (refresh) router.refresh();
            } catch {
              report({ tone: "bad", text: t("ui.error") });
            }
          });
        }}
      >
        {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {children}
      </Button>
      {!onDone && <ResultLine result={local} />}
    </>
  );
}
