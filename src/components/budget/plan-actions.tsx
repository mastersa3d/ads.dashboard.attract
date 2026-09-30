"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, Trash2, Undo2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { deletePlan, setPlanStatus } from "@/app/actions/budget";
import { Button, LinkButton } from "@/components/ui/primitives";

/** Edit / approve / reopen / delete buttons — rendered only for permitted users, enforced server-side. */
export function PlanActions({ planId, status, editHref, canEdit, canApprove }: { planId: string; status: string; editHref: string; canEdit: boolean; canApprove: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(t(`budget.error.${res.error}`));
      else after?.();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && (
        <LinkButton href={editHref}>
          <Pencil className="size-4" aria-hidden /> {t("ui.edit")}
        </LinkButton>
      )}
      {canApprove && status !== "APPROVED" && (
        <Button variant="success" disabled={pending} onClick={() => window.confirm(t("budget.confirmApprove")) && run(() => setPlanStatus({ planId, status: "APPROVED" }))}>
          <CheckCircle2 className="size-4" aria-hidden /> {t("ui.approve")}
        </Button>
      )}
      {canApprove && status === "APPROVED" && (
        <Button disabled={pending} onClick={() => run(() => setPlanStatus({ planId, status: "DRAFT" }))}>
          <Undo2 className="size-4 flip-rtl" aria-hidden /> {t("budget.reopen")}
        </Button>
      )}
      {canEdit && (status !== "APPROVED" || canApprove) && (
        <Button variant="ghost" className="text-bad" disabled={pending} onClick={() => window.confirm(t("budget.confirmDelete")) && run(() => deletePlan({ planId }), () => router.push("/budget"))}>
          <Trash2 className="size-4" aria-hidden /> {t("ui.delete")}
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
