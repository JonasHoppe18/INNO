"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageBubble, MessageRenderBoundary } from "@/components/inbox/MessageBubble";
import { ActionCard } from "@/components/inbox/ActionCard";
import { SCENARIOS } from "./demo-data";
import { BrowserChrome, TicketListColumn } from "./DemoChrome";

function noop() {}

// Stages a single scenario walks through on each loop.
const STAGE = { ARRIVE: 0, MESSAGE: 1, REASON: 2, TYPING: 3, APPROVED: 4 };

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduce(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduce;
}

// Fades/slides its children in once `show` is true. Children stay mounted while
// hidden so the panel keeps a stable height and nothing jumps as steps appear.
function Reveal({ show, children, className = "" }) {
  return (
    <div
      className={`transition-all duration-500 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      } ${className}`}
      style={{ transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
    >
      {children}
    </div>
  );
}

// The draft bubble that types itself out. Isolated in its own component so the
// character-by-character state updates re-render ONLY this small subtree — not
// the parent's real MessageBubble/ActionCard, which are comparatively expensive.
// phase: "idle" (nothing), "typing" (animating), "approved" (full text, sent).
function DraftComposer({ scenario, phase, onDone }) {
  const full = scenario.draft.body_text;
  const [typed, setTyped] = useState("");
  const approved = phase === "approved";
  const wrapperRef = useRef(null);
  const approveRef = useRef(null);
  const cursorRef = useRef(null);

  // Glide a fake pointer over to the Approve button and "click" it the moment
  // the draft finishes typing — the click is what flips the parent to approved.
  // Driven imperatively (style/dataset on the cursor node) so it doesn't fight
  // the phase-prop re-render that the click itself triggers. Returns the timer
  // ids so the caller can clean them up.
  const runApproveCursor = (register) => {
    const wrap = wrapperRef.current;
    const btn = approveRef.current;
    const cur = cursorRef.current;
    if (!wrap || !btn || !cur) {
      onDone?.();
      return;
    }
    const wr = wrap.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const tx = br.left - wr.left + br.width * 0.5;
    const ty = br.top - wr.top + br.height * 0.5;

    cur.style.transition = "none";
    cur.style.transform = `translate(${tx + 56}px, ${ty + 66}px)`;
    cur.style.opacity = "0";
    cur.dataset.click = "0";

    register(setTimeout(() => {
      cur.style.transition =
        "transform 640ms cubic-bezier(0.5,0,0.2,1), opacity 220ms ease-out";
      cur.style.transform = `translate(${tx}px, ${ty}px)`;
      cur.style.opacity = "1";
    }, 60));
    register(setTimeout(() => {
      cur.dataset.click = "1";
      onDone?.();
    }, 60 + 660));
    register(setTimeout(() => {
      cur.dataset.click = "0";
    }, 60 + 660 + 200));
    register(setTimeout(() => {
      cur.style.transition = "opacity 320ms ease-out";
      cur.style.opacity = "0";
    }, 60 + 660 + 820));
  };

  useEffect(() => {
    const cur = cursorRef.current;
    if (phase !== "typing") {
      if (phase === "approved") setTyped(full);
      else setTyped("");
      return undefined;
    }
    // Reset the pointer for a fresh scenario.
    if (cur) {
      cur.style.transition = "none";
      cur.style.opacity = "0";
      cur.dataset.click = "0";
    }
    setTyped("");
    const timers = [];
    const register = (id) => timers.push(id);
    let i = 0;
    const tick = () => {
      i += 1;
      setTyped(full.slice(0, i));
      if (i < full.length) {
        const ch = full[i - 1];
        const delay =
          ch === "\n" ? 80 : ch === "." || ch === "," ? 55 : 12 + Math.random() * 16;
        timers.push(setTimeout(tick, delay));
      } else {
        timers.push(setTimeout(() => runApproveCursor(register), 420));
      }
    };
    tick();
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, full, onDone]);

  const typing = phase === "typing" && typed.length < full.length;

  return (
    <div ref={wrapperRef} className="relative w-full max-w-full sm:max-w-[560px] lg:max-w-[620px]">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <div className="text-[13px] font-semibold text-zinc-900">
          Sona <span className="text-[12px] font-normal text-zinc-400">now</span>
        </div>
        {approved ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-700">
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 6.3l2.2 2.2 4.8-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            Sent
          </span>
        ) : (
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[12px] font-medium text-blue-700">
            Draft
          </span>
        )}
      </div>
      <div
        className={`mt-0.5 overflow-hidden rounded-xl border px-4 py-3 text-[14px] leading-[1.55] text-zinc-800 transition-colors duration-500 ${
          approved ? "border-emerald-200 bg-emerald-50/40" : "border-violet-200 bg-violet-50/55"
        }`}
      >
        <span className="whitespace-pre-wrap">{typed}</span>
        {typing ? (
          <span className="ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] animate-pulse bg-indigo-500 align-middle" />
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 px-1">
        <span className="rounded-md px-3 py-1.5 text-[12px] font-medium text-zinc-400">Edit</span>
        <span
          ref={approveRef}
          className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-500 ${
            approved
              ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/25"
              : "bg-indigo-600 text-white shadow-sm shadow-indigo-600/25"
          }`}
        >
          {approved ? (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.5 6.3l2.2 2.2 4.8-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
              Approved &amp; sent
            </>
          ) : (
            "Approve & send"
          )}
        </span>
      </div>

      {/* Fake pointer that glides over and clicks Approve when the draft is
          done. Positioned/animated imperatively via runApproveCursor; the tip
          of the arrow sits at translate origin, so we nudge it up-left a touch. */}
      <div
        ref={cursorRef}
        data-click="0"
        aria-hidden="true"
        className="group pointer-events-none absolute left-0 top-0 z-10 opacity-0"
        style={{ transform: "translate(-100px, -100px)" }}
      >
        <div className="relative -ml-1 -mt-1 transition-transform duration-150 group-data-[click=1]:scale-90">
          {/* click ripple */}
          <span className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/25 opacity-0 group-data-[click=1]:animate-ping group-data-[click=1]:opacity-100" />
          <svg width="22" height="22" viewBox="0 0 24 24" className="relative drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]">
            <path
              d="M5 3l5 16 2.2-6.4L18.6 10 5 3z"
              fill="#ffffff"
              stroke="#18181b"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

// The scripted hero product demo. It loops through the same fictional scenarios
// as the interactive DemoInbox, but plays each one as a story: a ticket arrives
// → Sona reads it and pulls the order → the action is proposed → the reply types
// itself out → it's approved. The inbound message and action card are the real
// production components. Respects prefers-reduced-motion (renders fully, no motion).
export default function AnimatedDemoInbox() {
  const reduce = usePrefersReducedMotion();
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState(STAGE.ARRIVE);
  const timers = useRef([]);
  const scenario = SCENARIOS[idx];

  // Called by the composer when the draft has finished typing: flip to the
  // approved/sent state, hold, then advance to the next scenario.
  const handleDraftDone = useCallback(() => {
    setStage(STAGE.APPROVED);
    timers.current.push(
      setTimeout(() => setIdx((n) => (n + 1) % SCENARIOS.length), 2600)
    );
  }, []);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const push = (ms, fn) => timers.current.push(setTimeout(fn, ms));

    if (reduce) {
      setStage(STAGE.APPROVED);
      return () => {};
    }

    setStage(STAGE.ARRIVE);
    const hasAction = Boolean(scenario.action);
    push(450, () => setStage(STAGE.MESSAGE));
    push(1650, () => setStage(STAGE.REASON));
    push(hasAction ? 2950 : 2400, () => setStage(STAGE.TYPING));

    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, reduce]);

  const approved = stage === STAGE.APPROVED;
  const draftPhase = reduce
    ? "approved"
    : stage === STAGE.TYPING
    ? "typing"
    : stage === STAGE.APPROVED
    ? "approved"
    : "idle";

  return (
    <div className="mx-auto max-w-4xl">
      <BrowserChrome>
        <div className="flex bg-zinc-50/60">
          <TicketListColumn
            selectedId={scenario.ticketId}
            pulseId={!reduce && stage <= STAGE.MESSAGE ? scenario.ticketId : null}
          />
          <div className="flex min-h-[440px] min-w-0 flex-1 select-none flex-col gap-3 p-4 text-left sm:min-h-[460px]">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="rounded-md border border-zinc-200 px-2 py-0.5 font-semibold text-zinc-600">
                {scenario.ref}
              </span>
              {approved ? (
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                  Sent · waiting on customer
                </span>
              ) : (
                <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                  Needs attention
                </span>
              )}
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">
                {scenario.tag}
              </span>
            </div>

            <Reveal show={reduce || stage >= STAGE.MESSAGE}>
              <div className="pointer-events-none" aria-hidden="true">
                <MessageRenderBoundary messageId={scenario.inbound.id}>
                  <MessageBubble message={scenario.inbound} direction="inbound" attachments={[]} />
                </MessageRenderBoundary>
              </div>
            </Reveal>

            <div className="flex min-h-[16px] items-center gap-2 pl-1 text-[11px]">
              {!reduce && stage >= STAGE.MESSAGE && stage < STAGE.REASON ? (
                <span className="flex items-center gap-2 text-zinc-400">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border border-zinc-300 border-t-indigo-500" />
                  <span className="font-medium">Sona is reading the message…</span>
                </span>
              ) : (
                <Reveal show={reduce || stage >= STAGE.REASON} className="flex items-center gap-2 text-indigo-600">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M6 1l1.4 3 3.3.3-2.5 2.2.8 3.2L6 8l-3 1.7.8-3.2L1.3 4.3 4.6 4z" fill="currentColor" />
                  </svg>
                  <span className="font-medium">{scenario.activity}</span>
                </Reveal>
              )}
            </div>

            {scenario.action ? (
              <Reveal show={reduce || stage >= STAGE.REASON} className="flex justify-end">
                <div
                  className="pointer-events-none ml-auto flex w-full max-w-[360px] justify-end [&_.text-l]:text-sm"
                  aria-hidden="true"
                >
                  <MessageRenderBoundary messageId={`${scenario.id}-action`}>
                    <ActionCard {...scenario.action} loading={false} onApprove={noop} onDecline={noop} />
                  </MessageRenderBoundary>
                </div>
              </Reveal>
            ) : null}

            <Reveal show={reduce || stage >= STAGE.TYPING} className="mt-auto flex justify-end">
              <DraftComposer scenario={scenario} phase={draftPhase} onDone={handleDraftDone} />
            </Reveal>
          </div>
        </div>
      </BrowserChrome>
    </div>
  );
}
