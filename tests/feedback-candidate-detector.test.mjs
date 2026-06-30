// Run with: node --test tests/
//
// Feedback-2a-2: pure deterministic candidate mapper that turns a sent-draft
// edit-metrics row into a would-be feedback_suggestions insert (via the 2a-1
// helper). Dry-run only — the mapper is write-free. These tests pin: rule
// predicates, defaults, dedup_key, evidence shape/privacy, coupling discipline,
// and that neither the mapper nor the dry-run script reaches any insert path or
// auto-promotion code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildFeedbackCandidateSuggestion,
  matchesHighMagnitude,
  isVeryHighRewrite,
  DETECTOR_VERSION,
  CANDIDATE_SUGGESTION_TYPE,
} from "../apps/web/lib/server/feedback-candidate-detector.js";

// A sent major_edit row, fully scoped. final_sent_len is a NUMBER (never text).
function draftRow(overrides = {}) {
  return {
    id: 9576,
    workspace_id: "ws_1",
    shop_id: "shop_1",
    thread_id: "6af8c627-…",
    message_id: null,
    status: "sent",
    edit_classification: "major_edit",
    edit_delta_pct: 0.55,
    edit_distance: 458,
    final_sent_len: 100,
    sent_at: "2026-06-02",
    ...overrides,
  };
}

// --- rule predicates -----------------------------------------------------------

test("major_edit is selected", () => {
  assert.equal(matchesHighMagnitude(draftRow({ edit_classification: "major_edit", edit_delta_pct: 0.1 })), true);
});

test("edit_delta_pct >= 0.5 is selected even if not classified major", () => {
  assert.equal(matchesHighMagnitude(draftRow({ edit_classification: "minor_edit", edit_delta_pct: 0.5 })), true);
});

test("below threshold + not major is excluded", () => {
  assert.equal(matchesHighMagnitude(draftRow({ edit_classification: "minor_edit", edit_delta_pct: 0.2 })), false);
});

test("unsent draft is excluded", () => {
  assert.equal(matchesHighMagnitude(draftRow({ status: "pending" })), false);
});

test("very_high_rewrite flag at >= 0.75", () => {
  assert.equal(isVeryHighRewrite(draftRow({ edit_delta_pct: 0.75 })), true);
  assert.equal(isVeryHighRewrite(draftRow({ edit_delta_pct: 0.74 })), false);
});

// --- build candidate -----------------------------------------------------------

test("non-matching draft -> excluded, no row built", () => {
  const res = buildFeedbackCandidateSuggestion(draftRow({ edit_classification: "no_edit", edit_delta_pct: 0.1 }));
  assert.equal(res.excluded, true);
  assert.ok(!res.row);
});

test("matching draft builds a valid suggestion with the right defaults", () => {
  const res = buildFeedbackCandidateSuggestion(draftRow({ edit_delta_pct: 0.88 }));
  assert.equal(res.ok, true);
  const { row } = res;
  assert.equal(row.suggestion_type, "eval_golden_case_suggestion");
  assert.equal(row.suggestion_type, CANDIDATE_SUGGESTION_TYPE);
  assert.equal(row.root_cause, "insufficient_data");
  assert.equal(row.status, "suggested");
  assert.equal(row.confidence, null);
  assert.equal(row.proposed_change_summary, null);
  assert.equal(row.shop_id, "shop_1");
  assert.equal(row.workspace_id, "ws_1");
  assert.equal(row.draft_id, "9576");
  assert.equal(row.thread_id, "6af8c627-…");
});

test("dedup_key is fb:{drafts.id}:eval_golden_case_suggestion and stable", () => {
  const a = buildFeedbackCandidateSuggestion(draftRow());
  const b = buildFeedbackCandidateSuggestion(draftRow());
  assert.equal(a.row.dedup_key, "fb:9576:eval_golden_case_suggestion");
  assert.equal(a.row.dedup_key, b.row.dedup_key);
});

// --- evidence shape + privacy --------------------------------------------------

test("evidence_json has the deterministic shape, final_sent_len numeric", () => {
  const res = buildFeedbackCandidateSuggestion(draftRow({ edit_delta_pct: 0.88, message_id: "m1" }));
  const ev = res.row.evidence_json;
  assert.equal(ev.source, "feedback-2a-2");
  assert.equal(ev.detector_version, DETECTOR_VERSION);
  assert.equal(ev.rule, "high_magnitude");
  assert.equal(ev.very_high_rewrite, true);
  assert.equal(ev.draft_row_id, 9576);
  assert.equal(ev.thread_id, "6af8c627-…");
  assert.equal(ev.message_id, "m1");
  assert.equal(ev.generation_id, null);
  assert.equal(ev.coupling, "none");
  assert.equal(ev.edit_classification, "major_edit");
  assert.equal(ev.edit_delta_pct, 0.88);
  assert.equal(ev.edit_distance, 458);
  assert.equal(typeof ev.final_sent_len, "number");
  assert.equal(ev.final_sent_len, 100);
  assert.equal(ev.sent_at, "2026-06-02");
});

test("evidence_json contains no raw body fields and no intent/product", () => {
  const res = buildFeedbackCandidateSuggestion(draftRow());
  const ev = res.row.evidence_json;
  for (const forbidden of [
    "final_sent_text", "customer_text", "customer_message", "draft_body",
    "draft_text", "email_body", "raw_text", "body_text", "clean_body_text",
    "intent", "product", "product_id",
  ]) {
    assert.ok(!(forbidden in ev), `evidence must not contain ${forbidden}`);
  }
  // belt-and-suspenders: no obviously-long string values (no smuggled bodies)
  for (const v of Object.values(ev)) {
    if (typeof v === "string") assert.ok(v.length <= 80, "no long text in evidence");
  }
});

// --- coupling discipline -------------------------------------------------------

test("reliable coupling sets generation_id + coupling=reliable", () => {
  const res = buildFeedbackCandidateSuggestion(draftRow(), {
    generation: { id: "gen_1" },
    couplingReliable: true,
  });
  assert.equal(res.row.generation_id, "gen_1");
  assert.equal(res.row.evidence_json.generation_id, "gen_1");
  assert.equal(res.row.evidence_json.coupling, "reliable");
});

test("ambiguous coupling does NOT set generation_id", () => {
  const res = buildFeedbackCandidateSuggestion(draftRow(), {
    generation: { id: "gen_1" },
    couplingReliable: false, // ambiguous -> ignore
  });
  assert.equal(res.row.generation_id, null);
  assert.equal(res.row.evidence_json.generation_id, null);
  assert.equal(res.row.evidence_json.coupling, "none");
});

// --- scope guard via helper ----------------------------------------------------

test("missing shop_id skips through the helper", () => {
  const res = buildFeedbackCandidateSuggestion(draftRow({ shop_id: null }));
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "missing_scope");
});

test("missing workspace_id skips through the helper", () => {
  const res = buildFeedbackCandidateSuggestion(draftRow({ workspace_id: null }));
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "missing_scope");
});

// --- mapper purity -------------------------------------------------------------

test("mapper is pure: ignores a passed serviceClient, returns data only", () => {
  const res = buildFeedbackCandidateSuggestion(draftRow(), {
    serviceClient: { from: () => { throw new Error("must not be used"); } },
  });
  assert.equal(res.ok, true);
});

test("mapper module references no auto-promotion / pipeline path", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../apps/web/lib/server/feedback-candidate-detector.js", import.meta.url)),
    "utf8",
  );
  for (const forbidden of [
    "draft_previews", "ticket_examples", "promoteEditToTicketExample",
    "captureV2DraftPreviewFeedback", "draft_preview_id", "generate-draft",
  ]) {
    assert.ok(!src.includes(forbidden), `mapper must not reference ${forbidden}`);
  }
});

// --- dry-run script structural guarantees --------------------------------------

test("dry-run script: no insert/update/upsert, no auto-promotion, --apply hard-fails", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../supabase/scripts/feedback-detect-candidates.mjs", import.meta.url)),
    "utf8",
  );
  // No write calls anywhere in the dry-run script.
  for (const writeCall of [".insert(", ".update(", ".upsert(", ".delete("]) {
    assert.ok(!src.includes(writeCall), `dry-run script must not call ${writeCall}`);
  }
  // No auto-promotion references.
  for (const forbidden of [
    "draft_previews", "ticket_examples", "promoteEditToTicketExample",
    "captureV2DraftPreviewFeedback", "draft_preview_id",
  ]) {
    assert.ok(!src.includes(forbidden), `dry-run script must not reference ${forbidden}`);
  }
  // It must read drafts and import the mapper.
  assert.ok(src.includes("feedback-candidate-detector"), "script imports the mapper");
  // An --apply path, if mentioned, must hard-fail as not implemented.
  if (src.includes("--apply") || src.includes('"apply"') || src.includes("'apply'")) {
    assert.ok(/not implemented/i.test(src), "--apply must hard-fail with 'not implemented'");
  }
  // Must not select raw body columns.
  for (const bodyCol of ["final_sent_text", "clean_body_text", "body_text", "body_html"]) {
    assert.ok(!src.includes(bodyCol), `script must not select ${bodyCol}`);
  }
});
