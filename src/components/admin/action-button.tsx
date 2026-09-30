"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import type { ActionResult } from "./action-result";

/**
 * One-click mutation (revoke, archive, mark read…). Pass a server action already bound to its
 * arguments: `<ActionButton action={revokeSession.bind(null, s.id)} … />`.
 */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  size = "sm",
  confirm,
  title,
  className,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md";
  confirm?: string;
  title?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        title={title}
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          start(async () => {
            const r = await action();
            if (r?.error) setError(t(r.error));
          });
        }}
      >
        {children}
      </Button>
      {error && (
        <span role="alert" className="text-[11px] text-bad">
          {error}
        </span>
      )}
    </span>
  );
}
