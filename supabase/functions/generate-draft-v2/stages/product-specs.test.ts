import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildComparisonDirective,
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

Deno.test("buildComparisonDirective returns empty when no comparable confirmed specs exist", () => {
  assertEquals(buildComparisonDirective([], [], { wasAsked: true }), "");
  // also empty when not asked
  const cmp = buildSpecComparison([
    { productId: 1, title: "A-Blaze", specs: resolveProductSpecs(rows, { productId: 1 }) },
  ]);
  assertEquals(buildComparisonDirective(cmp, [], { wasAsked: false }), "");
});
