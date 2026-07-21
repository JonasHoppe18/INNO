import { TICKETS } from "./demo-data";

// Shared browser-frame + ticket-list chrome for the product demo. Used by both
// the static/tabbed DemoInbox and the scripted AnimatedDemoInbox so the two
// stay pixel-identical.
export function BrowserChrome({ children }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 shadow-[0_-8px_60px_-20px_rgba(79,70,229,0.25),0_24px_80px_-24px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
        ))}
        <span className="mx-auto w-64 rounded-md bg-zinc-100 py-1 text-center text-[11px] text-zinc-400">
          app.sona-ai.dk/inbox
        </span>
        <span className="w-10" />
      </div>
      {children}
    </div>
  );
}

// `pulseId` marks the row whose ticket just arrived, so the animated demo can
// give it a brief "new message" accent as the loop advances.
export function TicketListColumn({ selectedId, pulseId = null }) {
  return (
    <div className="hidden w-56 shrink-0 flex-col border-r border-zinc-100 bg-white p-2 text-left lg:flex">
      {TICKETS.map((tkt) => {
        const selected = tkt.id === selectedId;
        const pulsing = tkt.id === pulseId;
        return (
          <div
            key={tkt.id}
            className={`rounded-md px-2.5 py-2 transition-colors duration-300 ${
              selected ? "bg-violet-50" : "border-b border-zinc-50"
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-900">
                {pulsing ? (
                  <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-indigo-500" />
                ) : null}
                {tkt.name}
              </span>
              <span className="text-[10px] text-zinc-400">{tkt.time}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="truncate text-[11px] text-zinc-600">{tkt.subject}</span>
              {tkt.badge ? <span className="text-[10px] font-semibold text-emerald-600">{tkt.badge}</span> : null}
            </div>
            <div className="text-[10px] text-zinc-400">{tkt.ref}</div>
          </div>
        );
      })}
    </div>
  );
}
