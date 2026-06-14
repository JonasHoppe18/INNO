import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  deriveStockProductCandidate,
  resolveStockAvailabilityFactsForQueries,
  stockProductQueriesForFactResolver,
  summarizeStockAvailability,
} from "./fact-resolver.ts";
import type { StockAvailabilityFact, StockState } from "../../_shared/integrations/commerce/types.ts";
import type { Plan } from "./planner.ts";
import type { CaseState } from "./case-state-updater.ts";

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

function plan(intent = "product_question"): Plan {
  return {
    primary_intent: intent,
    resolution_stage: "info_only",
    sub_queries: [],
    required_facts: [],
    skills_to_consider: [],
    confidence: 0.9,
    language: "en",
  };
}

function caseState(products_mentioned: string[] = []): CaseState {
  return {
    intents: [],
    entities: { order_numbers: [], customer_email: "", products_mentioned },
    decisions_made: [],
    open_questions: [],
    pending_asks: [],
    language: "en",
    last_updated_msg_id: "m1",
  };
}

Deno.test("clear stock questions derive conservative product candidates", () => {
  assertEquals(deriveStockProductCandidate("Is A-Spire Wireless in stock?"), "A-Spire Wireless");
  assertEquals(deriveStockProductCandidate("Do you have A-Rise available?"), "A-Rise");
  assertEquals(deriveStockProductCandidate("Is A-Blaze in stock?"), "A-Blaze");
  assertEquals(deriveStockProductCandidate("Do you have replacement ear pads?"), "replacement ear pads");
});

Deno.test("variant-only stock question does not derive product without context", () => {
  assertEquals(deriveStockProductCandidate("Is the black version available?"), null);
});

Deno.test("product question with empty entities uses fallback candidate", () => {
  assertEquals(
    stockProductQueriesForFactResolver({
      plan: plan(),
      caseState: caseState(),
      latestCustomerMessage: "Is A-Spire Wireless in stock?",
    }),
    ["A-Spire Wireless"],
  );
});

Deno.test("variant-only question with empty entities yields no stock query", () => {
  assertEquals(
    stockProductQueriesForFactResolver({
      plan: plan(),
      caseState: caseState(),
      latestCustomerMessage: "Is the black version available?",
    }),
    [],
  );
});

Deno.test("existing products_mentioned take precedence over fallback candidate", () => {
  assertEquals(
    stockProductQueriesForFactResolver({
      plan: plan(),
      caseState: caseState(["A-Blaze"]),
      latestCustomerMessage: "Is A-Spire Wireless in stock?",
    }),
    ["A-Blaze"],
  );
});

Deno.test("stock fact emitted for confident single product match", () => {
  const [resolved] = summarizeStockAvailability("A-Spire Wireless", [fact()]);
  assertEquals(resolved.label, "Live stock availability");
  assertEquals(state(resolved.value), "in_stock");
  assertStringIncludes(resolved.value, "source=shopify_live");
  assertStringIncludes(resolved.value, "exact_quantity_hidden=true");
});

Deno.test("clear stock question + fallback query emits live stock fact with safe lookup result", async () => {
  const queries = stockProductQueriesForFactResolver({
    plan: plan(),
    caseState: caseState(),
    latestCustomerMessage: "Is A-Spire Wireless in stock?",
  });
  const [resolved] = await resolveStockAvailabilityFactsForQueries(
    queries,
    async () => [fact()],
  );
  assertEquals(resolved.label, "Live stock availability");
  assertEquals(state(resolved.value), "in_stock");
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
