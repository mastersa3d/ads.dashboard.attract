"use client";

import { useState } from "react";
import { FileText } from "lucide-react";

const looksLikeImage = (u: string) => u.startsWith("/api/uploads/") || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u);

/**
 * Thumbnail for an uploaded (/api/uploads/…) or linked asset. Uploads may be video / PDF, so an
 * image that fails to decode falls back to a file chip.
 */
export function AssetThumb({ url, alt, className, label }: { url: string; alt: string; className?: string; label?: string }) {
  const [broken, setBroken] = useState(!looksLikeImage(url));
  if (broken) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 px-3 py-4 text-xs text-brand hover:underline">
        <FileText className="size-4 shrink-0" aria-hidden /> <span className="truncate">{label ?? url}</span>
      </a>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin file route; next/image can't forward the session cookie
  return <img src={url} alt={alt} loading="lazy" className={className} onError={() => setBroken(true)} />;
}
