"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { deleteReport } from "@/app/actions/reports";

export function DeleteReportButton({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className="text-bad"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(t("reports.confirmDelete"))) return;
        start(async () => {
          const r = await deleteReport(id);
          if (r.ok) router.push("/reports");
        });
      }}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />} {t("ui.delete")}
    </Button>
  );
}
