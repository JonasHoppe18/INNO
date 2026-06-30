// Run with: node --test tests/
//
// Feedback-2a-1: pure helper for building review-only feedback_suggestions rows.
//
// The helper is intentionally write-free (no Supabase client): it validates,
// sanitizes, and shapes an insert row. A later detector (2a-2) is what actually
// inserts. These tests pin: enum validation, scope/dedup guards, confidence
// bounds, evidence body-stripping (privacy), summary bounding, and that the
// module imports nothing from any auto-promotion path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildFeedbackSuggestionInsert,
  validateSuggestionPayload,
  sanitizeEvidenceJson,
  sanitizeProposedChangeSummary,
  SUGGESTION_TYPES,
  ROOT_CAUSES,
  SUGGESTION_STATUSES,
  MAX_SUMMARY_LEN,
} from "../apps/web/lib/server/feedback-suggestions.js";

const BASE = {
  shopId: "shop_1",
  workspaceId: "ws_1",
  suggestionType: "knowledge_gap_suggestion",
  rootCause: "missing_knowledge",
  dedupKey: "fb:gen_1:knowledge_gap_suggestion",
};

// --- enums ---------------------------------------------------------------------

test("exposes the full enum sets", () => {
  assert.deepEqual([...SUGGESTION_TYPES].sort(), [
    "eval_golden_case_suggestion",
    "knowledge_doc_update_suggestion",
    "knowledge_gap_suggestion",
    "product_compatibility_data_suggestion",
    "safety_guardrail_suggestion",
    "writer_style_rule_suggestion",
  ]);
  assert.deepEqual([...ROOT_CAUSES].sort(), [
    "compatibility",
    "incorrect_policy",
    "insufficient_data",
    "live_fact_tracking",
    "missing_knowledge",
    "other",
    "product_specific",
    "refund_return_nuance",
    "style_tone",
    "too_verbose",
    "unclear_intent",
  ]);
  assert.deepEqual([...SUGGESTION_STATUSES].sort(), [
    "applied",
    "approved",
    "rejected",
    "reviewed",
    "suggested",
  ]);
});

// --- valid build ---------------------------------------------------------------

test("builds a valid row with defaults", () => {
  const res = buildFeedbackSuggestionInsert({
    ...BASE,
    generationId: "gen_1",
    draftId: "d_1",
    threadId: "t_1",
    confidence: 0.8,
    evidence: { generation_ids: ["gen_1"], chunk_ids: ["c1"], intent: "return" },
    proposedChangeSummary: "AI omitted the 30-day return window; reviewer added it.",
  });
  assert.equal(res.ok, true);
  const { row } = res;
  assert.equal(row.shop_id, "shop_1");
  assert.equal(row.workspace_id, "ws_1");
  assert.equal(row.generation_id, "gen_1");
  assert.equal(row.draft_id, "d_1");
  assert.equal(row.thread_id, "t_1");
  assert.equal(row.suggestion_type, "knowledge_gap_suggestion");
  assert.equal(row.root_cause, "missing_knowledge");
  assert.equal(row.confidence, 0.8);
  assert.equal(row.status, "suggested"); // default, never 'applied'
  assert.equal(row.dedup_key, "fb:gen_1:knowledge_gap_suggestion");
  assert.deepEqual(row.evidence_json, { generation_ids: ["gen_1"], chunk_ids: ["c1"], intent: "return" });
  assert.equal(row.reviewer_user_id, null);
  assert.equal(row.follow_up_task_ref, null);
});

test("nullable ids default to null; evidence defaults to {}", () => {
  const res = buildFeedbackSuggestionInsert({ ...BASE, rootCause: "insufficient_data" });
  assert.equal(res.ok, true);
  assert.equal(res.row.generation_id, null);
  assert.equal(res.row.draft_id, null);
  assert.equal(res.row.thread_id, null);
  assert.equal(res.row.confidence, null);
  assert.deepEqual(res.row.evidence_json, {});
  assert.equal(res.row.proposed_change_summary, null);
});

test("status can be set explicitly to an allowed value", () => {
  const res = buildFeedbackSuggestionInsert({ ...BASE, status: "suggested" });
  assert.equal(res.ok, true);
  assert.equal(res.row.status, "suggested");
});

// --- invalid values rejected ---------------------------------------------------

test("rejects unknown suggestion_type", () => {
  const res = buildFeedbackSuggestionInsert({ ...BASE, suggestionType: "make_it_better" });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /suggestion_type/.test(e)));
});

test("rejects unknown root_cause", () => {
  const res = buildFeedbackSuggestionInsert({ ...BASE, rootCause: "vibes" });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /root_cause/.test(e)));
});

test("rejects unknown status", () => {
  const res = buildFeedbackSuggestionInsert({ ...BASE, status: "live" });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /status/.test(e)));
});

// --- scope + dedup guards ------------------------------------------------------

test("skips when shop_id missing", () => {
  const res = buildFeedbackSuggestionInsert({ ...BASE, shopId: null });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "missing_scope");
});

test("skips when workspace_id missing", () => {
  const res = buildFeedbackSuggestionInsert({ ...BASE, workspaceId: undefined });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "missing_scope");
});

test("rejects when dedup_key missing", () => {
  const res = buildFeedbackSuggestionInsert({ ...BASE, dedupKey: "" });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /dedup_key/.test(e)));
});

// --- confidence bounds ---------------------------------------------------------

test("confidence must be null or within [0,1]", () => {
  assert.equal(buildFeedbackSuggestionInsert({ ...BASE, confidence: 1.5 }).ok, false);
  assert.equal(buildFeedbackSuggestionInsert({ ...BASE, confidence: -0.1 }).ok, false);
  assert.equal(buildFeedbackSuggestionInsert({ ...BASE, confidence: "high" }).ok, false);
  assert.equal(buildFeedbackSuggestionInsert({ ...BASE, confidence: 0 }).ok, true);
  assert.equal(buildFeedbackSuggestionInsert({ ...BASE, confidence: 1 }).ok, true);
  assert.equal(buildFeedbackSuggestionInsert({ ...BASE, confidence: null }).ok, true);
});

// --- privacy: evidence_json strips raw bodies ----------------------------------

test("sanitizeEvidenceJson removes body-like keys at any depth", () => {
  const cleaned = sanitizeEvidenceJson({
    chunk_ids: ["c1"],
    customer_text: "I want a refund of 499kr",
    customer_message: "...",
    draft_body: "...",
    final_sent_text: "...",
    email_body: "...",
    raw_text: "...",
    nested: { body_text: "secret", thread_id: "t1", clean_body_text: "x" },
  });
  assert.deepEqual(cleaned, {
    chunk_ids: ["c1"],
    nested: { thread_id: "t1" },
  });
  const serialized = JSON.stringify(cleaned);
  assert.ok(!serialized.includes("499"), "no body content survives");
  assert.ok(!serialized.includes("secret"));
});

test("buildFeedbackSuggestionInsert strips raw bodies from evidence", () => {
  const res = buildFeedbackSuggestionInsert({
    ...BASE,
    evidence: { intent: "return", final_sent_text: "Hi, refund of 499kr done", raw_text: "x" },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.row.evidence_json, { intent: "return" });
  assert.ok(!JSON.stringify(res.row).includes("499"));
});

// --- summary bounding ----------------------------------------------------------

test("proposed_change_summary is bounded to MAX_SUMMARY_LEN", () => {
  const long = "x".repeat(MAX_SUMMARY_LEN + 500);
  assert.equal(sanitizeProposedChangeSummary(long).length, MAX_SUMMARY_LEN);
  const res = buildFeedbackSuggestionInsert({ ...BASE, proposedChangeSummary: long });
  assert.equal(res.ok, true);
  assert.ok(res.row.proposed_change_summary.length <= MAX_SUMMARY_LEN);
});

test("sanitizeProposedChangeSummary handles null/empty", () => {
  assert.equal(sanitizeProposedChangeSummary(null), null);
  assert.equal(sanitizeProposedChangeSummary(""), null);
  assert.equal(sanitizeProposedChangeSummary("  hi  "), "hi");
});

// --- validateSuggestionPayload direct ------------------------------------------

test("validateSuggestionPayload returns structured errors", () => {
  const { ok, errors } = validateSuggestionPayload({ ...BASE, suggestionType: "nope", confidence: 9 });
  assert.equal(ok, false);
  assert.ok(errors.length >= 2);
});

// --- helper never writes -------------------------------------------------------

test("helper is pure: takes no client and returns data only (never writes)", () => {
  // buildFeedbackSuggestionInsert must not accept or use a serviceClient.
  const res = buildFeedbackSuggestionInsert({ ...BASE, serviceClient: { from: () => { throw new Error("should not be called"); } } });
  assert.equal(res.ok, true);
  assert.ok(res.row && typeof res.row === "object");
});

// --- structural: no auto-promotion imports -------------------------------------

test("module imports nothing from any auto-promotion / pipeline path", () => {
  const modulePath = fileURLToPath(
    new URL("../apps/web/lib/server/feedback-suggestions.js", import.meta.url),
  );
  const src = readFileSync(modulePath, "utf8");
  for (const forbidden of [
    "draft_previews",
    "ticket_examples",
    "promoteEditToTicketExample",
    "captureV2DraftPreviewFeedback",
    "generate-draft",
    "store-reply-example",
  ]) {
    assert.ok(!src.includes(forbidden), `must not reference ${forbidden}`);
  }
});
