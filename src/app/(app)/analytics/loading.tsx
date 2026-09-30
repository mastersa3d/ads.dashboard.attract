import { Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-card" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-96 rounded-card xl:col-span-2" />
        <Skeleton className="h-96 rounded-card" />
      </div>
      <Skeleton className="h-72 rounded-card" />
    </div>
  );
}
