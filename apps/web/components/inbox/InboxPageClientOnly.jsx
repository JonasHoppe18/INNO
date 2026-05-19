"use client";

import dynamic from "next/dynamic";

const InboxPageClient = dynamic(
  () => import("@/components/inbox/InboxPageClient").then((mod) => mod.InboxPageClient),
  {
    ssr: false,
    loading: () => (
      <div className="inbox-theme flex min-h-0 flex-1 bg-white pb-2">
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-[20px] bg-sidebar">
          <div className="flex min-h-0 w-[clamp(18rem,20vw,24rem)] flex-col border-r border-border bg-background p-3">
            <div className="mb-3 h-9 rounded-md bg-muted animate-pulse" />
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, index) => (
                <div key={index} className="h-16 rounded-md border border-border bg-card p-3">
                  <div className="mb-2 h-3 w-2/3 rounded-full bg-muted animate-pulse" />
                  <div className="h-3 w-4/5 rounded-full bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col bg-sidebar p-4">
            <div className="mb-4 h-9 w-80 max-w-full rounded-md bg-muted animate-pulse" />
            <div className="mt-auto h-40 rounded-xl border border-border bg-card animate-pulse" />
          </div>
        </div>
      </div>
    ),
  },
);

export function InboxPageClientOnly(props) {
  return <InboxPageClient {...props} />;
}
