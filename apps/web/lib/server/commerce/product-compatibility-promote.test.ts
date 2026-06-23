// @ts-nocheck
// Tests for the PURE promote planner + helpers behind
// POST /api/knowledge/product-compatibility/promote (Slice I).
//
// Run: deno test --no-check product-compatibility-promote.test.ts
//
// The planner decides which SUGGESTED compatibility rows are eligible to be
// promoted to confirmed. It never promotes confirmed rows, never promotes
// conflict/ocr_chart rows without force, and never touches rows outside the
// requested + scoped set. The route is thin glue around this.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildPromotionUpdate,
  planCompatibilityPromotion,
  PROMOTE_SOURCE,
  resolvePromoteIntent,
} from "./product-compatibility-promote.ts";

const SHOP = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";

function row(id, extra = {}) {
  return {
    id,
    shop_ref_id: SHOP,
    source: PROMOTE_SOURCE,
    confidence: "suggested",
    source_type: "body_html",
    review_note: null,
    ...extra,
  };
}

function plan(ids, rows, force = false) {
  return planCompatibilityPromotion({ ids, rows, force });
}

// --- promote-intent gating (tests 1 + 2) -----------------------------------

Deno.test("resolvePromoteIntent: dryRun and apply=false never write (defaults safe)", () => {
  assertEquals(resolvePromoteIntent({}).willWrite, false);
  assertEquals(resolvePromoteIntent({ dryRun: true, apply: true }).willWrite, false);
  assertEquals(resolvePromoteIntent({ dryRun: false, apply: false }).willWrite, false);
  assertEquals(resolvePromoteIntent({ dryRun: false, apply: true }).willWrite, true);
});

// --- planner eligibility ----------------------------------------------------

Deno.test("3. only suggested rows in the scoped/fetched set are eligible", () => {
  const { toPromote, skipped } = plan(
    [4, 6],
    [row(4), row(6)],
  );
  assertEquals(toPromote.sort(), [4, 6]);
  assertEquals(skipped.length, 0);
});

Deno.test("4. confirmed rows are skipped", () => {
  const { toPromote, skipped } = plan([4], [row(4, { confidence: "confirmed" })]);
  assertEquals(toPromote.length, 0);
  assertEquals(skipped[0].reason, "already_confirmed");
});

Deno.test("5. rows with a review_note are skipped unless force=true", () => {
  const r = row(5, { review_note: "Cross-source conflict…", source_type: "ocr_chart" });
  assertEquals(plan([5], [r], false).toPromote.length, 0);
  assertEquals(plan([5], [r], false).skipped[0].reason, "review_note_requires_force");
  assertEquals(plan([5], [r], true).toPromote, [5]); // force overrides
});

Deno.test("6. rows with source_type='ocr_chart' are skipped unless force=true", () => {
  const r = row(99, { source_type: "ocr_chart", review_note: null });
  assertEquals(plan([99], [r], false).toPromote.length, 0);
  assertEquals(plan([99], [r], false).skipped[0].reason, "ocr_chart_requires_force");
  assertEquals(plan([99], [r], true).toPromote, [99]);
});

Deno.test("7. ids not present in the scoped/fetched set (e.g. another shop) are skipped", () => {
  // The route fetches only shop-scoped + correct-source rows; an id from another
  // shop simply isn't in `rows`.
  const { toPromote, skipped } = plan([4, 12345], [row(4)]);
  assertEquals(toPromote, [4]);
  assertEquals(skipped[0].id, 12345);
  assertEquals(skipped[0].reason, "not_found_or_out_of_scope");
});

Deno.test("7b. rows of a different source are skipped (defense in depth)", () => {
  const { toPromote, skipped } = plan([1], [row(1, { source: "manual" })]);
  assertEquals(toPromote.length, 0);
  assertEquals(skipped[0].reason, "wrong_source");
});

// --- update payload (tests 8 + 9) ------------------------------------------

Deno.test("8. promotion update never touches evidence/source/condition fields", () => {
  const upd = buildPromotionUpdate({ reviewedBy: "user_123", reviewNote: "Approved", now: "2026-06-22T00:00:00Z" });
  for (const forbidden of ["evidence_text", "source_url", "source_type", "condition", "target", "connection", "compatible"]) {
    assert(!(forbidden in upd), `update must not set ${forbidden}`);
  }
});

Deno.test("9. promotion update sets confidence=confirmed + reviewed_at/by + review_note", () => {
  const upd = buildPromotionUpdate({ reviewedBy: "user_123", reviewNote: "Approved from body_html", now: "2026-06-22T00:00:00Z" });
  assertEquals(upd.confidence, "confirmed");
  assertEquals(upd.reviewed_at, "2026-06-22T00:00:00Z");
  assertEquals(upd.reviewed_by, "user_123");
  assertEquals(upd.review_note, "Approved from body_html");
  // reviewed_by falls back to a system identifier when no user is available.
  assertEquals(buildPromotionUpdate({}).reviewed_by, "system");
  // review_note is only set when provided (never blanked).
  assert(!("review_note" in buildPromotionUpdate({ reviewedBy: "x" })));
});

// --- the real AceZone set (test 10 + dryRun example) -----------------------

Deno.test("10. AceZone set: force=false promotes the 16 safe ids and skips 5 & 16", () => {
  const safeIds = [4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21];
  const rows = [
    ...safeIds.map((id) => row(id)),
    row(5, { source_type: "ocr_chart", review_note: "Cross-source conflict…" }),
    row(16, { source_type: "ocr_chart", review_note: "Cross-source conflict…" }),
  ];
  const { toPromote, skipped } = plan([...safeIds, 5, 16], rows, false);
  assertEquals(toPromote.sort((a, b) => a - b), safeIds);
  assertEquals(skipped.map((s) => s.id).sort((a, b) => a - b), [5, 16]);
});
