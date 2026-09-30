"use client";

import Link from "next/link";
import { FileUp, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Callout, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { importTrendsCsv, saveSignal, syncSearchConsole } from "@/app/actions/trends";
import { ActionForm } from "@/components/competitors/action-form";
import { SIGNAL_KINDS } from "@/lib/trends/signals";

/** Manual trend-signal entry. */
export function SignalForm({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  return (
    <ActionForm action={saveSignal} hidden={{ clientId }} submitLabel={t("ui.add")} resetOnOk>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`${t("trends.signal.keyword")} *`} htmlFor="sig-kw">
          <Input id="sig-kw" name="keyword" required maxLength={160} />
        </Field>
        <Field label={`${t("trends.signal.kind")} *`} htmlFor="sig-kind">
          <Select id="sig-kind" name="kind" defaultValue="SEARCH" options={SIGNAL_KINDS.map((k) => ({ value: k, label: t(`trends.kind.${k}`) }))} />
        </Field>
        <Field label={`${t("ui.source")} *`} htmlFor="sig-src" hint={t("trends.signal.sourceHint")}>
          <Input id="sig-src" name="sourceName" required maxLength={80} defaultValue={t("source.MANUAL")} />
        </Field>
        <Field label={t("trends.signal.sourceUrl")} htmlFor="sig-url">
          <Input id="sig-url" name="sourceUrl" type="url" placeholder="https://" />
        </Field>
        <Field label={t("trends.signal.growthPct")} htmlFor="sig-g" hint={t("trends.signal.growthHint")}>
          <Input id="sig-g" name="growthPct" type="number" step="0.1" />
        </Field>
        <Field label={t("trends.signal.volumeIndex")} htmlFor="sig-v" hint={t("trends.signal.volumeHint")}>
          <Input id="sig-v" name="volumeIndex" type="number" min={0} max={100} />
        </Field>
        <Field label={t("trends.signal.validUntil")} htmlFor="sig-exp">
          <Input id="sig-exp" name="expiresAt" type="date" min={new Date().toISOString().slice(0, 10)} />
        </Field>
      </div>
    </ActionForm>
  );
}

/** Google Trends CSV import (file or pasted text). */
export function CsvImport({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  return (
    <ActionForm
      action={importTrendsCsv}
      hidden={{ clientId }}
      submitLabel={
        <>
          <FileUp className="size-4" aria-hidden /> {t("trends.import.button")}
        </>
      }
      resetOnOk
    >
      <p className="text-xs text-muted">{t("trends.import.hint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("trends.import.file")} htmlFor="csv-file">
          <input id="csv-file" name="file" type="file" accept=".csv,text/csv" className="block w-full text-sm file:me-3 file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm" />
        </Field>
        <Field label={t("trends.import.topKind")} htmlFor="csv-kind" hint={t("trends.import.topKindHint")}>
          <Select
            id="csv-kind"
            name="topKind"
            defaultValue="SEARCH"
            options={[
              { value: "SEARCH", label: t("trends.import.queries") },
              { value: "TOPIC", label: t("trends.import.topics") },
            ]}
          />
        </Field>
        <Field label={t("trends.import.region")} htmlFor="csv-region" hint={t("ui.optional")}>
          <Input id="csv-region" name="region" maxLength={80} />
        </Field>
        <Field label={t("trends.import.validDays")} htmlFor="csv-days">
          <Input id="csv-days" name="validDays" type="number" min={1} max={365} defaultValue={30} />
        </Field>
      </div>
      <Field label={t("trends.import.paste")} htmlFor="csv-text" hint={t("trends.import.pasteHint")}>
        <Textarea id="csv-text" name="text" rows={4} dir="ltr" className="font-mono text-xs" placeholder={"TOP\nmodern sofa,100\n\nRISING\njapandi sofa,Breakout"} />
      </Field>
    </ActionForm>
  );
}

/** Search Console queries — only through a connected integration. */
export function SearchConsoleCard({ clientId, state, site, lastSync, canManage, canEdit }: { clientId: string; state: "CONNECTED" | "NOT_CONNECTED" | "EXPIRED" | "NO_SITE"; site?: string; lastSync?: string | null; canManage: boolean; canEdit: boolean }) {
  const { t } = useI18n();
  if (state !== "CONNECTED")
    return (
      <Callout tone="info" title={t(`trends.sc.state.${state}`)}>
        <p className="text-xs">{t("trends.sc.disabledHint")}</p>
        {canManage && (
          <Link href="/settings?tab=integrations" className="mt-1 inline-block text-xs font-medium text-brand hover:underline">
            {t("trends.sc.connect")}
          </Link>
        )}
      </Callout>
    );
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {t("trends.sc.connectedTo")} <span dir="ltr" className="font-medium text-text">{site}</span>
        {lastSync && <> · {t("ui.lastUpdated")}: {lastSync}</>}
      </p>
      {canEdit && (
        <ActionForm
          action={syncSearchConsole}
          hidden={{ clientId }}
          submitVariant="secondary"
          submitLabel={
            <>
              <RefreshCw className="size-4" aria-hidden /> {t("trends.sc.sync")}
            </>
          }
        />
      )}
    </div>
  );
}
