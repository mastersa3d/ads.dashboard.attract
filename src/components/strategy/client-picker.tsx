import Link from "next/link";
import { Building2 } from "lucide-react";
import { filtersToQuery, type RawParams } from "@/lib/filters";
import { Callout, DemoBadge } from "@/components/ui/primitives";

/** Shown when a page needs exactly one client but the filter covers several. Keeps other filters. */
export function ClientPicker({
  path,
  sp,
  clients,
  title,
  hint,
  demoLabel,
}: {
  path: string;
  sp: RawParams;
  clients: { id: string; name: string; isDemo: boolean }[];
  title: string;
  hint: string;
  demoLabel: string;
}) {
  return (
    <Callout tone="info" title={title}>
      <p className="mb-3">{hint}</p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c) => (
          <li key={c.id}>
            <Link
              href={`${path}?${filtersToQuery(sp, { client: c.id })}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text transition hover:border-brand hover:text-brand"
            >
              <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.isDemo && <DemoBadge label={demoLabel} />}
            </Link>
          </li>
        ))}
      </ul>
    </Callout>
  );
}
