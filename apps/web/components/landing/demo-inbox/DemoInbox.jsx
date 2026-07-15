"use client";

import { MessageBubble, MessageRenderBoundary } from "@/components/inbox/MessageBubble";
import { ActionCard } from "@/components/inbox/ActionCard";
import {
  DEMO_INBOUND_MESSAGE,
  DEMO_DRAFT_MESSAGE,
  DEMO_ACTION,
  DEMO_TICKET_LIST,
} from "./demo-data";

function BrowserChrome({ children }) {
  return (
    <div className="overflow-hidden rounded-t-2xl border border-b-0 border-zinc-200 bg-zinc-50 shadow-[0_-8px_60px_-20px_rgba(79,70,229,0.25),0_24px_80px_-24px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
        ))}
        <span className="mx-auto w-64 rounded-md bg-zinc-100 py-1 text-center text-[11px] text-zinc-400">
          app.sona.ai/inbox
        </span>
        <span className="w-10" />
      </div>
      {children}
    </div>
  );
}

function TicketListColumn() {
  return (
    <div className="hidden w-56 shrink-0 flex-col border-r border-zinc-100 bg-white p-2 text-left lg:flex">
      {DEMO_TICKET_LIST.map((tkt) => (
        <div
          key={tkt.id}
          className={`rounded-md px-2.5 py-2 ${tkt.selected ? "bg-violet-50" : "border-b border-zinc-50"}`}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold text-zinc-900">{tkt.name}</span>
            <span className="text-[10px] text-zinc-400">{tkt.time}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="truncate text-[11px] text-zinc-600">{tkt.subject}</span>
            {tkt.badge ? <span className="text-[10px] font-semibold text-emerald-600">{tkt.badge}</span> : null}
          </div>
          <div className="text-[10px] text-zinc-400">{tkt.ref}</div>
        </div>
      ))}
    </div>
  );
}

// No-op handlers: the whole tree is pointer-events-none/aria-hidden, but
// ActionCard's buttons are disabled via `loading` too as defense in depth
// against any future change that relaxes the pointer-events wrapper.
function noop() {}

// Renders the real product UI (MessageBubble/ActionCard) with fictional data.
// Non-interactive by design: pointer-events-none + aria-hidden. Zero fetches —
// every prop is static, no hooks that reach into Supabase/Shopify/etc. are used.
export default function DemoInbox() {
  return (
    <div aria-hidden="true" className="pointer-events-none relative mx-auto max-w-4xl select-none">
      <BrowserChrome>
        <div className="flex bg-zinc-50/60">
          <TicketListColumn />
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 text-left">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="rounded-md border border-zinc-200 px-2 py-0.5 font-semibold text-zinc-600">T-40318</span>
              <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">Needs attention</span>
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">Damaged item</span>
            </div>

            <MessageRenderBoundary messageId={DEMO_INBOUND_MESSAGE.id}>
              <MessageBubble message={DEMO_INBOUND_MESSAGE} direction="inbound" attachments={[]} />
            </MessageRenderBoundary>

            {/* Mirrors the real TicketDetail wrapper: ActionCard sits right-aligned,
                inserted before the outbound draft it precedes. Wrapped in the same
                boundary as the message bubbles so a future ActionCard prop-contract
                change degrades to a fallback box instead of crashing the hero. */}
            <MessageRenderBoundary messageId="demo-action">
              <div className="ml-auto flex w-full max-w-[520px] justify-end">
                <ActionCard {...DEMO_ACTION} loading={false} onApprove={noop} onDecline={noop} />
              </div>
            </MessageRenderBoundary>

            <MessageRenderBoundary messageId={DEMO_DRAFT_MESSAGE.id}>
              <MessageBubble
                message={DEMO_DRAFT_MESSAGE}
                direction="outbound"
                outboundSenderName="Your Store"
                attachments={[]}
              />
            </MessageRenderBoundary>
          </div>
        </div>
      </BrowserChrome>
    </div>
  );
}
