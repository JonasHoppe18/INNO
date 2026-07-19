"use client";

import { useState } from "react";
import { MessageBubble, MessageRenderBoundary } from "@/components/inbox/MessageBubble";
import { ActionCard } from "@/components/inbox/ActionCard";
import { SCENARIOS } from "./demo-data";
import { BrowserChrome, TicketListColumn } from "./DemoChrome";

function noop() {}

// The tabbed, interactive product demo. Tabs (real buttons) switch the scenario;
// the inbox panel below re-renders the actual production MessageBubble/ActionCard
// with fictional data and crossfades in. The product surface itself is
// non-interactive (pointer-events-none/aria-hidden) — only the tabs respond.
//
// `showTabs={false}` renders a static full-inbox screenshot (locked to the first
// scenario, no tabs) — used as the /product hero anchor, where the walkthrough
// below breaks the same inbox down step by step.
export default function DemoInbox({ showTabs = true }) {
  const [activeId, setActiveId] = useState(SCENARIOS[0].id);
  const scenario = showTabs
    ? SCENARIOS.find((s) => s.id === activeId) || SCENARIOS[0]
    : SCENARIOS[0];

  return (
    <div className="mx-auto max-w-4xl">
      {showTabs ? (
        <div
          role="tablist"
          aria-label="Product demo scenarios"
          className="mb-4 flex flex-wrap justify-center gap-2"
        >
          {SCENARIOS.map((s) => {
            const active = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveId(s.id)}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200 active:scale-[0.97] ${
                  active
                    ? "border-transparent bg-indigo-600 text-white shadow-sm shadow-indigo-600/25"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
                }`}
              >
                {s.tabLabel}
              </button>
            );
          })}
        </div>
      ) : null}

      <BrowserChrome>
        {/* key on scenario id so the crossfade animation replays on each switch */}
        <div key={scenario.id} className="demo-panel flex bg-zinc-50/60">
          <TicketListColumn selectedId={scenario.ticketId} />
          <div
            aria-hidden="true"
            className="pointer-events-none flex min-w-0 flex-1 select-none flex-col gap-3 p-4 text-left"
          >
            <div className="flex items-center gap-2 text-[11px]">
              <span className="rounded-md border border-zinc-200 px-2 py-0.5 font-semibold text-zinc-600">{scenario.ref}</span>
              <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">Needs attention</span>
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{scenario.tag}</span>
            </div>

            <MessageRenderBoundary messageId={scenario.inbound.id}>
              <MessageBubble message={scenario.inbound} direction="inbound" attachments={[]} />
            </MessageRenderBoundary>

            {/* Sona's reasoning line — mirrors the real activity strip */}
            <div className="flex items-center gap-2 pl-1 text-[11px] text-indigo-600">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M6 1l1.4 3 3.3.3-2.5 2.2.8 3.2L6 8l-3 1.7.8-3.2L1.3 4.3 4.6 4z" fill="currentColor" />
              </svg>
              <span className="font-medium">{scenario.activity}</span>
            </div>

            {scenario.action ? (
              // The real ActionCard is built for the app, where it's the primary
              // affordance. In the demo it reads as loud next to the message
              // bubbles, so we keep the real component but constrain it to a
              // narrower, right-aligned footprint so it sits as one calm step in
              // the flow rather than a full-width competing CTA block.
              <MessageRenderBoundary messageId={`${scenario.id}-action`}>
                <div className="ml-auto flex w-full max-w-[360px] justify-end [&_.text-l]:text-sm">
                  <ActionCard {...scenario.action} loading={false} onApprove={noop} onDecline={noop} />
                </div>
              </MessageRenderBoundary>
            ) : null}

            <MessageRenderBoundary messageId={scenario.draft.id}>
              <MessageBubble
                message={scenario.draft}
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
