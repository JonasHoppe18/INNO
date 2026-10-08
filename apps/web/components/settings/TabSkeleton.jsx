"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function TabSkeleton() {
  return (
    <section
      className="w-full space-y-5"
      aria-busy="true"
      aria-label="Loading settings"
    >
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-32 bg-muted" />
        <Skeleton className="h-4 w-80 max-w-full bg-muted/70" />
      </div>

      {["details", "lifecycle", "test-mode"].map((section) => (
        <div key={section} className="rounded-xl border border-border/90 bg-card">
          <div className="space-y-2 px-6 pb-2 pt-5">
            <Skeleton className="h-5 w-40 bg-muted" />
            <Skeleton className="h-4 w-72 max-w-full bg-muted/70" />
          </div>
          <div className="space-y-0 px-6 pb-2">
            {["primary", "secondary"].map((row) => (
              <div
                key={row}
                className="flex items-center gap-4 border-b border-border/80 py-5 last:border-b-0"
              >
                <Skeleton className="h-10 w-10 shrink-0 rounded-full bg-muted" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-32 bg-muted" />
                  <Skeleton className="h-3 w-56 max-w-full bg-muted/70" />
                </div>
                <Skeleton className="h-9 w-40 max-w-[35%] bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <span className="sr-only">Loading settings</span>
    </section>
  );
}
