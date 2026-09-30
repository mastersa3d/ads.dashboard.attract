import { Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-20 rounded-card" />
      <div className="rounded-card border border-border bg-surface p-4">
        <Skeleton className="mb-4 h-5 w-40" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="mb-2 h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
