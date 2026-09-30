"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, KeyRound, Link2, ListChecks, Loader2, Plug, Power, RefreshCw, ShieldCheck, Trash2, Unplug } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, buttonClass, cx } from "@/components/ui/primitives";
import { ActionButton, ResultLine, useErrorText } from "./action-button";
import {
  deleteIntegration,
  disconnectIntegration,
  fetchRemoteAccounts,
  saveLinkedAccounts,
  saveManualToken,
  setEnabled,
  syncNow,
  testConnection,
} from "@/app/actions/integrations";

export type ControlsProps = {
  id: string;
  connectorId: string;
  oauth: boolean;
  configured: boolean;
  manualToken: boolean;
  hasToken: boolean;
  enabled: boolean;
  syncable: boolean;
  listable: boolean;
  needsReconnect: boolean;
};

/** Action bar of an integration card (Super Admin only — rendered only with integrations:manage). */
export function IntegrationControls(p: ControlsProps) {
  const { t } = useI18n();
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [panel, setPanel] = useState<"token" | "accounts" | null>(null);
  const connectLabel = p.hasToken || p.needsReconnect ? t("integrations.reconnect") : t("integrations.connect");

  return (
    <div className="space-y-3 no-print">
      <div className="flex flex-wrap gap-1.5">
        {p.oauth && (
          <a
            href={`/api/oauth/${p.connectorId}/start?integration=${p.id}`}
            className={cx(buttonClass(p.needsReconnect || !p.hasToken ? "primary" : "secondary", "sm"), !p.configured && "pointer-events-none opacity-50")}
            aria-disabled={!p.configured}
          >
            <Plug className="size-3.5" aria-hidden /> {connectLabel}
          </a>
        )}
        <ActionButton
          action={() => testConnection(p.id)}
          onDone={setResult}
          success={(d) => (d?.missing?.length ? t("integrations.result.testOkMissing", { scopes: d.missing.join(", ") }) : t("integrations.result.testOk"))}
        >
          <ShieldCheck className="size-3.5" aria-hidden /> {t("integrations.test")}
        </ActionButton>
        {p.syncable && (
          <ActionButton
            action={() => syncNow(p.id)}
            onDone={setResult}
            disabled={!p.enabled || !p.hasToken}
            success={(d) => (d?.deduped ? t("integrations.result.syncAlreadyQueued") : t("integrations.result.syncQueued"))}
          >
            <RefreshCw className="size-3.5" aria-hidden /> {t("integrations.syncNow")}
          </ActionButton>
        )}
        {p.manualToken && (
          <Button size="sm" variant={panel === "token" ? "primary" : "secondary"} onClick={() => setPanel(panel === "token" ? null : "token")} aria-expanded={panel === "token"}>
            <KeyRound className="size-3.5" aria-hidden /> {t("integrations.updateToken")}
          </Button>
        )}
        {p.listable && p.hasToken && (
          <Button size="sm" variant={panel === "accounts" ? "primary" : "secondary"} onClick={() => setPanel(panel === "accounts" ? null : "accounts")} aria-expanded={panel === "accounts"}>
            <ListChecks className="size-3.5" aria-hidden /> {t("integrations.chooseAccounts")}
          </Button>
        )}
        <ActionButton
          action={() => setEnabled({ integrationId: p.id, enabled: !p.enabled })}
          onDone={setResult}
          success={() => (p.enabled ? t("integrations.result.disabled") : t("integrations.result.enabled"))}
        >
          <Power className="size-3.5" aria-hidden /> {p.enabled ? t("integrations.disable") : t("integrations.enable")}
        </ActionButton>
        <Link href={`/settings/integrations?tab=sync&integration=${p.id}`} className={buttonClass("ghost", "sm")}>
          <History className="size-3.5" aria-hidden /> {t("integrations.history")}
        </Link>
        {p.hasToken && (
          <ActionButton action={() => disconnectIntegration(p.id)} onDone={setResult} variant="ghost" confirm={t("integrations.confirmDisconnect")} success={() => t("integrations.result.disconnected")}>
            <Unplug className="size-3.5" aria-hidden /> {t("integrations.disconnect")}
          </ActionButton>
        )}
        <ActionButton action={() => deleteIntegration(p.id)} onDone={setResult} variant="ghost" className="text-bad" confirm={t("integrations.confirmDelete")} success={() => t("integrations.result.deleted")}>
          <Trash2 className="size-3.5" aria-hidden /> {t("integrations.delete")}
        </ActionButton>
      </div>
      <ResultLine result={result} />
      {panel === "token" && <TokenForm integrationId={p.id} onDone={(r) => { setResult(r); if (r.tone === "good") setPanel(null); }} />}
      {panel === "accounts" && <AccountPicker integrationId={p.id} onDone={(r) => { setResult(r); if (r.tone === "good") setPanel(null); }} />}
    </div>
  );
}

/** Manual long-lived token entry. The value lives only in this form and is cleared after submit. */
export function TokenForm({ integrationId, onDone }: { integrationId: string; onDone: (r: { tone: "good" | "bad"; text: string }) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 rounded-lg border border-border bg-surface-2/50 p-3 sm:grid-cols-2"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await saveManualToken({
            integrationId,
            accessToken: String(fd.get("accessToken") ?? ""),
            refreshToken: String(fd.get("refreshToken") ?? ""),
            expiresAt: String(fd.get("expiresAt") ?? ""),
          });
          form.reset();
          onDone(r.ok ? { tone: "good", text: t("integrations.result.tokenSaved") } : { tone: "bad", text: errorText(r.error) });
          router.refresh();
        });
      }}
    >
      <p className="text-xs text-muted sm:col-span-2">{t("integrations.manualHint")}</p>
      <Field label={t("integrations.tokenInput")} htmlFor={`tok-${integrationId}`} className="sm:col-span-2">
        <Input id={`tok-${integrationId}`} name="accessToken" type="password" required minLength={10} autoComplete="new-password" spellCheck={false} placeholder={t("integrations.tokenPlaceholder")} />
      </Field>
      <Field label={t("integrations.refreshTokenInput")} htmlFor={`rt-${integrationId}`}>
        <Input id={`rt-${integrationId}`} name="refreshToken" type="password" autoComplete="new-password" spellCheck={false} />
      </Field>
      <Field label={t("integrations.expiresAtInput")} htmlFor={`exp-${integrationId}`}>
        <Input id={`exp-${integrationId}`} name="expiresAt" type="date" />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t("ui.save")}
        </Button>
      </div>
    </form>
  );
}

/** Loads the accounts visible to the stored login and lets the admin choose which to sync. */
export function AccountPicker({ integrationId, onDone }: { integrationId: string; onDone: (r: { tone: "good" | "bad"; text: string }) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [accounts, setAccounts] = useState<{ externalId: string; name: string; currency?: string | null; linked: boolean }[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2/50 p-3">
      {accounts === null ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await fetchRemoteAccounts(integrationId);
              if (!r.ok) return onDone({ tone: "bad", text: errorText(r.error) });
              setAccounts(r.data?.accounts ?? []);
              setChosen(new Set((r.data?.accounts ?? []).filter((a) => a.linked).map((a) => a.externalId)));
            })
          }
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />} {t("integrations.loadAccounts")}
        </Button>
      ) : accounts.length === 0 ? (
        <p className="text-xs text-muted">{t("integrations.noRemoteAccounts")}</p>
      ) : (
        <>
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {accounts.map((a) => (
              <li key={a.externalId}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--brand)]"
                    checked={chosen.has(a.externalId)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(a.externalId);
                      else next.delete(a.externalId);
                      setChosen(next);
                    }}
                  />
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="num text-xs text-subtle">{a.externalId}</span>
                  {a.currency && <span className="text-xs text-subtle">{a.currency}</span>}
                </label>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveLinkedAccounts({ integrationId, externalIds: [...chosen] });
                onDone(r.ok ? { tone: "good", text: t("integrations.result.accountsSaved") } : { tone: "bad", text: errorText(r.error) });
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("integrations.saveAccounts")}
          </Button>
        </>
      )}
    </div>
  );
}
