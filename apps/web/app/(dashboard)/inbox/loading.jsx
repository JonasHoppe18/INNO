function SkeletonTicketItem({ delay = 0 }) {
  return (
    <div
      className="animate-pulse px-4 py-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="h-4 w-14 rounded bg-muted" />
          <div className="h-4 w-28 rounded bg-muted" />
        </div>
        <div className="h-3 w-10 rounded bg-muted" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="h-3.5 w-40 rounded bg-muted" />
        <div className="h-3 w-8 rounded bg-muted" />
      </div>
    </div>
  )
}

function SkeletonMessage({ align = "left", delay = 0, lines = 3 }) {
  return (
    <div
      className={`flex animate-pulse ${align === "right" ? "justify-end" : "justify-start"}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`w-3/5 space-y-2 rounded-2xl p-3.5 ${align === "right" ? "bg-primary/10" : "bg-muted"}`}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3 rounded bg-muted-foreground/15"
            style={{ width: i === lines - 1 ? "60%" : `${85 + (i % 2) * 10}%` }}
          />
        ))}
      </div>
    </div>
  )
}

export default function InboxLoading() {
  return (
    <div className="inbox-theme flex min-h-0 flex-1 bg-white pb-2">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[20px] bg-sidebar">

        {/* Ticket list panel — matches actual TicketList aside */}
        <aside className="hidden w-[clamp(18rem,20vw,24rem)] shrink-0 flex-col border-r border-border bg-background lg:flex">
          {/* Search + filter bar */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <div className="h-8 flex-1 animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-[90px] animate-pulse rounded-md bg-muted" />
            <div className="h-5 w-8 animate-pulse rounded-full bg-muted" />
          </div>

          {/* Ticket rows — flat with dividers, matching TicketListItem */}
          <div className="flex-1 divide-y divide-border overflow-hidden">
            {[0, 60, 120, 180, 240, 300, 360, 400].map((delay, i) => (
              <SkeletonTicketItem key={i} delay={delay} />
            ))}
          </div>

          {/* New ticket button */}
          <div className="border-t border-border px-3 pb-2 pt-2">
            <div className="h-8 animate-pulse rounded-md bg-muted" style={{ animationDelay: "420ms" }} />
          </div>
        </aside>

        {/* Detail panel — matches actual TicketDetail section */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar">
          {/* Header — ticket ref + action buttons */}
          <header className="flex min-h-[58px] items-center justify-between border-b border-gray-100 bg-white px-4 py-1.5">
            <div className="flex items-center gap-3">
              <div className="h-5 w-16 animate-pulse rounded bg-muted" />
              <div className="h-6 w-20 animate-pulse rounded-md bg-muted" style={{ animationDelay: "80ms" }} />
              <div className="h-6 w-24 animate-pulse rounded-md bg-muted" style={{ animationDelay: "140ms" }} />
            </div>
            <div className="h-6 w-16 animate-pulse rounded-md bg-muted" style={{ animationDelay: "200ms" }} />
          </header>

          {/* Message area — inbound/outbound bubbles */}
          <div className="flex-1 overflow-hidden px-4 py-3">
            <div className="mx-auto w-full max-w-[900px] space-y-3">
              <SkeletonMessage align="left" delay={0} lines={3} />
              <SkeletonMessage align="right" delay={80} lines={2} />
              <SkeletonMessage align="left" delay={160} lines={4} />
              <SkeletonMessage align="right" delay={240} lines={2} />
            </div>
          </div>

          {/* Composer area */}
          <div className="border-t border-border bg-white px-4 py-3">
            <div className="h-24 animate-pulse rounded-xl bg-muted" style={{ animationDelay: "300ms" }} />
          </div>
        </section>

      </div>
    </div>
  )
}
