// Feedback Loop v1: pure distiller helpers (prompt build / parse / row build).
// Mirrors the plan in docs/superpowers/plans/2026-07-06-ten-out-of-ten-drafts.md Task 3.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDistillerPrompt,
  parseDistillerResponse,
  buildSuggestionFromDraftRow,
} from "../apps/web/lib/server/major-edit-distiller.js";

const DRAFT_ROW = {
  draft_id: "d-1",
  thread_id: "11111111-1111-1111-1111-111111111111",
  shop_id: "22222222-2222-2222-2222-222222222222",
  workspace_id: "33333333-3333-3333-3333-333333333333",
  ticket_category: "returns",
  edit_delta_pct: 71.2,
  ai_draft_text: "RÅ AI-TEKST",
  final_sent_text: "RÅ SENDT TEKST",
};

test("prompt includes both drafts and constrains root causes", () => {
  const { system, user } = buildDistillerPrompt({
    aiDraftText: "AI-UDKAST",
    finalSentText: "MEDARBEJDER-SVAR",
    ticketCategory: "tracking",
  });
  assert.match(user, /AI-UDKAST/);
  assert.match(user, /MEDARBEJDER-SVAR/);
  assert.match(user, /tracking/);
  assert.match(system, /style_tone/);
  assert.match(system, /missing_knowledge/);
  assert.match(system, /writer_style_rule_suggestion/);
});

test("parser rejects unknown root_cause", () => {
  assert.throws(
    () =>
      parseDistillerResponse(
        JSON.stringify({
          root_cause: "vibes",
          suggestion_type: "writer_style_rule_suggestion",
          proposed_change_summary: "x",
          confidence: 0.9,
        }),
      ),
    /root_cause/,
  );
});

test("parser rejects unknown suggestion_type", () => {
  assert.throws(
    () =>
      parseDistillerResponse(
        JSON.stringify({
          root_cause: "style_tone",
          suggestion_type: "auto_promote_everything",
          proposed_change_summary: "x",
          confidence: 0.9,
        }),
      ),
    /suggestion_type/,
  );
});

test("parser accepts valid classification and clamps confidence", () => {
  const out = parseDistillerResponse(
    JSON.stringify({
      root_cause: "style_tone",
      suggestion_type: "writer_style_rule_suggestion",
      proposed_change_summary:
        "Draften reciterede hele returpolitikken; medarbejderen sendte kun adressen.",
      confidence: 1.7,
    }),
  );
  assert.equal(out.root_cause, "style_tone");
  assert.equal(out.suggestion_type, "writer_style_rule_suggestion");
  assert.equal(out.confidence, 1);
});

test("suggestion row has dedup_key distill:<draft_id> and status suggested", () => {
  const result = buildSuggestionFromDraftRow({
    draftRow: DRAFT_ROW,
    classification: {
      root_cause: "missing_knowledge",
      suggestion_type: "knowledge_gap_suggestion",
      proposed_change_summary: "Mangler viden om byttemærkat for udenlandske ordrer.",
      confidence: 0.7,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.row.dedup_key, "distill:d-1");
  assert.equal(result.row.status, "suggested");
  assert.equal(result.row.shop_id, DRAFT_ROW.shop_id);
  assert.equal(result.row.workspace_id, DRAFT_ROW.workspace_id);
});

test("evidence_json carries metadata but never raw draft text", () => {
  const result = buildSuggestionFromDraftRow({
    draftRow: DRAFT_ROW,
    classification: {
      root_cause: "missing_knowledge",
      suggestion_type: "knowledge_gap_suggestion",
      proposed_change_summary: "Parafraseret opsummering.",
      confidence: 0.7,
    },
  });
  assert.equal(result.ok, true);
  const evidence = JSON.stringify(result.row.evidence_json);
  assert.ok(!evidence.includes("RÅ AI-TEKST"));
  assert.ok(!evidence.includes("RÅ SENDT TEKST"));
  assert.equal(result.row.evidence_json.edit_delta_pct, 71.2);
  assert.equal(result.row.evidence_json.source, "major_edit_distiller");
});

test("missing workspace scope is skipped, not built", () => {
  const result = buildSuggestionFromDraftRow({
    draftRow: { ...DRAFT_ROW, workspace_id: null },
    classification: {
      root_cause: "missing_knowledge",
      suggestion_type: "knowledge_gap_suggestion",
      proposed_change_summary: "x",
      confidence: 0.7,
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, "missing_scope");
});
