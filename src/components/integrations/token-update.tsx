"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { ResultLine } from "./action-button";
import { TokenForm } from "./integration-controls";

/** "Update token" toggle used in the API Tokens table. */
export function TokenUpdate({ integrationId }: { integrationId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  return (
    <div className="space-y-2 no-print">
      <Button size="sm" variant={open ? "primary" : "secondary"} onClick={() => setOpen(!open)} aria-expanded={open}>
        <KeyRound className="size-3.5" aria-hidden /> {t("integrations.updateToken")}
      </Button>
      <ResultLine result={result} />
      {open && (
        <div className="min-w-72">
          <TokenForm
            integrationId={integrationId}
            onDone={(r) => {
              setResult(r);
              if (r.tone === "good") setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
