# Closing-acknowledgment gate — design

**Date:** 2026-07-13
**Status:** approved direction (Jonas, 2026-07-13) — "suggest close + no draft", precision-first

## Problem

Real ticket T-051050: customer's original address-change request was already
resolved by **AceZone via Zendesk** ("Hi Simon, I have now changed it..."). The
customer then replied **"Yes thanks"**. Sona still generated a draft — and a bad
one ("Hi there, I have requested the address change...") — instead of
recognising the case is closing.

The planner already classifies a pure thank-you as `intent = "thanks"` (and a
pure status confirmation as `"update"`). But the pipeline still runs the writer
and emits a draft. There is no "should we even reply?" gate for a closing
acknowledgment on an already-handled thread.

## Approach — suggest-close, precision-first

When the customer's latest message is a PURE closing acknowledgment on a thread
whose request was ALREADY handled, Sona generates **no draft** and flags the
thread **ready to close** (`close_pending = true`) for one-click confirmation.
NOT a silent hard-close — a human confirms. A decision log measures precision.

The only real risk is a false "close". Five safeguards make a wrong close both
rare and self-healing:

1. **Deterministic pure-close gate** on top of the LLM intent. Close only if ALL
   hold: intent ∈ {thanks, update}; the message has NO question mark; NO
   new-ask markers (`but|men|også|also|however|dog|kan I|can you|could you|
   hvornår|when|still|endnu|desværre|problem|virker ikke|doesn't work|wrong|
   forkert`); bounded length (≤ ~200 chars of new text after stripping quotes);
   not negative/sarcastic.
2. **Require prior resolution.** Close only if the request was already answered:
   `caseState.decisions_made.length > 0` (case-state-updater already extracts
   agent replies from `quoted_body_text`, so a **Zendesk** reply counts) OR the
   thread status was already `waiting_customer`. Never close a thread whose ask
   was never answered.
3. **No open asks.** `caseState.pending_asks` must be empty.
4. **Auto-reopen safety net.** The lifecycle already sets `needs_attention` on
   any new inbound customer message, so a wrong close self-heals the moment the
   customer writes again.
5. **Suggest, don't hard-close + log.** Set `close_pending = true` (UI shows
   "ready to close"), do NOT force `status = resolved`. Emit an
   `agent_logs` decision event (`step_name = 'draft_closing_suggested'`) so we
   can measure how often it fires and audit correctness before enabling hard
   auto-close later (via the existing `auto_close_mode`).

## Components

### New pure stage — `stages/conversation-closing.ts`
```ts
export function assessConversationClosing(input: {
  intent: string;                       // planner primary_intent
  latestCustomerText: string;           // visible (quote-stripped) new text
  priorAgentResolution: boolean;        // decisions_made>0 OR was waiting_customer
  openAsksCount: number;                // caseState.pending_asks.length
}): { suggestClose: boolean; reason: string | null };
```
Pure, fail-safe (any missing/uncertain signal → `suggestClose:false`), no I/O.
Encodes safeguards 1–3. Unit-tested against: "Yes thanks" (close), "Thanks, but
the address is still wrong" (NO), "Thanks! When does it ship?" (NO — has `?`),
"Perfekt, tak" with no prior reply (NO — no resolution), negative "thanks for
nothing" (NO).

### Pipeline wiring — `pipeline.ts`
After the planner (intent) and case-state load, before the writer:
```
const closing = assessConversationClosing({ intent: plan.primary_intent,
  latestCustomerText: latestBody, priorAgentResolution, openAsksCount });
if (closing.suggestClose) {
  // flag ready-to-close + skip the draft entirely
  <set thread close_pending = true via the thread-status transition>
  <agent_logs: step_name='draft_closing_suggested', step_detail={reason,intent}> (never in dry-run)
  return await completeSkippedGeneration("closing_acknowledgment");
}
```
Reuses the existing `completeSkippedGeneration` no-draft return path (same one
the Gate uses). `priorAgentResolution` is derived from `caseState.decisions_made`
+ the thread's pre-inbound status.

### Transition — `_shared/thread-status/transitions.ts`
Add `statusOnClosingAcknowledgment()` returning `{ close_pending: true }` (and
leaving `status` untouched / as the caller holds it) so the thread renders as
"ready to close". Do not set `resolved` here — suggest only.

## Verification

- Synthetic replay (email_data) of "Yes thanks" with a prior agent reply present
  → `skipped:true`, `skip_reason:"closing_acknowledgment"`, no draft; thread
  `close_pending` becomes true; decision logged.
- "Thanks, but it's still wrong" → NOT closed, normal draft.
- "Thanks! when will it arrive?" → NOT closed (question).
- A pure thanks with NO prior agent reply → NOT closed.
- Regression: a normal support request still drafts as before.

## Non-goals
- No silent hard auto-close (kept behind future `auto_close_mode`).
- No new migration (`close_pending` already exists).
- No change to how the planner classifies intent.
- Does not touch postmark-inbound's inbound status write; the pipeline runs
  after it and only adds the `close_pending` flag.
