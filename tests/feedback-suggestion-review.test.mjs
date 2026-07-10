// Run with: node --test tests/
//
// Feedback-2b: pure helper for the suggestion review flow (list → review).
//
// buildSuggestionReviewPatch shapes the UPDATE for a human review decision.
// Pinned invariants: only reviewed/approved/rejected are reachable from the
// review route ('applied' stays reserved for a future controlled apply flow,
// 'suggested' is not re-enterable), applied rows are immutable, a reviewer id
// is required, and the note is trimmed/bounded.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSuggestionReviewPatch,
  MAX_REVIEW_NOTE_LEN,
} from "../apps/web/lib/server/feedback-suggestions.js";

const NOW = "2026-07-06T22:00:00.000Z";
const BASE = {
  currentStatus: "suggested",
  nextStatus: "approved",
  reviewerUserId: "user_abc",
  now: NOW,
};

test("approves a suggested row with reviewer + timestamps", () => {
  const r = buildSuggestionReviewPatch({ ...BASE, reviewNote: "  god case  " });
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, {
    status: "approved",
    reviewer_user_id: "user_abc",
    review_note: "god case",
    reviewed_at: NOW,
    updated_at: NOW,
  });
});

test("allows suggested → reviewed and suggested → rejected", () => {
  for (const nextStatus of ["reviewed", "rejected"]) {
    const r = buildSuggestionReviewPatch({ ...BASE, nextStatus });
    assert.equal(r.ok, true, nextStatus);
    assert.equal(r.patch.status, nextStatus);
  }
});

test("allows correcting a decision between reviewed/approved/rejected", () => {
  for (const currentStatus of ["reviewed", "approved", "rejected"]) {
    for (const nextStatus of ["reviewed", "approved", "rejected"]) {
      const r = buildSuggestionReviewPatch({ ...BASE, currentStatus, nextStatus });
      assert.equal(r.ok, true, `${currentStatus} → ${nextStatus}`);
    }
  }
});

test("never sets 'applied' via review (reserved for controlled apply flow)", () => {
  const r = buildSuggestionReviewPatch({ ...BASE, nextStatus: "applied" });
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid target status/i);
});

test("never re-enters 'suggested'", () => {
  const r = buildSuggestionReviewPatch({
    ...BASE,
    currentStatus: "approved",
    nextStatus: "suggested",
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid target status/i);
});

test("applied rows are immutable", () => {
  const r = buildSuggestionReviewPatch({ ...BASE, currentStatus: "applied" });
  assert.equal(r.ok, false);
  assert.match(r.error, /applied/i);
});

test("rejects unknown current status", () => {
  const r = buildSuggestionReviewPatch({ ...BASE, currentStatus: "weird" });
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown current status/i);
});

test("requires a reviewer user id", () => {
  const r = buildSuggestionReviewPatch({ ...BASE, reviewerUserId: "" });
  assert.equal(r.ok, false);
  assert.match(r.error, /reviewer/i);
});

test("empty/whitespace note becomes null, long note is bounded", () => {
  const empty = buildSuggestionReviewPatch({ ...BASE, reviewNote: "   " });
  assert.equal(empty.patch.review_note, null);

  const long = buildSuggestionReviewPatch({
    ...BASE,
    reviewNote: "x".repeat(MAX_REVIEW_NOTE_LEN + 50),
  });
  assert.equal(long.patch.review_note.length, MAX_REVIEW_NOTE_LEN);
});
