"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, GitBranch, Send, Undo2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { setStrategyStatus } from "@/app/actions/strategy";
import { Button } from "@/components/ui/primitives";

type Status = "DRAFT" | "IN_REVIEW" | "APPROVED";

/** DRAFT → IN_REVIEW → APPROVED workflow buttons; only the transitions the user may perform are shown. */
export function StatusActions({ clientId, status, canEdit, canApprove, hasStrategy }: { clientId: string; status: Status; canEdit: boolean; canApprove: boolean; hasStrategy: boolean }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const go = (to: Status, confirmKey?: string) => {
    if (confirmKey && !window.confirm(t(confirmKey))) return;
    setError(null);
    start(async () => {
      const res = await setStrategyStatus({ clientId, status: to });
      if (!res.ok) setError(t(`strategy.error.${res.error}`));
    });
  };
  if (!hasStrategy) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && canEdit && (
        <Button variant="primary" disabled={pending} onClick={() => go("IN_REVIEW")}>
          <Send className="size-4 flip-rtl" aria-hidden /> {t("strategy.submitReview")}
        </Button>
      )}
      {status === "IN_REVIEW" && canApprove && (
        <>
          <Button variant="success" disabled={pending} onClick={() => go("APPROVED", "strategy.confirmApprove")}>
            <CheckCircle2 className="size-4" aria-hidden /> {t("ui.approve")}
          </Button>
          <Button disabled={pending} onClick={() => go("DRAFT")}>
            <Undo2 className="size-4 flip-rtl" aria-hidden /> {t("ui.requestChanges")}
          </Button>
        </>
      )}
      {status === "APPROVED" && canEdit && (
        <Button disabled={pending} onClick={() => go("DRAFT", "strategy.confirmNewVersion")}>
          <GitBranch className="size-4" aria-hidden /> {t("strategy.newVersion")}
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
    </div>
  );
}
