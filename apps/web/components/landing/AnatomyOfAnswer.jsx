"use client";

import { useTranslations } from "next-intl";
import { MessageBubble, MessageRenderBoundary } from "@/components/inbox/MessageBubble";
import { ActionCard } from "@/components/inbox/ActionCard";
import { SCENARIOS } from "./demo-inbox/demo-data";
import Reveal from "./Reveal";

// The refund scenario carries this walkthrough (same fictional data as the demo).
const S = SCENARIOS[0];

function Surface({ children }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_12px_40px_-24px_rgba(0,0,0,0.25)]"
    >
      {children}
    </div>
  );
}

// Step 2 — a styled fragment of the order/context panel (not a message).
function OrderPanel() {
  return (
    <Surface>
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Order #40318</p>
      <div className="mt-2 rounded-lg border border-zinc-100 p-2.5">
        <p className="text-xs font-semibold text-zinc-900">Ceramic vase</p>
        <p className="text-[11px] text-zinc-500">1 × €89.00 · Paid</p>
      </div>
      <div className="mt-3 space-y-1.5">
        {[
          ["#22c55e", "Payment captured"],
          ["#22c55e", "Delivered · Jul 14"],
          ["#4f46e5", "Refund policy · §4"],
        ].map(([c, label]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
            <span className="text-[11px] text-zinc-600">{label}</span>
          </div>
        ))}
      </div>
    </Surface>
  );
}

// Step 5 — a styled "learning" fragment.
function LearningPanel() {
  return (
    <Surface>
      <div className="flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 1l1.4 3 3.3.3-2.5 2.2.8 3.2L6 8l-3 1.7.8-3.2L1.3 4.3 4.6 4z" fill="#4f46e5" />
        </svg>
        <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Learned from your edit</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-600">
        You warmed up the opening line. Sona now uses that tone for damaged-item refunds.
      </p>
      <div className="mt-3 flex items-center gap-2 text-[11px]">
        <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-zinc-500 line-through">We have issued your refund.</span>
        <span className="text-zinc-400">→</span>
        <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">I'm so sorry — refund's on the way.</span>
      </div>
    </Surface>
  );
}

function StepVisual({ n }) {
  if (n === 1) {
    return (
      <Surface>
        <MessageRenderBoundary messageId={S.inbound.id}>
          <MessageBubble message={S.inbound} direction="inbound" attachments={[]} />
        </MessageRenderBoundary>
      </Surface>
    );
  }
  if (n === 2) return <OrderPanel />;
  if (n === 3) {
    return (
      <Surface>
        <div className="mb-2 flex items-center gap-2 pl-1 text-[11px] text-indigo-600">
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M6 1l1.4 3 3.3.3-2.5 2.2.8 3.2L6 8l-3 1.7.8-3.2L1.3 4.3 4.6 4z" fill="currentColor" />
          </svg>
          <span className="font-medium">{S.activity}</span>
        </div>
        <MessageRenderBoundary messageId={S.draft.id}>
          <MessageBubble message={S.draft} direction="outbound" outboundSenderName="Your Store" attachments={[]} />
        </MessageRenderBoundary>
      </Surface>
    );
  }
  if (n === 4) {
    return (
      <div aria-hidden="true" className="pointer-events-none flex select-none justify-start [&_.text-l]:text-sm">
        <div className="w-full max-w-[360px]">
          <ActionCard {...S.action} loading={false} onApprove={() => {}} onDecline={() => {}} />
        </div>
      </div>
    );
  }
  return <LearningPanel />;
}

export default function AnatomyOfAnswer() {
  const t = useTranslations("landing.anatomy");
  const steps = [1, 2, 3, 4, 5];
  return (
    <section className="border-t border-zinc-100 bg-zinc-50 px-5 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">{t("kicker")}</p>
          <h2 className="mt-2.5 text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">{t("title")}</h2>
        </div>

        <div className="mt-14 space-y-4">
          {steps.map((n, i) => (
            <Reveal
              key={n}
              delay={i * 60}
              className={`flex flex-col items-center gap-8 md:flex-row ${i % 2 ? "md:flex-row-reverse" : ""}`}
            >
              {/* Text side */}
              <div className="flex flex-1 gap-4">
                <div className="flex flex-col items-center">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                    {n}
                  </span>
                  {n !== steps.length ? <span className="mt-1 hidden w-px flex-1 bg-zinc-200 md:block" /> : null}
                </div>
                <div className="pb-4">
                  <h3 className="text-lg font-bold text-zinc-950">{t(`step${n}Title`)}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{t(`step${n}Body`)}</p>
                </div>
              </div>
              {/* Visual side */}
              <div className="w-full max-w-md flex-1">
                <StepVisual n={n} />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
