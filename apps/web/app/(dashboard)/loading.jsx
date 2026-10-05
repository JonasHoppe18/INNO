import { Skeleton } from "@/components/ui/skeleton";

// Route segments with their own skeleton (e.g. Inbox) override this fallback.
export default function DashboardLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-7 lg:py-8" aria-busy="true">
      <span className="sr-only" role="status">Loading page</span>
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}
