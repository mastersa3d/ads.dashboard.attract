"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, EmptyState, Field, Input, Select, cx, inputClass } from "@/components/ui/primitives";
import { deleteAccount, saveAccount } from "@/app/actions/accounts";
import { ResultLine, useErrorText } from "./action-button";

export type AccountRow = {
  id: string;
  clientId: string;
  platform: string;
  name: string;
  externalId: string;
  currency: string;
  timezone: string;
  country: string | null;
  brandId: string | null;
  integrationId: string | null;
  isOrganic: boolean;
  source: string;
  campaigns: number;
};

export type AccountClient = { id: string; name: string; currency: string; timezone: string; country: string | null; brands: { id: string; name: string }[] };
export type AccountIntegration = { id: string; label: string; clientId: string | null; platform: string };

type Draft = Omit<AccountRow, "source" | "campaigns" | "id"> & { id?: string };

const PLATFORMS = ["META", "FACEBOOK", "INSTAGRAM", "GOOGLE_ADS", "TIKTOK", "LINKEDIN", "YOUTUBE", "X", "GA4", "SEARCH_CONSOLE"];
const ORGANIC_DEFAULT = new Set(["FACEBOOK", "INSTAGRAM", "YOUTUBE", "X", "SEARCH_CONSOLE", "GA4"]);

/** Add / edit / delete ad accounts and pages for the clients the user can access. */
export function AccountsManager({ accounts, clients, integrations, canEdit, initialClient = "" }: { accounts: AccountRow[]; clients: AccountClient[]; integrations: AccountIntegration[]; canEdit: boolean; initialClient?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [clientFilter, setClientFilter] = useState(initialClient);
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const shown = clientFilter ? accounts.filter((a) => a.clientId === clientFilter) : accounts;
  const client = clients.find((c) => c.id === draft?.clientId);
  const integrationOptions = integrations.filter((i) => i.clientId === draft?.clientId);

  const message = (err: string) => (err.startsWith("integrations.") ? t(err) : errorText(err));

  function newDraft(): Draft {
    const c = clients.find((x) => x.id === clientFilter) ?? clients[0];
    return { clientId: c?.id ?? "", platform: "META", name: "", externalId: "", currency: c?.currency ?? "EGP", timezone: c?.timezone ?? "Africa/Cairo", country: c?.country ?? null, brandId: null, integrationId: null, isOrganic: false };
  }

  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    start(async () => {
      const r = await saveAccount({ ...draft, country: draft.country ?? undefined, brandId: draft.brandId ?? undefined, integrationId: draft.integrationId ?? undefined });
      setResult(r.ok ? { tone: "good", text: t("integrations.accounts.saved") } : { tone: "bad", text: message(r.error) });
      if (r.ok) {
        setDraft(null);
        router.refresh();
      }
    });
  }

  function remove(a: AccountRow) {
    if (!window.confirm(t("integrations.accounts.deleteConfirm", { name: a.name, campaigns: a.campaigns }))) return;
    start(async () => {
      const r = await deleteAccount(a.id);
      setResult(r.ok ? { tone: "good", text: t("integrations.accounts.deleted") } : { tone: "bad", text: message(r.error) });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("integrations.client")} htmlFor="acc-filter" className="w-full max-w-xs">
          <Select id="acc-filter" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} options={clients.map((c) => ({ value: c.id, label: c.name }))} placeholder={t("filter.allClients")} />
        </Field>
        {canEdit && clients.length > 0 && (
          <Button variant="primary" onClick={() => setDraft(newDraft())} disabled={pending}>
            <Plus className="size-4" aria-hidden /> {t("integrations.accounts.add")}
          </Button>
        )}
      </div>

      {canEdit && clients.length === 0 && <p className="text-sm text-muted">{t("integrations.accounts.noClients")}</p>}

      {draft && (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-brand/40 bg-brand-soft/30 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{draft.id ? t("integrations.accounts.edit") : t("integrations.accounts.add")}</h4>
            <button type="button" onClick={() => setDraft(null)} className="rounded p-1 hover:bg-surface-2" aria-label={t("ui.close")}>
              <X className="size-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("integrations.client")} htmlFor="acc-client">
              <Select
                id="acc-client"
                value={draft.clientId}
                disabled={Boolean(draft.id)}
                onChange={(e) => {
                  const c = clients.find((x) => x.id === e.target.value);
                  setDraft((d) => (d ? { ...d, clientId: e.target.value, brandId: null, integrationId: null, currency: c?.currency ?? d.currency, timezone: c?.timezone ?? d.timezone, country: c?.country ?? d.country } : d));
                }}
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label={t("filter.platform")} htmlFor="acc-platform">
              <Select
                id="acc-platform"
                value={draft.platform}
                onChange={(e) => setDraft((d) => (d ? { ...d, platform: e.target.value, isOrganic: d.id ? d.isOrganic : ORGANIC_DEFAULT.has(e.target.value) } : d))}
                options={PLATFORMS.map((p) => ({ value: p, label: t(`platform.${p}`) }))}
              />
            </Field>
            <Field label={t("integrations.accounts.name")} htmlFor="acc-name">
              <Input id="acc-name" required maxLength={160} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={t("integrations.accounts.namePh")} />
            </Field>
            <Field label={t("integrations.accounts.externalId")} htmlFor="acc-ext" hint={t("integrations.accounts.externalIdHint")}>
              <Input id="acc-ext" required maxLength={200} dir="ltr" value={draft.externalId} onChange={(e) => set("externalId", e.target.value)} placeholder="act_1234567890" />
            </Field>
            <Field label={t("filter.currency")} htmlFor="acc-cur">
              <Input id="acc-cur" required dir="ltr" maxLength={3} value={draft.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
            </Field>
            <Field label={t("integrations.accounts.timezone")} htmlFor="acc-tz">
              <Input id="acc-tz" required dir="ltr" maxLength={64} value={draft.timezone} onChange={(e) => set("timezone", e.target.value)} />
            </Field>
            <Field label={t("filter.brand")} htmlFor="acc-brand">
              <Select id="acc-brand" value={draft.brandId ?? ""} onChange={(e) => set("brandId", e.target.value || null)} options={(client?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} placeholder={t("ui.none")} />
            </Field>
            <Field label={t("integrations.accounts.integration")} htmlFor="acc-integ" hint={t("integrations.accounts.integrationHint")}>
              <Select id="acc-integ" value={draft.integrationId ?? ""} onChange={(e) => set("integrationId", e.target.value || null)} options={integrationOptions.map((i) => ({ value: i.id, label: i.label }))} placeholder={t("ui.none")} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.isOrganic} onChange={(e) => set("isOrganic", e.target.checked)} /> {t("integrations.accounts.isOrganic")}
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={pending || !draft.clientId}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} {t("ui.save")}
            </Button>
            <Button type="button" onClick={() => setDraft(null)}>
              {t("ui.cancel")}
            </Button>
          </div>
        </form>
      )}

      <ResultLine result={result} />

      {shown.length === 0 ? (
        <EmptyState title={t("integrations.accounts.none")} hint={t("integrations.accounts.noneHint")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                {[t("integrations.accounts.name"), t("integrations.client"), t("filter.platform"), t("integrations.accounts.externalId"), t("filter.currency"), t("integrations.accounts.type"), t("ui.source"), ...(canEdit ? [t("ui.actions")] : [])].map((h) => (
                  <th key={h} className="px-3 py-2 text-start font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className={cx("border-b border-border/60 last:border-0", draft?.id === a.id && "bg-brand-soft/40")}>
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  <td className="px-3 py-2 text-muted">{clientName.get(a.clientId)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{t(`platform.${a.platform}`)}</td>
                  <td className="num px-3 py-2 text-xs text-muted">{a.externalId}</td>
                  <td className="num px-3 py-2">{a.currency}</td>
                  <td className="px-3 py-2">
                    <Badge tone={a.isOrganic ? "info" : "brand"}>{a.isOrganic ? t("filter.organic") : t("filter.paid")}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={a.source === "DEMO" ? "demo" : a.source === "API" ? "good" : "neutral"}>{t(`source.${a.source}`)}</Badge>
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className={cx(inputClass, "h-8 w-auto px-2")}
                          onClick={() => setDraft({ id: a.id, clientId: a.clientId, platform: a.platform, name: a.name, externalId: a.externalId, currency: a.currency, timezone: a.timezone, country: a.country, brandId: a.brandId, integrationId: a.integrationId, isOrganic: a.isOrganic })}
                          aria-label={t("ui.edit")}
                          title={t("ui.edit")}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button type="button" className={cx(inputClass, "h-8 w-auto px-2 text-bad")} onClick={() => remove(a)} aria-label={t("ui.delete")} title={t("ui.delete")} disabled={pending}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
