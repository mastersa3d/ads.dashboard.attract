import { Skeleton } from "@/components/ui/primitives";

/** Generic route skeleton used by the admin areas' loading.tsx files. */
export function PageSkeleton({ cards = 0, tabs = false, rows = 6 }: { cards?: number; tabs?: boolean; rows?: number }) {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {tabs && <Skeleton className="h-9 w-full max-w-xl" />}
      {cards > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: cards }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      )}
      <div className="space-y-2 rounded-card border border-border bg-surface p-4">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    </div>
  );
}
