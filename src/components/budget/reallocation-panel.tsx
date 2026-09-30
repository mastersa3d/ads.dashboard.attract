"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { decideReallocation } from "@/app/actions/budget";
import { Badge, Button, Callout, EmptyState } from "@/components/ui/primitives";

export type ProposalView = { key: string; fromId: string; toId: string; fromLabel: string; toLabel: string; amount: number; amountLabel: string; reason: string };

/**
 * Reallocation proposals. Approving records the decision and creates a task for the team —
 * the dashboard never changes budgets on the ad platforms.
 */
export function ReallocationPanel({ planId, proposals, canApprove }: { planId: string; proposals: ProposalView[]; canApprove: boolean }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const decide = (p: ProposalView, decision: "ACCEPTED" | "REJECTED") =>
    start(async () => {
      setMsg(null);
      const res = await decideReallocation({ planId, fromLineId: p.fromId, toLineId: p.toId, amount: p.amount, reason: p.reason, decision });
      setMsg(res.ok ? { tone: "good", text: t(decision === "ACCEPTED" ? "budget.realloc.approved" : "budget.realloc.rejected") } : { tone: "bad", text: t(`budget.error.${res.error}`) });
    });

  return (
    <div className="space-y-3">
      {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
      {proposals.length === 0 ? (
        <EmptyState title={t("budget.realloc.none")} hint={t("budget.realloc.noneHint")} />
      ) : (
        <ul className="space-y-3">
          {proposals.map((p) => (
            <li key={p.key} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="text-bad">{p.fromLabel}</span>
                <ArrowRight className="size-4 text-subtle flip-rtl" aria-hidden />
                <span className="text-good">{p.toLabel}</span>
                <Badge tone="brand">
                  <span className="num">{p.amountLabel}</span>
                </Badge>
                <Badge tone="warning">{t("budget.realloc.proposal")}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">{p.reason}</p>
              {canApprove && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="success" disabled={pending} onClick={() => decide(p, "ACCEPTED")}>
                    <Check className="size-3.5" aria-hidden /> {t("budget.realloc.approve")}
                  </Button>
                  <Button size="sm" disabled={pending} onClick={() => decide(p, "REJECTED")}>
                    <X className="size-3.5" aria-hidden /> {t("ui.reject")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-subtle">{t("budget.realloc.disclaimer")}</p>
    </div>
  );
}
