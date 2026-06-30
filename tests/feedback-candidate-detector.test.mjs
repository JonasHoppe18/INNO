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
  applyFeedbackCandidates,
  APPLY_ONCONFLICT,
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

// --- apply orchestration (pure, injected upsert) -------------------------------

function candidateRow(overrides = {}) {
  const res = buildFeedbackCandidateSuggestion(draftRow(overrides));
  return res.row;
}

function makeUpsert({ returnInserted } = {}) {
  const calls = [];
  return {
    calls,
    fn: async (rows, options) => {
      calls.push({ rows, options });
      const data = (returnInserted ?? rows).map((r) => ({ id: "x", dedup_key: r.dedup_key }));
      return { data, error: null };
    },
  };
}

test("apply: dry-run (default) never calls upsert", async () => {
  const u = makeUpsert();
  const res = await applyFeedbackCandidates([candidateRow()], { upsert: u.fn, dryRun: true });
  assert.equal(u.calls.length, 0);
  assert.equal(res.dryRun, true);
  assert.equal(res.inserted, 0);
});

test("apply: inserts suggested rows with onConflict=dedup_key ignoreDuplicates", async () => {
  const u = makeUpsert();
  const rows = [candidateRow({ id: 1 }), candidateRow({ id: 2 })];
  const res = await applyFeedbackCandidates(rows, { upsert: u.fn, dryRun: false });
  assert.equal(u.calls.length, 1);
  assert.equal(u.calls[0].options.onConflict, "dedup_key");
  assert.equal(APPLY_ONCONFLICT, "dedup_key");
  assert.equal(u.calls[0].options.ignoreDuplicates, true);
  assert.equal(res.attempted, 2);
  assert.equal(res.inserted, 2);
  assert.equal(res.duplicates, 0);
  // every row written carries status 'suggested', never 'applied'
  for (const r of u.calls[0].rows) assert.equal(r.status, "suggested");
});

test("apply: duplicate dedup_key is a skipped success, not fatal", async () => {
  const rows = [candidateRow({ id: 1 }), candidateRow({ id: 2 })];
  const u = makeUpsert({ returnInserted: [rows[0]] }); // row 2 already existed
  const res = await applyFeedbackCandidates(rows, { upsert: u.fn, dryRun: false });
  assert.equal(res.inserted, 1);
  assert.equal(res.duplicates, 1);
});

test("apply: repeated apply is idempotent (all duplicates -> 0 inserted)", async () => {
  const rows = [candidateRow({ id: 1 }), candidateRow({ id: 2 })];
  const u = makeUpsert({ returnInserted: [] }); // everything already present
  const res = await applyFeedbackCandidates(rows, { upsert: u.fn, dryRun: false });
  assert.equal(res.inserted, 0);
  assert.equal(res.duplicates, 2);
});

test("apply: refuses to write a row whose status is not 'suggested'", async () => {
  const u = makeUpsert();
  const bad = { ...candidateRow(), status: "applied" };
  await assert.rejects(
    () => applyFeedbackCandidates([bad], { upsert: u.fn, dryRun: false }),
    /suggested/,
  );
  assert.equal(u.calls.length, 0, "nothing written when guard trips");
});

test("apply: surfaces upsert error without throwing", async () => {
  const u = { fn: async () => ({ data: null, error: { message: "boom" } }) };
  const res = await applyFeedbackCandidates([candidateRow()], { upsert: u.fn, dryRun: false });
  assert.equal(res.inserted, 0);
  assert.ok(res.error);
});

// --- script structural guarantees (2a-3) ---------------------------------------

test("script: dry-run default, upsert guarded by --apply, no bodies, no auto-promotion", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../supabase/scripts/feedback-detect-candidates.mjs", import.meta.url)),
    "utf8",
  );
  // Writes go only through upsert (insert-only via ignoreDuplicates); never
  // update/delete existing rows.
  for (const writeCall of [".insert(", ".update(", ".delete("]) {
    assert.ok(!src.includes(writeCall), `script must not call ${writeCall}`);
  }
  assert.ok(src.includes(".upsert("), "apply path uses upsert");
  assert.ok(src.includes("opts.apply"), "upsert is guarded by --apply");
  assert.ok(/dry.?run/i.test(src), "has a dry-run path");
  // Never writes status='applied'.
  assert.ok(!/status['"\s:]+['"]applied['"]/.test(src), "must not set status='applied'");
  // No auto-promotion references.
  for (const forbidden of [
    "draft_previews", "ticket_examples", "promoteEditToTicketExample",
    "captureV2DraftPreviewFeedback", "draft_preview_id",
  ]) {
    assert.ok(!src.includes(forbidden), `script must not reference ${forbidden}`);
  }
  // No raw body columns selected.
  for (const bodyCol of ["final_sent_text", "clean_body_text", "body_text", "body_html", "quoted_body_text"]) {
    assert.ok(!src.includes(bodyCol), `script must not select ${bodyCol}`);
  }
  assert.ok(src.includes("feedback-candidate-detector"), "script imports the mapper");
  assert.ok(src.includes("applyFeedbackCandidates"), "script uses the apply orchestrator");
});
