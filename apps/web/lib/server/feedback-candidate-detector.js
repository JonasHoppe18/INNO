// Feedback-2a-2: pure deterministic candidate mapper.
//
// Turns a sent-draft edit-metrics row into a would-be feedback_suggestions
// insert (via the 2a-1 helper). It is write-free and holds no Supabase client —
// the dry-run script SELECTs rows and feeds them here; nothing is inserted.
//
// Deterministic by design: it never guesses why a draft was edited
// (root_cause stays 'insufficient_data'), never infers product/intent, and only
// records a generation_id when the caller confirms the coupling is reliable.

import { buildFeedbackSuggestionInsert } from "./feedback-suggestions.js";

export const DETECTOR_VERSION = 1;
export const CANDIDATE_RULE = "high_magnitude";
export const CANDIDATE_SUGGESTION_TYPE = "eval_golden_case_suggestion";

const HIGH_MAGNITUDE_DELTA = 0.5;
const VERY_HIGH_DELTA = 0.75;

// Rule 1 — high-magnitude edit: a sent reply that was a major_edit OR rewritten
// by >= 50%.
export function matchesHighMagnitude(row = {}) {
  if (row.status !== "sent") return false;
  if (row.edit_classification === "major_edit") return true;
  return typeof row.edit_delta_pct === "number" && row.edit_delta_pct >= HIGH_MAGNITUDE_DELTA;
}

// Rule 2 — very-high rewrite: a severity flag, NOT a second row.
export function isVeryHighRewrite(row = {}) {
  return typeof row.edit_delta_pct === "number" && row.edit_delta_pct >= VERY_HIGH_DELTA;
}

// Map a draft row (+ optional coupling) to a feedback_suggestions insert.
// Returns:
//   { excluded: true }                         — row does not match Rule 1
//   buildFeedbackSuggestionInsert(...) result  — { ok, row } | { ok:false, skipped } | { ok:false, errors }
//
// options.generation / options.couplingReliable: a generation_id is recorded
// ONLY when couplingReliable === true. Anything weaker -> generation_id null,
// coupling 'none'. options.serviceClient (if passed) is ignored — this is pure.
export function buildFeedbackCandidateSuggestion(row = {}, options = {}) {
  if (!matchesHighMagnitude(row)) {
    return { excluded: true };
  }

  const couplingReliable = options.couplingReliable === true;
  const generationId =
    couplingReliable && options.generation?.id ? options.generation.id : null;

  const evidence = {
    source: "feedback-2a-2",
    detector_version: DETECTOR_VERSION,
    rule: CANDIDATE_RULE,
    very_high_rewrite: isVeryHighRewrite(row),
    draft_row_id: row.id ?? null,
    thread_id: row.thread_id ?? null,
    message_id: row.message_id ?? null,
    generation_id: generationId,
    coupling: generationId ? "reliable" : "none",
    edit_classification: row.edit_classification ?? null,
    edit_delta_pct: typeof row.edit_delta_pct === "number" ? row.edit_delta_pct : null,
    edit_distance: typeof row.edit_distance === "number" ? row.edit_distance : null,
    final_sent_len: typeof row.final_sent_len === "number" ? row.final_sent_len : null,
    sent_at: row.sent_at ?? null,
  };

  return buildFeedbackSuggestionInsert({
    shopId: row.shop_id,
    workspaceId: row.workspace_id,
    generationId,
    draftId: row.id != null ? String(row.id) : null,
    threadId: row.thread_id ?? null,
    suggestionType: CANDIDATE_SUGGESTION_TYPE,
    rootCause: "insufficient_data",
    confidence: null,
    evidence,
    proposedChangeSummary: null,
    status: "suggested",
    dedupKey: `fb:${row.id}:${CANDIDATE_SUGGESTION_TYPE}`,
  });
}
