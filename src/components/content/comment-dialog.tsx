"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Button, cx, textareaClass } from "@/components/ui/primitives";

/**
 * Modal asking for a reason. Used for rejections / change requests (mandatory comment) and
 * optional notes on approval.
 */
export function CommentDialog({
  title,
  required,
  confirmLabel,
  tone = "primary",
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  required: boolean;
  confirmLabel: string;
  tone?: "primary" | "danger" | "success";
  onConfirm: (comment: string) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);
  const invalid = required && !text.trim();
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="comment-dialog-title">
      <div className="w-full max-w-md rounded-card border border-border bg-surface p-4 shadow-lg">
        <h2 id="comment-dialog-title" className="text-sm font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-xs text-muted">{required ? t("content.commentRequired") : t("content.commentOptional")}</p>
        <textarea ref={ref} className={cx(textareaClass, "mt-3 min-h-28")} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} aria-label={t("ui.comment")} aria-required={required} />
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" onClick={onCancel} disabled={busy}>
            {t("ui.cancel")}
          </Button>
          <Button type="button" variant={tone} disabled={invalid || busy} onClick={() => onConfirm(text.trim())}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
