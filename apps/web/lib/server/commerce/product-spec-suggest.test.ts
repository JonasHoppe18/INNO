// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { planSuggestedSpecWrites } from "./product-spec-suggest.ts";

const SHOP = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";
const WS = "60c990b1-0d05-4019-b906-5a9fc3d70101";

function extracted(spec_key, extra = {}) {
  return {
    spec_key,
    spec_group: "audio",
    spec_value: "X",
    value_bool: null,
    value_num: null,
    unit: null,
    comparable: true,
    confidence: "suggested",
    source: "product_page_extraction",
    evidence_text: `evidence for ${spec_key}`,
    source_url: "https://www.acezone.io/products/a-blaze",
    extracted_at: "2026-06-20T00:00:00.000Z",
    needs_review: false,
    ...extra,
  };
}

function plan(products, existing) {
  return planSuggestedSpecWrites({
    shopRefId: SHOP,
    workspaceId: WS,
    products,
    existing,
  });
}

Deno.test("a new suggested spec with no existing row is written with full scoping + provenance", () => {
  const { toWrite, skipped } = plan(
    [{ productId: 1, specs: [extracted("eq_app_bands", { value_num: 8 })] }],
    [],
  );
  assertEquals(skipped.length, 0);
  assertEquals(toWrite.length, 1);
  const r = toWrite[0];
  assertEquals(r.shop_ref_id, SHOP);
  assertEquals(r.workspace_id, WS);
  assertEquals(r.product_id, 1);
  assertEquals(r.confidence, "suggested");
  assertEquals(r.source, "product_page_extraction");
  assertEquals(r.evidence_text, "evidence for eq_app_bands");
  assertEquals(r.source_url, "https://www.acezone.io/products/a-blaze");
});

Deno.test("a CONFIRMED existing spec is never overwritten (skipped confirmed_exists)", () => {
  const { toWrite, skipped } = plan(
    [{ productId: 1, specs: [extracted("dac_quality")] }],
    [{ product_id: 1, spec_key: "dac_quality", confidence: "confirmed", source: "manual" }],
  );
  assertEquals(toWrite.length, 0);
  assertEquals(skipped, [{ product_id: 1, spec_key: "dac_quality", reason: "confirmed_exists" }]);
});

Deno.test("a metafield-sourced existing spec is never overwritten (skipped metafield_exists)", () => {
  const { toWrite, skipped } = plan(
    [{ productId: 1, specs: [extracted("eq_app_bands") ] }],
    [{ product_id: 1, spec_key: "eq_app_bands", confidence: "suggested", source: "metafield" }],
  );
  assertEquals(toWrite.length, 0);
  assertEquals(skipped[0].reason, "metafield_exists");
});

Deno.test("an existing product_page_extraction suggestion may be re-written (idempotent refresh)", () => {
  const { toWrite, skipped } = plan(
    [{ productId: 1, specs: [extracted("eq_app_bands", { value_num: 8 })] }],
    [{ product_id: 1, spec_key: "eq_app_bands", confidence: "suggested", source: "product_page_extraction" }],
  );
  assertEquals(skipped.length, 0);
  assertEquals(toWrite.length, 1);
});

Deno.test("guard is per (product_id, spec_key) — same key on another product still writes", () => {
  const { toWrite } = plan(
    [
      { productId: 1, specs: [extracted("dac_quality")] },
      { productId: 2, specs: [extracted("dac_quality")] },
    ],
    [{ product_id: 1, spec_key: "dac_quality", confidence: "confirmed", source: "manual" }],
  );
  // product 1 confirmed -> skip; product 2 -> write
  assertEquals(toWrite.map((r) => r.product_id), [2]);
});

Deno.test("needs_review flag is preserved into the write row", () => {
  const { toWrite } = plan(
    [{ productId: 1, specs: [extracted("dac_quality", { needs_review: true, spec_value: "48 kHz / 24-bit" })] }],
    [],
  );
  assertEquals(toWrite[0].needs_review, true);
});
