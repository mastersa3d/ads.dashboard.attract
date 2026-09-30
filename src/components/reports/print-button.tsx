"use client";

import { Printer } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";

/** "Save as PDF" through the browser's print dialog (print stylesheet keeps RTL + Arabic shaping). */
export function PrintButton() {
  const { t } = useI18n();
  return (
    <Button onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> {t("ui.exportPdf")}
    </Button>
  );
}
