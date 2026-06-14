import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  mapShopifyProductToStockFacts,
  selectShopifyProductsForStockQuery,
  ShopifyProvider,
} from "../../_shared/integrations/commerce/shopify-provider.ts";

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    title: "A-Spire Wireless",
    handle: "a-spire-wireless",
    status: "active",
    published_at: "2026-06-01T10:00:00Z",
    variants: [{
      id: 201,
      title: "Default Title",
      sku: "ASW",
      inventory_quantity: 4,
      inventory_policy: "deny",
      inventory_management: "shopify",
    }],
    ...overrides,
  };
}

Deno.test("single variant quantity > 0 + deny maps to in_stock", () => {
  const facts = mapShopifyProductToStockFacts(product());
  assertEquals(facts.length, 1);
  assertEquals(facts[0].state, "in_stock");
  assertEquals(facts[0].quantity, 4);
  assertEquals(facts[0].inventory_policy, "deny");
});

Deno.test("single variant quantity 0 + deny maps to out_of_stock", () => {
  const facts = mapShopifyProductToStockFacts(product({
    variants: [{ id: 201, title: "Default Title", inventory_quantity: 0, inventory_policy: "deny", inventory_management: "shopify" }],
  }));
  assertEquals(facts[0].state, "out_of_stock");
});

Deno.test("draft archived or unpublished products are not in_stock", () => {
  assertNotEquals(mapShopifyProductToStockFacts(product({ status: "draft" }))[0].state, "in_stock");
  assertEquals(mapShopifyProductToStockFacts(product({ status: "archived" }))[0].state, "discontinued");
  assertNotEquals(mapShopifyProductToStockFacts(product({ published_at: null }))[0].state, "in_stock");
});

Deno.test("inventory_management null does not produce unsafe in_stock from quantity", () => {
  const facts = mapShopifyProductToStockFacts(product({
    variants: [{ id: 201, title: "Default Title", inventory_quantity: 9, inventory_policy: "deny", inventory_management: null }],
  }));
  assertEquals(facts[0].state, "unknown");
});

Deno.test("continue policy with zero quantity does not become preorder", () => {
  const facts = mapShopifyProductToStockFacts(product({
    variants: [{ id: 201, title: "Default Title", inventory_quantity: 0, inventory_policy: "continue", inventory_management: "shopify" }],
  }));
  assertEquals(facts[0].state, "unknown");
});

Deno.test("list fallback exact normalized title match selects product", () => {
  const selected = selectShopifyProductsForStockQuery("A-Spire Wireless", [
    product({ id: 1, title: "A-Spire Wireless" }),
    product({ id: 2, title: "A-Blaze" }),
  ]);
  assertEquals(selected.length, 1);
  assertEquals(selected[0].title, "A-Spire Wireless");
});

Deno.test("list fallback handle match selects product", () => {
  const selected = selectShopifyProductsForStockQuery("a-spire-wireless", [
    product({ id: 1, title: "Wireless headset", handle: "a-spire-wireless" }),
    product({ id: 2, title: "A-Blaze", handle: "a-blaze" }),
  ]);
  assertEquals(selected.length, 1);
  assertEquals(selected[0].handle, "a-spire-wireless");
});

Deno.test("list fallback multiple plausible matches returns ambiguity candidates", () => {
  const selected = selectShopifyProductsForStockQuery("A-Spire", [
    product({ id: 1, title: "A-Spire Wireless" }),
    product({ id: 2, title: "A-Spire Wired" }),
  ]);
  assertEquals(selected.length, 2);
});

Deno.test("list fallback no plausible matches returns empty", () => {
  const selected = selectShopifyProductsForStockQuery("Unknown product", [
    product({ id: 1, title: "A-Spire Wireless" }),
  ]);
  assertEquals(selected, []);
});

Deno.test("title search result is used before list fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(new Response(JSON.stringify({
      products: [product({ id: 301, title: "A-Spire Wireless" })],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    const provider = new ShopifyProvider({
      shopDomain: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2024-04",
    });
    const facts = await provider.searchProductInventory("A-Spire Wireless");
    assertEquals(facts.length, 1);
    assertEquals(facts[0].product_id, "301");
    assertEquals(calls.length, 1);
    assert(calls[0].includes("title=A-Spire%20Wireless"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("title search empty falls back to bounded product list", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const products = url.includes("title=")
      ? []
      : [product({ id: 401, title: "A-Spire Wireless" }), product({ id: 402, title: "A-Blaze" })];
    return Promise.resolve(new Response(JSON.stringify({ products }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  try {
    const provider = new ShopifyProvider({
      shopDomain: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2024-04",
    });
    const facts = await provider.searchProductInventory("A-Spire Wireless");
    assertEquals(facts.length, 1);
    assertEquals(facts[0].product_id, "401");
    assertEquals(calls.length, 2);
    assert(calls[1].includes("limit=250"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
