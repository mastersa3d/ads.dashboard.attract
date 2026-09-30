"use client";

import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Card, CardBody, CardHeader, DemoBadge, EmptyState } from "@/components/ui/primitives";

/** Shown by client-specific centres (competitors, trends) when no client is selected. */
export function ClientPicker({ clients, path, query, title, hint }: { clients: { id: string; name: string; isDemo: boolean }[]; path: string; query: string; title: string; hint: string }) {
  const { t } = useI18n();
  const href = (id: string) => {
    const q = new URLSearchParams(query);
    q.set("client", id);
    return `${path}?${q.toString()}`;
  };
  return (
    <Card>
      <CardHeader title={title} subtitle={hint} />
      <CardBody>
        {clients.length === 0 ? (
          <EmptyState title={t("competitors.picker.none")} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((c) => (
              <li key={c.id}>
                <Link href={href(c.id)} className="flex items-center gap-3 rounded-lg border border-border p-3 transition hover:border-brand hover:bg-surface-2">
                  <span className="rounded-lg bg-brand-soft p-2 text-brand">
                    <Building2 className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    {c.isDemo && <DemoBadge label={t("ui.demoData")} />}
                  </span>
                  <ChevronRight className="size-4 text-subtle flip-rtl" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
