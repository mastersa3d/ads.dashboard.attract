import { Skeleton } from "@/components/ui/primitives";

export default function CompetitorProfileLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-10 w-80" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-96 xl:col-span-2" />
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-52" />
        </div>
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}
