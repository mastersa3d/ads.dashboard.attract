import { Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy>
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Skeleton className="hidden h-96 lg:block" />
        <div className="space-y-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
