"use client";

import { useEffect, useState } from "react";
import type { Platform } from "@prisma/client";
import { Lightbulb } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { getBestTime } from "@/app/actions/content";
import type { BestTimeResult } from "@/lib/content/best-time";
import { Button, Skeleton } from "@/components/ui/primitives";
import { BestTimeView } from "./best-time-view";

/**
 * Best-time suggestion inside the editor. Re-queries when client / platform / timezone / chosen
 * time change; "Use this time" applies it, "Ignore" hides it — the suggestion is never forced.
 */
export function BestTimePanel({
  clientId,
  platform,
  timezone,
  chosenLocal,
  onApply,
}: {
  clientId: string;
  platform: string;
  timezone: string;
  chosenLocal: string | null;
  onApply?: (weekday: number, hour: number) => void;
}) {
  const { t, locale } = useI18n();
  const [result, setResult] = useState<BestTimeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!clientId || hidden) return;
    let cancelled = false;
    const h = setTimeout(async () => {
      setLoading(true);
      const res = await getBestTime({ clientId, platform: (platform || null) as Platform | null, timezone, chosenLocal });
      if (cancelled) return;
      setLoading(false);
      setFailed(!res.ok);
      setResult(res.ok ? res.result : null);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [clientId, platform, timezone, chosenLocal, hidden]);

  if (hidden) {
    return (
      <button type="button" className="inline-flex items-center gap-1 text-xs text-brand hover:underline" onClick={() => setHidden(false)}>
        <Lightbulb className="size-3.5" aria-hidden /> {t("content.bt.show")}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Lightbulb className="size-3.5 text-warn" aria-hidden /> {t("content.bt.title")}
        </p>
        <button type="button" className="text-xs text-muted hover:text-text" onClick={() => setHidden(true)}>
          {t("content.bt.ignore")}
        </button>
      </div>
      {loading && !result ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : failed || !result ? (
        <p className="text-xs text-muted">{t("content.bt.unavailable")}</p>
      ) : (
        <BestTimeView
          result={result}
          t={t}
          locale={locale}
          compact
          action={
            onApply ? (
              <Button type="button" size="sm" onClick={() => onApply(result.weekday, result.hour)}>
                {t("content.bt.apply")}
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
