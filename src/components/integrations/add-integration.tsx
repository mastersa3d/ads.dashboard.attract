"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { ResultLine, useErrorText } from "./action-button";
import { createIntegration } from "@/app/actions/integrations";

export type ConnectorOption = { id: string; name: string; orgWide: boolean };

export function AddIntegrationForm({ connectors, clients }: { connectors: ConnectorOption[]; clients: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [connectorId, setConnectorId] = useState(connectors[0]?.id ?? "");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const connector = connectors.find((c) => c.id === connectorId);
  const client = clients.find((c) => c.id === clientId);
  const suggested = [client?.name, connector?.name].filter(Boolean).join(" – ");

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createIntegration({ connectorId, clientId: clientId || null, label: label.trim() || suggested });
          setResult(r.ok ? { tone: "good", text: t("integrations.created") } : { tone: "bad", text: errorText(r.error) });
          if (r.ok) {
            setLabel("");
            router.refresh();
          }
        });
      }}
    >
      <Field label={t("integrations.connector")} htmlFor="add-connector">
        <Select id="add-connector" value={connectorId} onChange={(e) => setConnectorId(e.target.value)} options={connectors.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Field label={t("integrations.client")} htmlFor="add-client">
        <Select
          id="add-client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          options={[...(connector?.orgWide ? [{ value: "", label: t("integrations.orgWide") }] : []), ...clients.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </Field>
      <Field label={t("integrations.label")} htmlFor="add-label">
        <Input id="add-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder={suggested || t("integrations.labelPlaceholder")} />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={pending || !connectorId || (!clientId && !connector?.orgWide)}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />} {t("integrations.add")}
        </Button>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <ResultLine result={result} />
      </div>
    </form>
  );
}
