import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  decideInventoryFallbackReason,
  inventoryLookupHadProductMatch,
  resolveFallbackShopifyShop,
  type StockLookupDebug,
} from "./fact-resolver.ts";

// --- decideInventoryFallbackReason ---------------------------------------

Deno.test("no fallback when primary matched a product (even if stock unknown)", () => {
  assertEquals(
    decideInventoryFallbackReason({
      primaryIsShopify: true,
      primaryHasToken: true,
      primaryRan: true,
      primaryHadMatch: true,
    }),
    null,
  );
});

Deno.test("fallback when primary returned zero products", () => {
  assertEquals(
    decideInventoryFallbackReason({
      primaryIsShopify: true,
      primaryHasToken: true,
      primaryRan: true,
      primaryHadMatch: false,
    }),
    "primary_shopify_returned_zero_products",
  );
});

Deno.test("fallback when primary shop is tokenless or non-Shopify", () => {
  assertEquals(
    decideInventoryFallbackReason({
      primaryIsShopify: true,
      primaryHasToken: false,
      primaryRan: false,
      primaryHadMatch: false,
    }),
    "primary_shop_missing_token",
  );
  assertEquals(
    decideInventoryFallbackReason({
      primaryIsShopify: false,
      primaryHasToken: true,
      primaryRan: false,
      primaryHadMatch: false,
    }),
    "primary_shop_not_shopify",
  );
});

Deno.test("fallback when primary lookup errored", () => {
  assertEquals(
    decideInventoryFallbackReason({
      primaryIsShopify: true,
      primaryHasToken: true,
      primaryRan: false,
      primaryHadMatch: false,
    }),
    "primary_lookup_error",
  );
});

// --- inventoryLookupHadProductMatch --------------------------------------

const debugWith = (matchedCount: number): StockLookupDebug => ({
  stock_lookup_intent: { primary_intent: "product_question", considered_stock_question: true },
  stock_lookup_entities: { products_mentioned: ["A-Rise"], fallback_product_candidate: null, latest_body_used: "" },
  attempts: [{
    stock_lookup_attempt: { attempted: true, query: "A-Rise" },
    shopify_lookup_result: {
      query: "A-Rise",
      title_search_product_count: matchedCount,
      list_fallback_attempted: true,
      list_fallback_product_count: matchedCount,
      matched_products: Array.from({ length: matchedCount }, (_, i) => ({ id: String(i), title: "A-Rise", handle: "a-rise" })),
      ambiguous_match: false,
      no_match: matchedCount === 0,
    },
    stock_fact_result: { emitted: true, fact_label: "Live stock availability", stock_state: "in_stock", writer_received: true },
  }],
});

Deno.test("inventoryLookupHadProductMatch reflects matched products", () => {
  assert(inventoryLookupHadProductMatch(debugWith(1)));
  assertEquals(inventoryLookupHadProductMatch(debugWith(0)), false);
});

// --- resolveFallbackShopifyShop (read-only, fake supabase) ----------------

function fakeSupabase(rows: Array<Record<string, unknown>>, capture?: (f: Record<string, unknown>) => void) {
  const filters: Record<string, unknown> = {};
  // Thenable builder: chaining (.eq after .limit) works AND `await query`
  // resolves to {data,error} — mirroring the supabase-js query builder.
  const builder: Record<string, unknown> = {
    select: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      capture?.(filters);
      return builder;
    },
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  };
  return { from: () => builder } as unknown as Parameters<typeof resolveFallbackShopifyShop>[0];
}

Deno.test("resolveFallbackShopifyShop picks newest non-primary shopify shop with a token", async () => {
  const primary = { id: "primary", workspace_id: "ws1", platform: "shopify", shop_domain: "shop-acezone.myshopify.com" };
  const rows = [
    { id: "newest", shop_domain: "acezone-prod.myshopify.com", access_token_encrypted: "tok" },
    { id: "primary", shop_domain: "shop-acezone.myshopify.com", access_token_encrypted: "tok" },
  ];
  const result = await resolveFallbackShopifyShop(fakeSupabase(rows), primary);
  assertEquals(result?.id, "newest");
});

Deno.test("resolveFallbackShopifyShop skips tokenless rows and the primary", async () => {
  const primary = { id: "primary", owner_user_id: "u1", platform: "shopify", shop_domain: "x.myshopify.com" };
  const rows = [
    { id: "primary", shop_domain: "x.myshopify.com", access_token_encrypted: "tok" },
    { id: "tokenless", shop_domain: "y.myshopify.com", access_token_encrypted: null },
    { id: "good", shop_domain: "z.myshopify.com", access_token_encrypted: "tok" },
  ];
  const result = await resolveFallbackShopifyShop(fakeSupabase(rows), primary);
  assertEquals(result?.id, "good");
});

Deno.test("resolveFallbackShopifyShop scopes by workspace then owner, returns null when none", async () => {
  let captured: Record<string, unknown> = {};
  const primaryWs = { id: "p", workspace_id: "ws9", owner_user_id: "u9", platform: "shopify" };
  await resolveFallbackShopifyShop(fakeSupabase([], (f) => (captured = { ...f })), primaryWs);
  assertEquals(captured.workspace_id, "ws9");
  assertEquals(captured.owner_user_id, undefined);

  // No scope at all → null without querying.
  const none = await resolveFallbackShopifyShop(fakeSupabase([{ id: "x", shop_domain: "a", access_token_encrypted: "t" }]), { id: "p" });
  assertEquals(none, null);
});
