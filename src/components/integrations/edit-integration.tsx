"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { updateIntegration } from "@/app/actions/accounts";
import { ResultLine, useErrorText } from "./action-button";

/** Rename an integration or move it to another client (while it has no linked accounts). */
export function EditIntegration({ id, label, clientId, orgWide, hasAccounts, clients }: { id: string; label: string; clientId: string | null; orgWide: boolean; hasAccounts: boolean; clients: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(label);
  const [client, setClient] = useState(clientId ?? "");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" aria-hidden /> {t("ui.edit")}
      </Button>
    );

  return (
    <form
      className="w-full space-y-2 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateIntegration({ integrationId: id, label: name, clientId: client || null });
          if (r.ok) {
            setOpen(false);
            router.refresh();
          } else setResult({ tone: "bad", text: r.error.startsWith("integrations.") ? t(r.error) : errorText(r.error) });
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t("integrations.label")} htmlFor={`ei-l-${id}`}>
          <Input id={`ei-l-${id}`} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("integrations.client")} htmlFor={`ei-c-${id}`} hint={hasAccounts ? t("integrations.accounts.noMoveIntegration") : undefined}>
          <Select id={`ei-c-${id}`} value={client} disabled={hasAccounts} onChange={(e) => setClient(e.target.value)} options={[...(orgWide ? [{ value: "", label: t("integrations.orgWide") }] : []), ...clients.map((c) => ({ value: c.id, label: c.name }))]} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />} {t("ui.save")}
        </Button>
        <Button type="button" size="sm" onClick={() => setOpen(false)}>
          {t("ui.cancel")}
        </Button>
      </div>
      <ResultLine result={result} />
    </form>
  );
}
