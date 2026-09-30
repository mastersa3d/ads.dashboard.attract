import Link from "next/link";
import { cx } from "@/components/ui/primitives";

/**
 * Compact segmented control whose options are links (state lives in the URL, so views are
 * shareable, bookmarkable and saved with Saved Views). Scrolls horizontally on narrow screens.
 */
export function SegmentedLinks({ options, active, label }: { options: { key: string; label: string; href: string }[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="no-print max-w-full overflow-x-auto">
      <ul className="inline-flex gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
        {options.map((o) => (
          <li key={o.key}>
            <Link
              href={o.href}
              scroll={false}
              aria-current={o.key === active ? "true" : undefined}
              className={cx(
                "block whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition",
                o.key === active ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
              )}
            >
              {o.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
