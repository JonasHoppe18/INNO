import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildComparisonDirective,
  buildComparisonProvenance,
  buildSpecComparison,
  detectComparisonQuery,
  isComparisonQuestion,
  resolveProductSpecs,
  type SpecRow,
} from "./product-specs.ts";

const rows: SpecRow[] = [
  // brand-wide
  { product_id: null, spec_key: "warranty_years", spec_group: "general", spec_value: "2", value_bool: null, value_num: 2, unit: "years", display_order: 90, comparable: true, confidence: "confirmed" },
  // A-Blaze (id 1)
  { product_id: 1, spec_key: "dac_quality", spec_group: "audio", spec_value: "Better than A-Spire, below A-Spire Wireless", value_bool: null, value_num: null, unit: null, display_order: 10, comparable: true, confidence: "confirmed" },
  { product_id: 1, spec_key: "eq_app_bands", spec_group: "audio", spec_value: "8", value_bool: null, value_num: 8, unit: "bands", display_order: 20, comparable: true, confidence: "confirmed" },
  { product_id: 1, spec_key: "glasses_mode", spec_group: "comfort", spec_value: "Yes", value_bool: true, value_num: null, unit: null, display_order: 30, comparable: true, confidence: "confirmed" },
  // A-Spire Wireless (id 2)
  { product_id: 2, spec_key: "dac_quality", spec_group: "audio", spec_value: "Best (flagship)", value_bool: null, value_num: null, unit: null, display_order: 10, comparable: true, confidence: "confirmed" },
  { product_id: 2, spec_key: "anc_app_control", spec_group: "audio", spec_value: "Yes", value_bool: true, value_num: null, unit: null, display_order: 15, comparable: true, confidence: "confirmed" },
  { product_id: 2, spec_key: "eq_app_bands", spec_group: "audio", spec_value: "8", value_bool: null, value_num: 8, unit: "bands", display_order: 20, comparable: true, confidence: "confirmed" },
  // non-comparable + suggested noise
  { product_id: 2, spec_key: "internal_sku_note", spec_group: "general", spec_value: "n/a", value_bool: null, value_num: null, unit: null, display_order: 5, comparable: false, confidence: "confirmed" },
  { product_id: 2, spec_key: "glasses_mode", spec_group: "comfort", spec_value: "Yes", value_bool: true, value_num: null, unit: null, display_order: 30, comparable: true, confidence: "suggested" },
];

Deno.test("resolveProductSpecs returns only confirmed specs for a product, plus brand-wide", () => {
  const specs = resolveProductSpecs(rows, { productId: 1 });
  const keys = specs.map((s) => s.spec_key).sort();
  // A-Blaze confirmed: dac_quality, eq_app_bands, glasses_mode + brand warranty_years
  assertEquals(keys, ["dac_quality", "eq_app_bands", "glasses_mode", "warranty_years"]);
});

Deno.test("product-specific spec overrides brand-wide spec for the same key", () => {
  const withBrandDac: SpecRow[] = [
    { product_id: null, spec_key: "dac_quality", spec_group: "audio", spec_value: "Standard", value_bool: null, value_num: null, unit: null, display_order: 10, comparable: true, confidence: "confirmed" },
    { product_id: 1, spec_key: "dac_quality", spec_group: "audio", spec_value: "Better", value_bool: null, value_num: null, unit: null, display_order: 10, comparable: true, confidence: "confirmed" },
  ];
  const specs = resolveProductSpecs(withBrandDac, { productId: 1 });
  assertEquals(specs.length, 1);
  assertEquals(specs[0].spec_value, "Better");
  // A different product falls back to brand-wide.
  assertEquals(resolveProductSpecs(withBrandDac, { productId: 9 })[0].spec_value, "Standard");
});

Deno.test("suggested specs are never served as confirmed", () => {
  const specs = resolveProductSpecs(rows, { productId: 2 });
  // glasses_mode for product 2 is suggested -> excluded.
  assert(!specs.some((s) => s.spec_key === "glasses_mode"));
});

Deno.test("buildSpecComparison aligns by spec_key, orders by display_order, comparable-only", () => {
  const cmp = buildSpecComparison([
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(rows, { productId: 1 }) },
    { productId: 2, title: "A-Spire Wireless", specs: resolveProductSpecs(rows, { productId: 2 }) },
  ]);
  // Ordered by display_order: dac_quality(10), anc_app_control(15), eq_app_bands(20), glasses_mode(30), warranty_years(90)
  assertEquals(cmp.map((r) => r.spec_key), [
    "dac_quality",
    "anc_app_control",
    "eq_app_bands",
    "glasses_mode",
    "warranty_years",
  ]);
  // Non-comparable internal_sku_note never appears.
  assert(!cmp.some((r) => r.spec_key === "internal_sku_note"));
});

Deno.test("comparison shows 'Not specified' when a confirmed spec is missing for a product (never guesses)", () => {
  const cmp = buildSpecComparison([
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(rows, { productId: 1 }) },
    { productId: 2, title: "A-Spire Wireless", specs: resolveProductSpecs(rows, { productId: 2 }) },
  ]);
  const anc = cmp.find((r) => r.spec_key === "anc_app_control")!;
  const blaze = anc.values.find((v) => v.title === "A-Blaze")!;
  const wireless = anc.values.find((v) => v.title === "A-Spire Wireless")!;
  assertEquals(blaze.value, "Not specified"); // A-Blaze has no confirmed anc_app_control
  assertEquals(wireless.value, "Yes");
  // glasses_mode: A-Blaze=Yes(confirmed), A-Spire Wireless=Not specified (its row was suggested)
  const glasses = cmp.find((r) => r.spec_key === "glasses_mode")!;
  assertEquals(glasses.values.find((v) => v.title === "A-Spire Wireless")!.value, "Not specified");
});

Deno.test("detectComparisonQuery finds the two products being compared", () => {
  const titles = ["A-Blaze", "A-Spire", "A-Spire Wireless", "A-Rise"];
  assertEquals(
    detectComparisonQuery("What is the difference between A-Blaze and A-Spire Wireless?", titles).sort(),
    ["A-Blaze", "A-Spire Wireless"],
  );
  assertEquals(
    detectComparisonQuery("Which is better, A-Blaze or A-Spire Wireless?", titles).sort(),
    ["A-Blaze", "A-Spire Wireless"],
  );
});

Deno.test("isComparisonQuestion requires a comparison cue and 2+ products", () => {
  const titles = ["A-Blaze", "A-Spire Wireless"];
  assert(isComparisonQuestion("A-Blaze vs A-Spire Wireless", titles));
  assert(isComparisonQuestion("difference between A-Blaze and A-Spire Wireless", titles));
  assertEquals(isComparisonQuestion("Tell me about A-Blaze", titles), false); // one product
  assertEquals(isComparisonQuestion("Where is my order?", titles), false);
});

Deno.test("buildComparisonDirective renders the table and a no-guess rule when comparable specs exist", () => {
  const cmp = buildSpecComparison([
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(rows, { productId: 1 }) },
    { productId: 2, title: "A-Spire Wireless", specs: resolveProductSpecs(rows, { productId: 2 }) },
  ]);
  const block = buildComparisonDirective(
    cmp,
    [
      { productId: 1, title: "A-Blaze", specs: [] },
      { productId: 2, title: "A-Spire Wireless", specs: [] },
    ],
    { wasAsked: true },
  );
  assert(block.includes("A-Blaze"));
  assert(block.includes("A-Spire Wireless"));
  assert(block.includes("dac_quality") || /DAC/i.test(block));
  assert(/not specified/i.test(block));
  assert(/do not (guess|invent)/i.test(block));
});

Deno.test("evidence/review fields do not affect comparison output (Stage 4B-3-2d)", () => {
  const plain: SpecRow[] = [
    { product_id: 1, spec_key: "dac_quality", spec_group: "audio", spec_value: "48 kHz / 24-bit", value_bool: null, value_num: null, unit: null, display_order: 10, comparable: true, confidence: "confirmed" },
  ];
  const withEvidence: SpecRow[] = [
    {
      ...plain[0],
      evidence_text: "DAC: 48 kHz / 24-bit",
      source_url: "https://www.acezone.io/products/a-blaze",
      extracted_at: "2026-06-20T00:00:00Z",
      reviewed_at: null,
      reviewed_by: null,
      review_note: null,
    },
  ];
  const a = buildSpecComparison([
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(plain, { productId: 1 }) },
  ]);
  const b = buildSpecComparison([
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(withEvidence, { productId: 1 }) },
  ]);
  assertEquals(b, a);
});

Deno.test("a suggested spec carrying evidence is still never served (Stage 4B-3-2d)", () => {
  const suggestedWithEvidence: SpecRow[] = [
    {
      product_id: 1, spec_key: "dac_quality", spec_group: "audio",
      spec_value: "Better than A-Spire (per 3927)", value_bool: null, value_num: null,
      unit: null, display_order: 10, comparable: true, confidence: "suggested",
      evidence_text: "manual_text 3927 says A-Blaze has a better DAC",
      source_url: null, extracted_at: "2026-06-20T00:00:00Z",
      reviewed_at: null, reviewed_by: null, review_note: "conflicts product page",
    },
  ];
  assertEquals(resolveProductSpecs(suggestedWithEvidence, { productId: 1 }).length, 0);
});

// --- Stage 4B-3-2h: positioning / customer guidance -----------------------

const positioningRows: SpecRow[] = [
  // A-Blaze (1) positioning — comparable=false
  { product_id: 1, spec_key: "best_for", spec_group: "positioning", spec_value: "Customers who want strong wireless gaming at a lower price.", value_bool: null, value_num: null, unit: null, display_order: 200, comparable: false, confidence: "confirmed" },
  { product_id: 1, spec_key: "tradeoff", spec_group: "positioning", spec_value: "Fewer app-controlled features than A-Spire Wireless.", value_bool: null, value_num: null, unit: null, display_order: 202, comparable: false, confidence: "confirmed" },
  // A-Spire Wireless (2) positioning
  { product_id: 2, spec_key: "best_for", spec_group: "positioning", spec_value: "Customers who want the most feature-rich wireless headset.", value_bool: null, value_num: null, unit: null, display_order: 200, comparable: false, confidence: "confirmed" },
  // a SUGGESTED positioning row that must never surface
  { product_id: 2, spec_key: "main_advantage", spec_group: "positioning", spec_value: "(unconfirmed marketing claim)", value_bool: null, value_num: null, unit: null, display_order: 201, comparable: false, confidence: "suggested" },
];

function positioningProducts() {
  const all = [...rows, ...positioningRows];
  return [
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(all, { productId: 1 }) },
    { productId: 2, title: "A-Spire Wireless", specs: resolveProductSpecs(all, { productId: 2 }) },
  ];
}

Deno.test("positioning section appears when confirmed positioning rows exist", () => {
  const ps = positioningProducts();
  const block = buildComparisonDirective(buildSpecComparison(ps), ps, { wasAsked: true });
  assert(/positioning|customer guidance/i.test(block), "no positioning section");
  assert(block.includes("Customers who want strong wireless gaming at a lower price."));
  assert(block.includes("Customers who want the most feature-rich wireless headset."));
});

Deno.test("suggested positioning rows are ignored in the positioning section", () => {
  const block = buildComparisonDirective(buildSpecComparison(positioningProducts()), positioningProducts(), { wasAsked: true });
  assert(!block.includes("(unconfirmed marketing claim)"));
});

Deno.test("comparable=false positioning rows do not appear in the technical comparison table", () => {
  const cmp = buildSpecComparison(positioningProducts());
  for (const key of ["best_for", "tradeoff", "main_advantage"]) {
    assert(!cmp.some((r) => r.spec_key === key), `${key} leaked into comparison table`);
  }
});

Deno.test("existing comparable technical comparison output is unchanged by positioning rows", () => {
  const withPos = buildSpecComparison(positioningProducts());
  const withoutPos = buildSpecComparison([
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(rows, { productId: 1 }) },
    { productId: 2, title: "A-Spire Wireless", specs: resolveProductSpecs(rows, { productId: 2 }) },
  ]);
  assertEquals(withPos.map((r) => r.spec_key), withoutPos.map((r) => r.spec_key));
});

Deno.test("positioning section is absent when no positioning rows exist", () => {
  const ps = [
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(rows, { productId: 1 }) },
    { productId: 2, title: "A-Spire Wireless", specs: resolveProductSpecs(rows, { productId: 2 }) },
  ];
  const block = buildComparisonDirective(buildSpecComparison(ps), ps, { wasAsked: true });
  assert(!/# (positioning|customer guidance)/i.test(block));
});

Deno.test("directive includes natural-writing guidance", () => {
  const ps = positioningProducts();
  const block = buildComparisonDirective(buildSpecComparison(ps), ps, { wasAsked: true });
  assert(/who each product is for|practical difference/i.test(block));
  assert(/dry key-value dump|natural/i.test(block));
  assert(/recommendation/i.test(block));
  // Guidance explicitly forbids contested fields.
  assert(/do not mention DAC/i.test(block));
});

Deno.test("directive still excludes a SUGGESTED dac_quality (never a fact line)", () => {
  const withSuggestedDac: SpecRow[] = [
    { product_id: 1, spec_key: "eq_app_bands", spec_group: "audio", spec_value: "8", value_bool: null, value_num: 8, unit: "bands", display_order: 20, comparable: true, confidence: "confirmed" },
    { product_id: 1, spec_key: "dac_quality", spec_group: "audio", spec_value: "48 kHz / 24-bit", value_bool: null, value_num: null, unit: null, display_order: 10, comparable: true, confidence: "suggested" },
    { product_id: 2, spec_key: "eq_app_bands", spec_group: "audio", spec_value: "8", value_bool: null, value_num: 8, unit: "bands", display_order: 20, comparable: true, confidence: "confirmed" },
    { product_id: 2, spec_key: "dac_quality", spec_group: "audio", spec_value: "384 kHz / 24-bit", value_bool: null, value_num: null, unit: null, display_order: 10, comparable: true, confidence: "suggested" },
  ];
  const ps = [
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(withSuggestedDac, { productId: 1 }) },
    { productId: 2, title: "A-Spire Wireless", specs: resolveProductSpecs(withSuggestedDac, { productId: 2 }) },
  ];
  const block = buildComparisonDirective(buildSpecComparison(ps), ps, { wasAsked: true });
  assert(!/^- dac_quality/im.test(block), "suggested dac_quality must not appear as a fact line");
});

Deno.test("buildComparisonDirective returns empty when no comparable confirmed specs exist", () => {
  assertEquals(buildComparisonDirective([], [], { wasAsked: true }), "");
  // also empty when not asked
  const cmp = buildSpecComparison([
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(rows, { productId: 1 }) },
  ]);
  assertEquals(buildComparisonDirective(cmp, [], { wasAsked: false }), "");
});

// --- Stage 5, Slice 1: comparison provenance ------------------------------

Deno.test("buildComparisonProvenance exposes confirmed comparison facts from shop_product_specs", () => {
  const ps = [
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(rows, { productId: 1 }) },
    { productId: 2, title: "A-Spire Wireless", specs: resolveProductSpecs(rows, { productId: 2 }) },
  ];
  const prov = buildComparisonProvenance(buildSpecComparison(ps), ps);

  // Every entry is a confirmed structured fact sourced from the specs table.
  assert(prov.length > 0);
  for (const f of prov) {
    assertEquals(f.confidence, "confirmed");
    assertEquals(f.origin_table, "shop_product_specs");
  }
  const eq = prov.find((f) => f.key === "eq_app_bands");
  assert(eq, "expected eq_app_bands comparison fact");
  assertEquals(eq!.type, "comparison");
  assertEquals(eq!.product_titles, ["A-Blaze", "A-Spire Wireless"]);
  assert(eq!.value.includes("A-Blaze"));
  assert(eq!.value.includes("A-Spire Wireless"));
});

Deno.test("buildComparisonProvenance never leaks a suggested spec value (shows Not specified)", () => {
  const ps = [
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(rows, { productId: 1 }) },
    { productId: 2, title: "A-Spire Wireless", specs: resolveProductSpecs(rows, { productId: 2 }) },
  ];
  const prov = buildComparisonProvenance(buildSpecComparison(ps), ps);
  // glasses_mode for A-Spire Wireless is suggested → must render as Not specified.
  const glasses = prov.find((f) => f.key === "glasses_mode");
  assert(glasses, "expected glasses_mode comparison fact");
  assert(glasses!.value.includes("A-Spire Wireless: Not specified"));
});

Deno.test("buildComparisonProvenance includes confirmed positioning as type 'spec'", () => {
  const ps = positioningProducts();
  const prov = buildComparisonProvenance(buildSpecComparison(ps), ps);
  const positioning = prov.filter((f) => f.type === "spec");
  assert(positioning.length > 0, "expected positioning provenance entries");
  assert(
    positioning.some((f) =>
      f.value.includes("Customers who want strong wireless gaming at a lower price.")
    ),
  );
  // Suggested positioning row must never surface.
  assert(!prov.some((f) => f.value.includes("(unconfirmed marketing claim)")));
});

Deno.test("buildComparisonProvenance returns [] for empty input", () => {
  assertEquals(buildComparisonProvenance([], []), []);
  assertEquals(buildComparisonProvenance(null, null), []);
});

Deno.test("suggested-only dac_quality never appears in comparison provenance (AceZone live state)", () => {
  // Mirrors AceZone's real data: dac_quality exists ONLY as confidence='suggested'.
  const suggestedDacRows: SpecRow[] = [
    { product_id: 1, spec_key: "dac_quality", spec_group: "audio", spec_value: "Better DAC", value_bool: null, value_num: null, unit: null, display_order: 10, comparable: true, confidence: "suggested" },
    { product_id: 2, spec_key: "dac_quality", spec_group: "audio", spec_value: "Best DAC", value_bool: null, value_num: null, unit: null, display_order: 10, comparable: true, confidence: "suggested" },
    // a confirmed spec so a comparison can still be built
    { product_id: 1, spec_key: "eq_app_bands", spec_group: "audio", spec_value: "8", value_bool: null, value_num: 8, unit: "bands", display_order: 20, comparable: true, confidence: "confirmed" },
    { product_id: 2, spec_key: "eq_app_bands", spec_group: "audio", spec_value: "8", value_bool: null, value_num: 8, unit: "bands", display_order: 20, comparable: true, confidence: "confirmed" },
  ];
  const ps = [
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(suggestedDacRows, { productId: 1 }) },
    { productId: 2, title: "A-Spire Wireless", specs: resolveProductSpecs(suggestedDacRows, { productId: 2 }) },
  ];
  const prov = buildComparisonProvenance(buildSpecComparison(ps), ps);
  // No dac_quality entry at all, and no suggested dac value leaks anywhere.
  assert(!prov.some((f) => f.key === "dac_quality"), "suggested dac_quality must not be a provenance fact");
  assert(!prov.some((f) => /better dac|best dac/i.test(f.value)), "suggested dac value leaked");
  // The confirmed spec still surfaces.
  assert(prov.some((f) => f.key === "eq_app_bands"));
});
