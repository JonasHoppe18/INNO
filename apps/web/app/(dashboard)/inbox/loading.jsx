export default function InboxLoading() {
  return (
    <div className="inbox-theme flex min-h-0 flex-1 bg-white pb-2">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[20px] bg-sidebar">
        <aside className="hidden w-[clamp(18rem,20vw,24rem)] shrink-0 border-r border-border bg-background lg:flex lg:flex-col">
          <div className="border-b border-border px-3 py-2">
            <div className="h-8 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="flex-1 space-y-2 overflow-hidden px-3 py-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-border bg-card p-3">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar">
          <div className="border-b border-gray-100 bg-white px-4 py-3">
            <div className="h-8 w-3/4 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="flex-1 space-y-3 overflow-hidden px-4 py-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2 rounded-xl border border-border bg-card p-4">
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
