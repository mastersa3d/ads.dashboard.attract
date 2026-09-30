"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { updateLine } from "@/app/actions/budget";
import { Button, Input, Select } from "@/components/ui/primitives";

export type EditableLine = { id: string; label: string; plannedBudget: number; campaignId: string | null; notes: string | null; platform: string | null };

/** Manual fine-tuning of saved lines (budget, campaign link, notes). Planned results scale with the budget. */
export function LineEditor({ lines, campaigns, currency }: { lines: EditableLine[]; campaigns: { id: string; name: string; platform: string }[]; currency: string }) {
  const { t } = useI18n();
  return (
    <div className="divide-y divide-border">
      {lines.map((l) => (
        <Row key={l.id} line={l} campaigns={campaigns.filter((c) => !l.platform || c.platform === l.platform)} currency={currency} t={t} />
      ))}
    </div>
  );
}

function Row({ line, campaigns, currency, t }: { line: EditableLine; campaigns: { id: string; name: string }[]; currency: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  const [budget, setBudget] = useState(String(line.plannedBudget));
  const [campaignId, setCampaignId] = useState(line.campaignId ?? "");
  const [notes, setNotes] = useState(line.notes ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = Number(budget) !== line.plannedBudget || (campaignId || null) !== line.campaignId || (notes || null) !== line.notes;

  return (
    <form
      className="grid items-end gap-2 py-3 sm:grid-cols-[minmax(0,1.4fr)_140px_minmax(0,1fr)_minmax(0,1fr)_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateLine({ lineId: line.id, plannedBudget: Number(budget), campaignId: campaignId || null, notes: notes || null });
          setMsg(res.ok ? t("ui.saved") : t(`budget.error.${res.error}`));
        });
      }}
    >
      <p className="truncate text-sm font-medium" title={line.label}>
        {line.label}
      </p>
      <label className="text-xs text-muted">
        <span className="sr-only">{t("budget.planned")}</span>
        <Input type="number" min={0} step="any" className="num" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label={`${t("budget.planned")} (${currency}) — ${line.label}`} />
      </label>
      <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} placeholder={t("budget.noCampaign")} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} aria-label={`${t("filter.campaign")} — ${line.label}`} />
      <Input value={notes} maxLength={1000} placeholder={t("ui.notes")} onChange={(e) => setNotes(e.target.value)} aria-label={`${t("ui.notes")} — ${line.label}`} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending || !dirty || !(Number(budget) >= 0)}>
          {t("ui.save")}
        </Button>
        {msg && <span className="text-[11px] text-muted">{msg}</span>}
      </div>
    </form>
  );
}
