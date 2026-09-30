import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Drill path breadcrumb; the last crumb is the current level (not a link). */
export function Breadcrumb({ items, label }: { items: { label: string; href?: string; hint?: string }[]; label: string }) {
  return (
    <nav aria-label={label} className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-subtle flip-rtl" aria-hidden />}
              {it.href && !last ? (
                <Link href={it.href} className="max-w-56 truncate text-brand hover:underline" title={it.label}>
                  {it.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className="max-w-72 truncate font-semibold" title={it.label}>
                  {it.label}
                </span>
              )}
              {it.hint && <span className="shrink-0 text-xs text-subtle">({it.hint})</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
