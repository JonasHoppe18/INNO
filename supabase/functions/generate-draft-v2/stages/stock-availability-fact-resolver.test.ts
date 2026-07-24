import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  deriveStockProductCandidate,
  resolveStockAvailabilityFactsForQueries,
  resolveStockAvailabilityFactsWithDiagnostics,
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

Deno.test("ordinary product questions do not trigger an irrelevant stock lookup", () => {
  assertEquals(
    stockProductQueriesForFactResolver({
      plan: plan(),
      caseState: caseState(["A-Rise"]),
      latestCustomerMessage:
        "We would like to discuss a partnership around A-Rise headsets.",
    }),
    [],
  );
});

Deno.test("purchase-link requests still resolve the product for a grounded link", () => {
  assertEquals(
    stockProductQueriesForFactResolver({
      plan: plan(),
      caseState: caseState(["A-Rise"]),
      latestCustomerMessage: "Where can I buy the A-Rise?",
    }),
    ["A-Rise"],
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

Deno.test("stock diagnostics record fallback candidate and lookup attempt", async () => {
  const input = {
    plan: plan(),
    caseState: caseState(),
    latestCustomerMessage: "Is A-Spire Wireless in stock?",
  };
  const queries = stockProductQueriesForFactResolver(input);
  const result = await resolveStockAvailabilityFactsWithDiagnostics({
    ...input,
    queries,
    lookup: async () => ({
      facts: [fact()],
      diagnostics: {
        query: "A-Spire Wireless",
        title_search_product_count: 0,
        list_fallback_attempted: true,
        list_fallback_product_count: 7,
        matched_products: [{
          id: "p1",
          title: "A-Spire Wireless",
          handle: "a-spire-wireless",
        }],
        ambiguous_match: false,
        no_match: false,
      },
    }),
  });

  assertEquals(result.diagnostics.stock_lookup_intent.primary_intent, "product_question");
  assertEquals(result.diagnostics.stock_lookup_intent.considered_stock_question, true);
  assertEquals(result.diagnostics.stock_lookup_entities.products_mentioned, []);
  assertEquals(result.diagnostics.stock_lookup_entities.fallback_product_candidate, "A-Spire Wireless");
  assertEquals(result.diagnostics.stock_lookup_entities.latest_body_used, "Is A-Spire Wireless in stock?");
  assertEquals(result.diagnostics.attempts[0].stock_lookup_attempt, {
    attempted: true,
    query: "A-Spire Wireless",
  });
});

Deno.test("stock diagnostics record title-empty list fallback match", async () => {
  const result = await resolveStockAvailabilityFactsWithDiagnostics({
    plan: plan(),
    caseState: caseState(),
    latestCustomerMessage: "Is A-Spire Wireless in stock?",
    queries: ["A-Spire Wireless"],
    lookup: async () => ({
      facts: [fact()],
      diagnostics: {
        query: "A-Spire Wireless",
        title_search_product_count: 0,
        list_fallback_attempted: true,
        list_fallback_product_count: 12,
        matched_products: [{
          id: "p1",
          title: "A-Spire Wireless",
          handle: "a-spire-wireless",
        }],
        ambiguous_match: false,
        no_match: false,
      },
    }),
  });
  const attempt = result.diagnostics.attempts[0];
  assertEquals(attempt.shopify_lookup_result?.title_search_product_count, 0);
  assertEquals(attempt.shopify_lookup_result?.list_fallback_attempted, true);
  assertEquals(attempt.shopify_lookup_result?.list_fallback_product_count, 12);
  assertEquals(attempt.shopify_lookup_result?.matched_products[0].title, "A-Spire Wireless");
  assertEquals(attempt.stock_fact_result.emitted, true);
  assertEquals(attempt.stock_fact_result.stock_state, "in_stock");
  assertEquals(attempt.stock_fact_result.writer_received, true);
});

Deno.test("stock diagnostics record ambiguous fallback and unknown mapping reason", async () => {
  const result = await resolveStockAvailabilityFactsWithDiagnostics({
    plan: plan(),
    caseState: caseState(),
    latestCustomerMessage: "Is A-Spire in stock?",
    queries: ["A-Spire"],
    lookup: async () => ({
      facts: [
        fact({ product_id: "p1", product_title: "A-Spire Wireless" }),
        fact({ product_id: "p2", product_title: "A-Spire Wired", state: "out_of_stock" }),
      ],
      diagnostics: {
        query: "A-Spire",
        title_search_product_count: 0,
        list_fallback_attempted: true,
        list_fallback_product_count: 12,
        matched_products: [
          { id: "p1", title: "A-Spire Wireless", handle: "a-spire-wireless" },
          { id: "p2", title: "A-Spire Wired", handle: "a-spire" },
        ],
        ambiguous_match: true,
        no_match: false,
      },
    }),
  });
  const attempt = result.diagnostics.attempts[0];
  assertEquals(attempt.shopify_lookup_result?.ambiguous_match, true);
  assertEquals(attempt.stock_mapping_result?.mapped_states, ["unknown"]);
  assertEquals(attempt.stock_mapping_result?.unknown_reasons, ["ambiguous_product"]);
  assertEquals(attempt.stock_fact_result.emitted, true);
  assertEquals(attempt.stock_fact_result.stock_state, "unknown");
});

Deno.test("stock diagnostics record mapped unknown inventory-management reason", async () => {
  const result = await resolveStockAvailabilityFactsWithDiagnostics({
    plan: plan(),
    caseState: caseState(),
    latestCustomerMessage: "Is A-Spire Wireless in stock?",
    queries: ["A-Spire Wireless"],
    lookup: async () => [fact({ inventory_management: null, state: "unknown" })],
  });
  const attempt = result.diagnostics.attempts[0];
  assertEquals(attempt.stock_mapping_result?.inventory_management_summary, ["null"]);
  assertEquals(attempt.stock_mapping_result?.mapped_states, ["unknown"]);
  assertEquals(attempt.stock_fact_result.stock_state, "unknown");
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
