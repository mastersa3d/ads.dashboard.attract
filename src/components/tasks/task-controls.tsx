"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Select, Textarea, cx, inputClass } from "@/components/ui/primitives";
import { ResultLine, useErrorText } from "@/components/integrations/action-button";
import { deleteTask, saveTask, setTaskStatus } from "@/app/actions/tasks";

const STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** Inline status select (team with tasks:edit, or the assignee). */
export function TaskStatusSelect({ id, status, label }: { id: string; status: string; label: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(status);
  return (
    <select
      aria-label={label}
      value={value}
      disabled={pending}
      className={cx(inputClass, "h-8 w-auto min-w-32 py-0 pe-8 text-xs")}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        start(async () => {
          const r = await setTaskStatus({ id, status: next });
          if (!r.ok) setValue(status);
          router.refresh();
        });
      }}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {t(`taskStatus.${s}`)}
        </option>
      ))}
    </select>
  );
}

export function MarkDoneButton({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      title={t("tasks.markDone")}
      aria-label={t("tasks.markDone")}
      onClick={() =>
        start(async () => {
          await setTaskStatus({ id, status: "DONE" });
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4 text-good" aria-hidden />}
    </Button>
  );
}

export type TaskFormValue = {
  id?: string;
  clientId: string;
  title: string;
  description: string;
  assigneeId: string;
  dueDate: string;
  priority: string;
  status: string;
  reportId: string;
};

export function TaskForm({
  initial,
  clients,
  users,
  reports,
  onClose,
}: {
  initial: TaskFormValue;
  clients: { id: string; name: string }[];
  users: { id: string; name: string }[];
  reports: { id: string; title: string; clientId: string }[];
  onClose?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const set = (k: keyof TaskFormValue, val: string) => setV((p) => ({ ...p, [k]: val }));

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveTask(v);
          if (r.ok) {
            setResult({ tone: "good", text: t("ui.saved") });
            if (onClose) router.push(onClose);
            else {
              setV({ ...initial, title: "", description: "" });
              router.refresh();
            }
          } else setResult({ tone: "bad", text: errorText(r.error) });
        });
      }}
    >
      <Field label={t("tasks.col.title")} htmlFor="task-title" className="sm:col-span-2">
        <Input id="task-title" required maxLength={300} value={v.title} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <Field label={t("filter.client")} htmlFor="task-client">
        <Select id="task-client" value={v.clientId} disabled={Boolean(v.id)} onChange={(e) => setV({ ...v, clientId: e.target.value, reportId: "" })} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Field label={t("ui.owner")} htmlFor="task-owner">
        <Select id="task-owner" value={v.assigneeId} placeholder="—" onChange={(e) => set("assigneeId", e.target.value)} options={users.map((u) => ({ value: u.id, label: u.name }))} />
      </Field>
      <Field label={t("ui.dueDate")} htmlFor="task-due">
        <Input id="task-due" type="date" value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
      </Field>
      <Field label={t("ui.priority")} htmlFor="task-priority">
        <Select id="task-priority" value={v.priority} onChange={(e) => set("priority", e.target.value)} options={PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) }))} />
      </Field>
      <Field label={t("ui.status")} htmlFor="task-status">
        <Select id="task-status" value={v.status} onChange={(e) => set("status", e.target.value)} options={STATUSES.map((s) => ({ value: s, label: t(`taskStatus.${s}`) }))} />
      </Field>
      <Field label={t("tasks.col.report")} htmlFor="task-report">
        <Select id="task-report" value={v.reportId} placeholder="—" onChange={(e) => set("reportId", e.target.value)} options={reports.filter((r) => r.clientId === v.clientId).map((r) => ({ value: r.id, label: r.title }))} />
      </Field>
      <Field label={t("tasks.descriptionLabel")} htmlFor="task-desc" className="sm:col-span-2 lg:col-span-4">
        <Textarea id="task-desc" rows={3} maxLength={5000} value={v.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="primary" disabled={pending || !v.clientId}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {v.id ? t("ui.save") : t("tasks.create")}
        </Button>
        {onClose && (
          <Button type="button" variant="ghost" onClick={() => router.push(onClose)}>
            {t("ui.cancel")}
          </Button>
        )}
        {v.id && (
          <Button
            type="button"
            variant="ghost"
            className="ms-auto text-bad"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(t("tasks.confirmDelete"))) return;
              start(async () => {
                const r = await deleteTask(v.id);
                if (r.ok) router.push(onClose ?? "/tasks");
                else setResult({ tone: "bad", text: errorText(r.error) });
              });
            }}
          >
            <Trash2 className="size-4" aria-hidden /> {t("ui.delete")}
          </Button>
        )}
        <ResultLine result={result} />
      </div>
    </form>
  );
}
