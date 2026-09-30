import { CalendarClock, ExternalLink, Film, Megaphone } from "lucide-react";
import type { ContentDTO } from "@/lib/content/queries";
import { fmtDateTime, fmtMoney, type Locale } from "@/lib/format";
import { Badge, cx } from "@/components/ui/primitives";
import { StatusBadge } from "./status-badge";
import { AssetThumb } from "./asset-thumb";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Social-post style preview (used for client approval and read-only viewers). */
export function ContentPreview({ item, t, locale, clientName, currency, className }: { item: ContentDTO; t: T; locale: Locale; clientName?: string; currency?: string; className?: string }) {
  const firstAsset = item.assetUrls[0];
  return (
    <article className={cx("overflow-hidden rounded-card border border-border bg-surface", className)}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="font-semibold">{clientName ?? t(`platform.${item.platform}`)}</span>
        <Badge tone="neutral">{t(`platform.${item.platform}`)}</Badge>
        <Badge tone="neutral">{t(`contentType.${item.type}`)}</Badge>
        {item.isPaid && (
          <Badge tone="brand">
            <Megaphone className="size-3" aria-hidden /> {t("filter.paid")}
            {item.boostBudget != null && <span className="num">· {fmtMoney(item.boostBudget, currency ?? "EGP", locale)}</span>}
          </Badge>
        )}
        <StatusBadge status={item.status} label={t(`contentStatus.${item.status}`)} className="ms-auto" />
      </header>
      {firstAsset && <AssetThumb url={firstAsset} alt={item.title} className="aspect-video w-full bg-surface-2 object-cover" />}
      {!firstAsset && (item.designUrl || item.videoUrl) && (
        <div className="flex flex-wrap gap-3 bg-surface-2 px-3 py-4 text-xs">
          {item.designUrl && (
            <a href={item.designUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
              <ExternalLink className="size-3.5" aria-hidden /> {t("content.field.designUrl")}
            </a>
          )}
          {item.videoUrl && (
            <a href={item.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
              <Film className="size-3.5" aria-hidden /> {t("content.field.videoUrl")}
            </a>
          )}
        </div>
      )}
      <div className="space-y-2 px-3 py-3 text-sm">
        <p className="font-semibold">{item.title}</p>
        {item.hook && <p className="font-medium">{item.hook}</p>}
        {item.caption && <p className="whitespace-pre-wrap text-text/90">{item.caption}</p>}
        {item.hashtags.length > 0 && <p className="text-xs text-info">{item.hashtags.join(" ")}</p>}
        {item.cta && <span className="inline-block rounded-md bg-brand-soft px-2 py-1 text-xs font-medium text-brand">{item.cta}</span>}
        <p className="flex items-center gap-1 text-xs text-muted">
          <CalendarClock className="size-3.5" aria-hidden />
          {item.publishAt ? <span className="num">{fmtDateTime(item.publishAt, locale, item.timezone)}</span> : t("content.unscheduled")}
          <span className="text-subtle">({item.timezone})</span>
        </p>
      </div>
    </article>
  );
}
