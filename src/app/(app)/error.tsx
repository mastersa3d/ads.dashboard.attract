"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, ErrorState } from "@/components/ui/primitives";

/** Route-level error boundary for every app page. Details are logged server-side, never shown. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card>
      <ErrorState
        title={t("ui.error")}
        hint={`${t("ui.errorHint")}${error.digest ? ` (ref: ${error.digest})` : ""}`}
        action={
          <Button variant="primary" onClick={reset}>
            {t("ui.retry")}
          </Button>
        }
      />
    </Card>
  );
}
