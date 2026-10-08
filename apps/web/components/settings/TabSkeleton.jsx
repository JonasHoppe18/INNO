"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function TabSkeleton() {
  return (
    <section className="mx-auto w-full max-w-[720px] space-y-9" aria-busy="true" aria-label="Loading settings">
      <div className="space-y-2 border-b border-border/60 pb-5">
        <Skeleton className="h-5 w-32 bg-muted" />
        <Skeleton className="h-3.5 w-72 max-w-full bg-muted/70" />
      </div>
      {["first", "second", "third"].map((group) => (
        <div key={group}>
          <Skeleton className="mb-3 h-4 w-36 bg-muted" />
          <div className="divide-y divide-border/60">
            {["a", "b", "c"].map((row) => (
              <div key={row} className="flex items-center justify-between gap-8 py-3.5">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32 bg-muted" />
                  <Skeleton className="h-3 w-64 max-w-full bg-muted/70" />
                </div>
                <Skeleton className="h-8 w-64 shrink-0 bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <span className="sr-only">Loading settings</span>
    </section>
  );
}
