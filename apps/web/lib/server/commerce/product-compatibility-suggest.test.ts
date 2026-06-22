// @ts-nocheck
// Tests for the PURE write-guard planner + helpers behind
// POST /api/knowledge/product-compatibility/suggest (Slice G).
//
// Run: deno test product-compatibility-suggest.test.ts
//
// The planner decides which extracted (suggested) compatibility candidates are
// safe to upsert. It NEVER produces confirmed rows and NEVER overwrites
// confirmed / manual / metafield rows. The route is thin glue around this.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  missingEvidenceColumns,
  planSuggestedCompatibilityWrites,
  REQUIRED_EVIDENCE_COLUMNS,
  resolveWriteIntent,
} from "./product-compatibility-suggest.ts";

const SHOP = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";
const WS = "60c990b1-0d05-4019-b906-5a9fc3d70101";

function cand(target, connection, extra = {}) {
  return {
    product_id: 1,
    target,
    connection,
    compatible: "yes",
    condition: null,
    reason: null,
    workaround: null,
    evidence_text: "Compatibility: PC/Mac, PS4/5 (USB/Analog/Dongle)",
    source_url: "https://www.acezone.io/products/a-spire-wireless",
    source_type: "body_html",
    confidence: "suggested",
    source: "website_compatibility_extraction",
    extracted_at: "2026-06-22T00:00:00.000Z",
    needs_review: false,
    review_note: null,
    ...extra,
  };
}

function plan(products, existing) {
  return planSuggestedCompatibilityWrites({
    shopRefId: SHOP,
    workspaceId: WS,
    products,
    existing: existing ?? [],
  });
}

// --- write-intent gating (tests 1 + 2) -------------------------------------

Deno.test("resolveWriteIntent: dryRun and apply=false never write (defaults are safe)", () => {
  assertEquals(resolveWriteIntent({}).willWrite, false); // defaults: dryRun true, apply false
  assertEquals(resolveWriteIntent({ dryRun: true, apply: true }).willWrite, false);
  assertEquals(resolveWriteIntent({ dryRun: false, apply: false }).willWrite, false);
  assertEquals(resolveWriteIntent({ dryRun: false, apply: true }).willWrite, true);
});

// --- planner write-guard ----------------------------------------------------

Deno.test("3. apply path plans suggested-only rows, fully scoped, when nothing exists", () => {
  const { toWrite, skipped } = plan(
    [{ productId: 1, candidates: [cand("playstation", "usb_c"), cand("switch", "bluetooth")] }],
    [],
  );
  assertEquals(toWrite.length, 2);
  assertEquals(skipped.length, 0);
  for (const r of toWrite) {
    assertEquals(r.confidence, "suggested");
    assertEquals(r.source, "website_compatibility_extraction");
    assertEquals(r.shop_ref_id, SHOP);
    assertEquals(r.workspace_id, WS);
    assertEquals(r.product_id, 1);
    assert(r.evidence_text && r.source_url && r.source_type && r.extracted_at);
  }
});

Deno.test("4. an existing CONFIRMED row for the same target+connection is skipped (never overwritten)", () => {
  const { toWrite, skipped } = plan(
    [{ productId: 1, candidates: [cand("playstation", "usb_c")] }],
    [{ product_id: 1, target: "playstation", connection: "usb_c", confidence: "confirmed", source: "manual" }],
  );
  assertEquals(toWrite.length, 0);
  assertEquals(skipped[0].reason, "confirmed_exists");
});

Deno.test("5. an existing SUGGESTED website_compatibility_extraction row may be refreshed", () => {
  const { toWrite, skipped } = plan(
    [{ productId: 1, candidates: [cand("playstation", "usb_c")] }],
    [{ product_id: 1, target: "playstation", connection: "usb_c", confidence: "suggested", source: "website_compatibility_extraction" }],
  );
  assertEquals(toWrite.length, 1);
  assertEquals(skipped.length, 0);
});

Deno.test("6. manual/metafield rows are not overwritten", () => {
  const manual = plan(
    [{ productId: 1, candidates: [cand("xbox", "aux_3_5mm")] }],
    [{ product_id: 1, target: "xbox", connection: "aux_3_5mm", confidence: "confirmed", source: "manual" }],
  );
  assertEquals(manual.toWrite.length, 0);
  assertEquals(manual.skipped[0].reason, "confirmed_exists");

  const metafield = plan(
    [{ productId: 1, candidates: [cand("xbox", "aux_3_5mm")] }],
    // Even if a metafield row were somehow not 'confirmed', Shopify stays source of truth.
    [{ product_id: 1, target: "xbox", connection: "aux_3_5mm", confidence: "suggested", source: "metafield" }],
  );
  assertEquals(metafield.toWrite.length, 0);
  assertEquals(metafield.skipped[0].reason, "metafield_exists");
});

Deno.test("9. candidates are grouped by product and conflict/needs_review notes are preserved", () => {
  const conflict = cand("xbox", "aux_3_5mm", {
    compatible: "partial",
    needs_review: true,
    source_type: "ocr_chart",
    review_note: "Cross-source conflict: present in OCR comparison chart but absent from product body_html.",
  });
  const { toWrite, byProduct } = plan(
    [
      { productId: 1, candidates: [cand("playstation", "usb_c")] },
      { productId: 2, candidates: [conflict] },
    ],
    [],
  );
  // Conflicts are still written as suggested rows, flagged for review.
  const written = toWrite.find((r) => r.product_id === 2 && r.target === "xbox");
  assert(written && written.needs_review === true);
  assert(written.review_note.toLowerCase().includes("conflict"));
  assertEquals(written.confidence, "suggested");
  // Grouped output keyed by product id.
  assert(byProduct["1"] && byProduct["2"]);
  assertEquals(byProduct["2"][0].target, "xbox");
});

Deno.test("10. un-writable ambiguous candidates (null connection / null target) are skipped, not written", () => {
  const { toWrite, skipped, byProduct } = plan(
    [{
      productId: 1,
      candidates: [
        cand("pc", null, { needs_review: true, review_note: "Connection method not stated." }),
        cand(null, "usb_c", { needs_review: true, review_note: "Unrecognized platform." }),
      ],
    }],
    [],
  );
  assertEquals(toWrite.length, 0, "rows with null target/connection cannot satisfy the NOT NULL schema");
  const reasons = skipped.map((s) => s.reason).sort();
  assertEquals(reasons, ["connection_unspecified", "unrecognized_platform"]);
  // Still surfaced for the human in the grouped dry-run view.
  assertEquals(byProduct["1"].length, 2);
});

// --- missing-column safety for apply=true (test 7) --------------------------

Deno.test("7. missingEvidenceColumns reports columns needed before apply=true can write", () => {
  assertEquals(missingEvidenceColumns(REQUIRED_EVIDENCE_COLUMNS), []);
  const partial = ["evidence_text", "source_url"]; // pre-migration-ish
  const missing = missingEvidenceColumns(partial);
  assert(missing.includes("condition"));
  assert(missing.includes("review_note"));
  assert(missing.includes("extracted_at"));
  // The base columns that always existed are NOT in the required-new set.
  assert(!REQUIRED_EVIDENCE_COLUMNS.includes("reason"));
  assert(!REQUIRED_EVIDENCE_COLUMNS.includes("workaround"));
});
