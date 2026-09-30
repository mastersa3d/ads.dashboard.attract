"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmtDate, fmtMoney } from "@/lib/format";
import { addExpense, deleteExpense } from "@/app/actions/budget";
import { Button, Callout, EmptyState, Field, Input, Select, SimpleTable } from "@/components/ui/primitives";

export type ExpenseView = { id: string; date: string; description: string; amount: number; currency: string; amountPlan: number; lineLabel: string | null };

/** Manual (non-platform) costs: production, fees, tools. Converted to the plan currency for totals. */
export function ExpensesPanel({
  clientId,
  planCurrency,
  currencies,
  lines,
  expenses,
  canEdit,
  defaultDate,
}: {
  clientId: string;
  planCurrency: string;
  currencies: string[];
  lines: { id: string; label: string }[];
  expenses: ExpenseView[];
  canEdit: boolean;
  defaultDate: string;
}) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ date: defaultDate, amount: "", currency: planCurrency, description: "", planLineId: "" });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await addExpense({ clientId, planLineId: form.planLineId || null, date: form.date, amount: Number(form.amount), currency: form.currency, description: form.description });
      if (res.ok) setForm((f) => ({ ...f, amount: "", description: "" }));
      else setError(t(`budget.error.${res.error}`));
    });
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-6 no-print">
          <Field label={t("ui.date")} htmlFor="ex-date">
            <Input id="ex-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label={t("budget.expense.description")} htmlFor="ex-desc" className="lg:col-span-2">
            <Input id="ex-desc" required maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label={t("budget.expense.amount")} htmlFor="ex-amount">
            <Input id="ex-amount" type="number" required min={0.01} step="any" className="num" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label={t("filter.currency")} htmlFor="ex-cur">
            <Select id="ex-cur" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} options={currencies.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label={t("budget.line")} htmlFor="ex-line">
            <Select id="ex-line" value={form.planLineId} placeholder={t("budget.expense.unassigned")} onChange={(e) => setForm({ ...form, planLineId: e.target.value })} options={lines.map((l) => ({ value: l.id, label: l.label }))} />
          </Field>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              <Plus className="size-3.5" aria-hidden /> {t("budget.expense.add")}
            </Button>
            {error && (
              <span role="alert" className="text-xs text-bad">
                {error}
              </span>
            )}
          </div>
        </form>
      )}
      {expenses.length === 0 ? (
        <EmptyState title={t("budget.expense.none")} hint={t("budget.expense.noneHint")} />
      ) : (
        <SimpleTable
          head={[t("ui.date"), t("budget.expense.description"), t("budget.line"), t("budget.expense.amount"), t("budget.expense.inPlanCurrency", { currency: planCurrency }), ...(canEdit ? [""] : [])]}
          rows={expenses.map((e) => [
            <span key="d" className="whitespace-nowrap">{fmtDate(e.date, locale)}</span>,
            e.description,
            e.lineLabel ?? <span key="u" className="text-subtle">{t("budget.expense.unassigned")}</span>,
            <span key="a" className="num whitespace-nowrap">{fmtMoney(e.amount, e.currency, locale)}</span>,
            <span key="p" className="num whitespace-nowrap">{fmtMoney(e.amountPlan, planCurrency, locale)}</span>,
            ...(canEdit
              ? [
                  <button
                    key="x"
                    type="button"
                    disabled={pending}
                    onClick={() => window.confirm(t("budget.expense.confirmDelete")) && start(async () => void (await deleteExpense({ expenseId: e.id })))}
                    className="rounded p-1 text-muted hover:bg-bad-soft hover:text-bad no-print"
                    aria-label={t("ui.delete")}
                  >
                    <Trash2 className="size-3.5" />
                  </button>,
                ]
              : []),
          ])}
        />
      )}
      {expenses.some((e) => e.currency !== planCurrency) && <Callout tone="info">{t("budget.expense.fxNote")}</Callout>}
    </div>
  );
}
