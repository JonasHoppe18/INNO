// Feedback-2a-1: pure helper for the review-only learning loop.
//
// This module ONLY validates, sanitizes, and shapes a feedback_suggestions
// insert row. It holds no Supabase client and performs no writes — a later
// detector (Feedback-2a-2) is what inserts. Suggestions are inert by design:
// they never mutate knowledge, prompts, eval, the curated-examples table, or the
// shadow-preview table, and `status='applied'` is never set here (reserved for a
// future controlled apply flow).

export const SUGGESTION_TYPES = new Set([
  "knowledge_gap_suggestion",
  "knowledge_doc_update_suggestion",
  "eval_golden_case_suggestion",
  "writer_style_rule_suggestion",
  "safety_guardrail_suggestion",
  "product_compatibility_data_suggestion",
]);

export const ROOT_CAUSES = new Set([
  "style_tone",
  "too_verbose",
  "missing_knowledge",
  "incorrect_policy",
  "compatibility",
  "live_fact_tracking",
  "refund_return_nuance",
  "product_specific",
  "unclear_intent",
  "other",
  "insufficient_data",
]);

export const SUGGESTION_STATUSES = new Set([
  "suggested",
  "reviewed",
  "approved",
  "rejected",
  "applied",
]);

export const MAX_SUMMARY_LEN = 600;
export const MAX_REVIEW_NOTE_LEN = 2000;

// Statuses a human review decision may set. 'applied' is reserved for a future
// controlled apply flow and 'suggested' is not re-enterable.
const REVIEWABLE_TARGET_STATUSES = new Set(["reviewed", "approved", "rejected"]);

// Shape the UPDATE for a review decision on a feedback_suggestions row.
// Pure: no client, no writes. Returns { ok: true, patch } or { ok: false, error }.
export function buildSuggestionReviewPatch({
  currentStatus,
  nextStatus,
  reviewerUserId,
  reviewNote = null,
  now = new Date().toISOString(),
} = {}) {
  if (!SUGGESTION_STATUSES.has(currentStatus)) {
    return { ok: false, error: `unknown current status: ${currentStatus}` };
  }
  if (currentStatus === "applied") {
    return { ok: false, error: "applied suggestions are immutable" };
  }
  if (!REVIEWABLE_TARGET_STATUSES.has(nextStatus)) {
    return { ok: false, error: `invalid target status: ${nextStatus}` };
  }
  if (!reviewerUserId || !String(reviewerUserId).trim()) {
    return { ok: false, error: "reviewer user id is required" };
  }

  const trimmedNote = reviewNote == null ? null : String(reviewNote).trim();
  const boundedNote = !trimmedNote
    ? null
    : trimmedNote.length > MAX_REVIEW_NOTE_LEN
      ? trimmedNote.slice(0, MAX_REVIEW_NOTE_LEN)
      : trimmedNote;

  return {
    ok: true,
    patch: {
      status: nextStatus,
      reviewer_user_id: String(reviewerUserId).trim(),
      review_note: boundedNote,
      reviewed_at: now,
      updated_at: now,
    },
  };
}

// Body-like keys that must never be persisted into evidence_json. Matched
// case-insensitively at any depth. Evidence is for ids / scalars / paraphrased
// metadata only — raw bodies stay in mail_messages / draft_generations.
const FORBIDDEN_EVIDENCE_KEYS = new Set([
  "customer_text",
  "customer_message",
  "draft_body",
  "draft_text",
  "final_draft_text",
  "final_sent_text",
  "employee_sent_text",
  "email_body",
  "raw_text",
  "body_text",
  "body_html",
  "clean_body_text",
  "clean_body_html",
  "quoted_body_text",
  "snippet",
]);

// Recursively drop any forbidden (body-like) key from a plain object/array.
export function sanitizeEvidenceJson(input) {
  if (input == null) return {};
  if (Array.isArray(input)) return input.map((v) => sanitizeEvidenceJson(v));
  if (typeof input !== "object") return input;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_EVIDENCE_KEYS.has(String(key).toLowerCase())) continue;
    out[key] =
      value && typeof value === "object" ? sanitizeEvidenceJson(value) : value;
  }
  return out;
}

// Trim + bound the paraphrased summary. null/empty -> null.
export function sanitizeProposedChangeSummary(input) {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_SUMMARY_LEN
    ? trimmed.slice(0, MAX_SUMMARY_LEN)
    : trimmed;
}

function isValidConfidence(c) {
  if (c == null) return true;
  return typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 1;
}

// Validate the classification/lifecycle fields. Returns { ok, errors }.
// Scope (shop/workspace) is handled separately as a skip, not a validation error.
export function validateSuggestionPayload(input = {}) {
  const errors = [];
  if (!SUGGESTION_TYPES.has(input.suggestionType)) {
    errors.push(`invalid suggestion_type: ${input.suggestionType}`);
  }
  if (!ROOT_CAUSES.has(input.rootCause)) {
    errors.push(`invalid root_cause: ${input.rootCause}`);
  }
  if (input.status != null && !SUGGESTION_STATUSES.has(input.status)) {
    errors.push(`invalid status: ${input.status}`);
  }
  if (!isValidConfidence(input.confidence)) {
    errors.push(`invalid confidence: must be null or within [0,1]`);
  }
  if (!input.dedupKey || !String(input.dedupKey).trim()) {
    errors.push(`dedup_key is required`);
  }
  return { ok: errors.length === 0, errors };
}

// Build a validated, sanitized feedback_suggestions insert row.
// Returns:
//   { ok: true, row }                         — ready for the caller to insert
//   { ok: false, skipped: 'missing_scope' }   — no shop/workspace, do not insert
//   { ok: false, errors: [...] }              — invalid payload
export function buildFeedbackSuggestionInsert(input = {}) {
  const {
    shopId,
    workspaceId,
    generationId = null,
    draftId = null,
    threadId = null,
    suggestionType,
    rootCause,
    confidence = null,
    evidence = {},
    proposedChangeSummary = null,
    status = "suggested",
    dedupKey,
  } = input;

  // Tenancy guard: never build a workspace-less or shop-less suggestion.
  if (!shopId || !workspaceId) {
    return { ok: false, skipped: "missing_scope" };
  }

  const { ok, errors } = validateSuggestionPayload({
    suggestionType,
    rootCause,
    status,
    confidence,
    dedupKey,
  });
  if (!ok) return { ok: false, errors };

  const row = {
    shop_id: shopId,
    workspace_id: workspaceId,
    generation_id: generationId || null,
    draft_id: draftId != null ? String(draftId) : null,
    thread_id: threadId || null,
    suggestion_type: suggestionType,
    root_cause: rootCause,
    confidence: confidence == null ? null : confidence,
    evidence_json: sanitizeEvidenceJson(evidence),
    proposed_change_summary: sanitizeProposedChangeSummary(proposedChangeSummary),
    status,
    reviewer_user_id: null,
    review_note: null,
    follow_up_task_ref: null,
    dedup_key: String(dedupKey),
  };

  return { ok: true, row };
}
