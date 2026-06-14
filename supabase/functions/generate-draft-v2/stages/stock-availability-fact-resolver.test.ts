import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { summarizeStockAvailability } from "./fact-resolver.ts";
import type { StockAvailabilityFact, StockState } from "../../_shared/integrations/commerce/types.ts";

function fact(overrides: Partial<StockAvailabilityFact> = {}): StockAvailabilityFact {
  return {
    product_id: "p1",
    product_title: "A-Spire Wireless",
    product_handle: "a-spire-wireless",
    variant_id: "v1",
    variant_title: "Default Title",
    sku: "ASW",
    state: "in_stock",
    quantity: 5,
    inventory_policy: "deny",
    inventory_management: "shopify",
    product_status: "active",
    published_at: "2026-06-01T10:00:00Z",
    source: "shopify_live",
    checked_at: "2026-06-13T10:00:00Z",
    ...overrides,
  };
}

function state(value: string): string {
  return /(?:^|;\s*)state=([^;]+)/.exec(value)?.[1] ?? "";
}

Deno.test("stock fact emitted for confident single product match", () => {
  const [resolved] = summarizeStockAvailability("A-Spire Wireless", [fact()]);
  assertEquals(resolved.label, "Live stock availability");
  assertEquals(state(resolved.value), "in_stock");
  assertStringIncludes(resolved.value, "source=shopify_live");
  assertStringIncludes(resolved.value, "exact_quantity_hidden=true");
});

Deno.test("multiple variants all same state summarize product-level state", () => {
  const [resolved] = summarizeStockAvailability("A-Spire Wireless", [
    fact({ variant_id: "v1", variant_title: "Black", state: "in_stock" }),
    fact({ variant_id: "v2", variant_title: "White", state: "in_stock" }),
  ]);
  assertEquals(state(resolved.value), "in_stock");
  assertStringIncludes(resolved.value, "variant=all_variants");
});

Deno.test("mixed variants require variant clarification", () => {
  const [resolved] = summarizeStockAvailability("A-Spire Wireless", [
    fact({ variant_id: "v1", variant_title: "Black", state: "in_stock" }),
    fact({ variant_id: "v2", variant_title: "White", state: "out_of_stock" }),
  ]);
  assertEquals(state(resolved.value), "variant_clarification_required");
  assertStringIncludes(resolved.value, "reason=mixed_variant_availability");
});

Deno.test("explicit variant query selects matching variant", () => {
  const [resolved] = summarizeStockAvailability("A-Spire Wireless White", [
    fact({ variant_id: "v1", variant_title: "Black", state: "in_stock" }),
    fact({ variant_id: "v2", variant_title: "White", state: "out_of_stock" }),
  ]);
  assertEquals(state(resolved.value), "out_of_stock");
  assertStringIncludes(resolved.value, "variant=White");
});

Deno.test("product not found becomes safe unknown fact", () => {
  const [resolved] = summarizeStockAvailability("Unknown product", []);
  assertEquals(state(resolved.value), "unknown");
  assertStringIncludes(resolved.value, "reason=not_found");
});

Deno.test("ambiguous product match becomes safe unknown fact", () => {
  const [resolved] = summarizeStockAvailability("A-Spire headset", [
    fact({ product_id: "p1", product_title: "A-Spire Wireless" }),
    fact({ product_id: "p2", product_title: "A-Spire Wired", state: "out_of_stock" as StockState }),
    fact({ product_id: "p3", product_title: "A-Spire Wired", state: "in_stock" }),
  ]);
  assertEquals(state(resolved.value), "unknown");
  assertStringIncludes(resolved.value, "reason=ambiguous_product");
});
