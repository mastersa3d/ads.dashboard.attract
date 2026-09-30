"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cx, inputClass } from "@/components/ui/primitives";

/** Value meaning "any" — lets the user clear a filter that was defaulted from the client profile. */
export const ANY = "*";

export type BenchmarkFilterField = {
  key: string;
  label: string;
  /** Current effective value ("" = any). */
  value: string;
  /** True when the value came from the client profile / top platform rather than the URL. */
  defaulted?: boolean;
  options: { value: string; label: string }[];
};

/** Benchmark Center filters — URL search params, so views are shareable and saved with Saved Views. */
export function BenchmarkFilters({ fields, resetKeys }: { fields: BenchmarkFilterField[]; resetKeys: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const push = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    start(() => router.push(`${pathname}?${q.toString()}`, { scroll: false }));
  };

  return (
    <div className={cx("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5", pending && "opacity-60")} aria-busy={pending}>
      {fields.map((f) => (
        <label key={f.key} className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-xs font-medium text-muted">
            {f.label}
            {f.defaulted && <span className="ms-1 text-[10px] font-normal text-subtle">({t("benchmarks.defaulted")})</span>}
          </span>
          <select className={cx(inputClass, "h-8 pe-7 text-xs")} value={f.value || ANY} onChange={(e) => push({ [f.key]: e.target.value })}>
            <option value={ANY}>{t("benchmarks.any")}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="flex items-end">
        <button
          type="button"
          onClick={() => push(Object.fromEntries(resetKeys.map((k) => [k, null])))}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-surface-2 hover:text-text"
        >
          <RotateCcw className="size-3.5" aria-hidden /> {t("benchmarks.resetFilters")}
        </button>
      </div>
    </div>
  );
}
