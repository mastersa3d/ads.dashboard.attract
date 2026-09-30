"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCheck, CheckCircle2, ExternalLink, MessageSquareWarning, XCircle } from "lucide-react";
import type { ContentStatus } from "@prisma/client";
import { useI18n } from "@/lib/i18n/client";
import { bulkApprove, changeStatus } from "@/app/actions/content";
import type { ContentDTO } from "@/lib/content/queries";
import type { Permission } from "@/lib/rbac";
import { allowedTransitions } from "@/lib/content/workflow";
import { isApprovalOverdue } from "@/lib/content/due";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { Badge, Button, Callout, cx, EmptyState } from "@/components/ui/primitives";
import { StatusBadge } from "./status-badge";
import { ContentPreview } from "./preview";
import { CommentDialog } from "./comment-dialog";

type Decision = { item: ContentDTO; to: ContentStatus; label: string; required: boolean; tone: "success" | "danger" | "primary" };

/**
 * Approval Center list. Agency users get a compact queue with bulk approve; client users get
 * large preview cards with Approve / Request changes / Reject (reason mandatory for the last two).
 */
export function ApprovalCenter({
  items,
  mode,
  perms,
  clientNames,
  currencies,
  nowIso,
  timezone,
}: {
  items: ContentDTO[];
  mode: "client" | "agency";
  perms: Permission[];
  clientNames: Record<string, string>;
  currencies: Record<string, string>;
  nowIso: string;
  timezone: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const permSet = useMemo(() => new Set(perms), [perms]);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decision, setDecision] = useState<Decision | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const bulkable = (it: ContentDTO) => permSet.has("content:approve_internal") && allowedTransitions(it.status, permSet).some((x) => x.approval?.decision === "APPROVED");
  const bulkItems = items.filter(bulkable);

  function decisionsFor(it: ContentDTO): Decision[] {
    return allowedTransitions(it.status, permSet)
      .filter((x) => x.approval)
      .map((x) => ({
        item: it,
        to: x.to,
        required: Boolean(x.requiresComment),
        label: x.approval!.decision === "APPROVED" ? (x.to === "CLIENT_REVIEW" ? t("content.approveInternal") : t("ui.approve")) : x.approval!.decision === "REJECTED" ? t("ui.reject") : t("ui.requestChanges"),
        tone: x.approval!.decision === "APPROVED" ? "success" : x.approval!.decision === "REJECTED" ? "danger" : "primary",
      }));
  }

  function decide(d: Decision, comment?: string) {
    start(async () => {
      const res = await changeStatus({ id: d.item.id, to: d.to, comment: comment ?? null });
      setDecision(null);
      setMessage(res.ok ? { tone: "good", text: t("content.decisionSaved", { title: d.item.title }) } : { tone: "bad", text: t(`content.err.${res.error}`) });
      router.refresh();
    });
  }

  function runBulk() {
    const ids = [...selected];
    start(async () => {
      const res = await bulkApprove({ ids });
      setSelected(new Set());
      setMessage(res.ok ? { tone: "good", text: t("content.bulkDone", { n: res.approved, skipped: res.skipped }) } : { tone: "bad", text: t(`content.err.${res.error}`) });
      router.refresh();
    });
  }

  const openHref = (it: ContentDTO) => `/calendar?client=${it.clientId}&item=${it.id}`;
  const icon = (tone: Decision["tone"]) => (tone === "success" ? <CheckCircle2 className="size-4" aria-hidden /> : tone === "danger" ? <XCircle className="size-4" aria-hidden /> : <MessageSquareWarning className="size-4" aria-hidden />);

  if (!items.length) return <EmptyState title={t("content.queueEmpty")} hint={t("content.queueEmptyHint")} icon={<CheckCheck className="size-6" aria-hidden />} />;

  return (
    <div className="space-y-3">
      {message && <Callout tone={message.tone}>{message.text}</Callout>}

      {mode === "client" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((it) => {
            const overdue = isApprovalOverdue(it.approvalDeadline, it.status, now);
            return (
              <div key={it.id} className="space-y-3">
                <ContentPreview item={it} t={t} locale={locale} clientName={clientNames[it.clientId]} currency={currencies[it.clientId]} />
                {it.approvalDeadline && (
                  <p className={cx("text-xs", overdue ? "font-medium text-bad" : "text-muted")}>
                    {overdue && <AlertTriangle className="me-1 inline size-3.5" aria-hidden />}
                    {t("content.decideBy", { at: fmtDateTime(it.approvalDeadline, locale, it.timezone) })}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {decisionsFor(it).map((d) => (
                    <Button key={d.to} variant={d.tone} className="h-12 text-base" disabled={pending} onClick={() => setDecision(d)}>
                      {icon(d.tone)} {d.label}
                    </Button>
                  ))}
                </div>
                <Link href={openHref(it)} className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                  <ExternalLink className="size-3.5" aria-hidden /> {t("content.openDetails")}
                </Link>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-card border border-border bg-surface">
          {bulkItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={selected.size > 0 && selected.size === bulkItems.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(bulkItems.map((i) => i.id)) : new Set())}
                />
                {t("content.selectAll")}
              </label>
              <Button size="sm" variant="success" className="ms-auto" disabled={!selected.size || pending} onClick={runBulk}>
                <CheckCheck className="size-3.5" aria-hidden /> {t("content.bulkApprove", { n: selected.size })}
              </Button>
            </div>
          )}
          <ul className="divide-y divide-border">
            {items.map((it) => {
              const overdue = isApprovalOverdue(it.approvalDeadline, it.status, now);
              return (
                <li key={it.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  {bulkItems.length > 0 && (
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      aria-label={t("content.selectItem", { title: it.title })}
                      disabled={!bulkable(it)}
                      checked={selected.has(it.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(it.id);
                          else n.delete(it.id);
                          return n;
                        })
                      }
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={openHref(it)} className="font-medium hover:text-brand">
                      {it.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      <StatusBadge status={it.status} label={t(`contentStatus.${it.status}`)} />
                      {Object.keys(clientNames).length > 1 && <span>{clientNames[it.clientId]} ·</span>}
                      <span>{t(`platform.${it.platform}`)}</span>
                      <span>·</span>
                      <span className="num">{it.publishAt ? fmtDateTime(it.publishAt, locale, timezone) : t("content.unscheduled")}</span>
                      {it.assigneeName && <span>· {it.assigneeName}</span>}
                      {it.approvalDeadline && (
                        <Badge tone={overdue ? "bad" : "neutral"}>
                          {overdue && <AlertTriangle className="size-3" aria-hidden />}
                          {t("content.deadline")}: <span className="num">{fmtRelative(it.approvalDeadline, locale, now)}</span>
                        </Badge>
                      )}
                    </div>
                    {it.hook && <p className="mt-1 line-clamp-1 text-xs text-muted">{it.hook}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {decisionsFor(it).map((d) => (
                      <Button key={d.to} size="sm" variant={d.tone === "primary" ? "secondary" : d.tone} disabled={pending} onClick={() => (d.required ? setDecision(d) : decide(d))}>
                        {d.label}
                      </Button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {decision && (
        <CommentDialog
          title={`${decision.label}: ${decision.item.title}`}
          required={decision.required}
          confirmLabel={decision.label}
          tone={decision.tone}
          busy={pending}
          onCancel={() => setDecision(null)}
          onConfirm={(c) => decide(decision, c)}
        />
      )}
    </div>
  );
}
