// supabase/functions/generate-draft-v2/stages/review-reasons.ts
//
// Pure, deterministic. NO DB / NO API / NO LLM.
//
// Measured 2026-07-29: every one of 14 test drafts carried routing_hint
// "review", including a plain "where is my parcel". That is not over-flagging.
// routing_hint answers "may this be sent automatically?", and with
// auto_send_intents empty — the state of every workspace in manual mode — the
// answer is always no.
//
// The consequence is that guards which "escalate routing_hint to review" write
// their signal into a field that is already saturated, and it is lost on
// arrival. applyVerifierRoutingGuard already produced a `reasons` array, but it
// was only console.warn'd and then dropped.
//
// This module is the guards' own channel. Severity is what separates a routine
// manual-mode review from a draft that genuinely needs a second pair of eyes.

export type ReviewSeverity = "routine" | "caution" | "danger";

export interface ReviewReason {
  code: string;
  severity: ReviewSeverity;
  detail?: string;
}

// Expected in normal operation — carries no warning value on its own.
const ROUTINE_CODES = new Set<string>([
  "auto_send_intent_not_enabled",
  "manual_mode",
  "action_requires_approval",
]);

// A guard positively identified a problem in the draft.
const DANGER_CODES = new Set<string>([
  "verifier_block_send",
  "verifier_api_error",
  "return_granted_outside_window",
  "return_granted_without_documented_window",
  "unsupported_refund_promise",
  "unsupported_prepaid_label_promise",
  "unsupported_replacement_promise",
  "unsupported_exchange_promise",
  "unsupported_document_promise",
  "unsupported_discount_promise",
  "unsupported_cancellation_promise",
  "unsupported_process_promise",
  "unsupported_assumption",
  "image_evidence_claim",
  "unsupported_negative_claim",
  "capability_refusal",
  "order_not_owned",
]);

// Unrecognised codes deliberately land here rather than in "routine": a new
// guard that forgets to register itself must not silently lose its signal,
// which is the failure this whole module exists to prevent.
export function severityFor(code: string): ReviewSeverity {
  if (ROUTINE_CODES.has(code)) return "routine";
  if (DANGER_CODES.has(code)) return "danger";
  return "caution";
}

const RANK: Record<ReviewSeverity, number> = {
  routine: 0,
  caution: 1,
  danger: 2,
};

export function addReviewReason(
  reasons: ReviewReason[],
  code: string,
  detail?: string,
): ReviewReason[] {
  if (!code) return reasons;
  if (reasons.some((r) => r.code === code)) return reasons;
  return [...reasons, { code, severity: severityFor(code), detail }];
}

export interface ReviewReasonSummary {
  codes: string[];
  highest: ReviewSeverity;
  has_guard_violation: boolean;
}

export function summarizeReviewReasons(
  reasons: ReviewReason[],
): ReviewReasonSummary {
  const list = Array.isArray(reasons) ? reasons : [];
  let highest: ReviewSeverity = "routine";
  for (const r of list) {
    if (RANK[r.severity] > RANK[highest]) highest = r.severity;
  }
  return {
    codes: list.map((r) => r.code),
    highest,
    has_guard_violation: list.some((r) => r.severity === "danger"),
  };
}
