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

Deno.test("A-rise spelling/spacing variants all match A-Rise without matching siblings", () => {
  const catalog = [
    product({ id: 1, title: "A-Rise", handle: "a-rise" }),
    product({ id: 2, title: "A-Spire Wireless", handle: "a-spire-wireless" }),
    product({ id: 3, title: "A-Blaze", handle: "a-blaze" }),
  ];
  for (const variant of ["A-rise", "A-Rise", "A Rise", "a rise", "arise"]) {
    const selected = selectShopifyProductsForStockQuery(variant, catalog);
    assertEquals(selected.length, 1, `variant ${variant} should match exactly one`);
    assertEquals(selected[0].title, "A-Rise", `variant ${variant} should match A-Rise`);
  }
});

Deno.test("zero-product store surfaces shopify_returned_zero_products reason", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ products: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
  try {
    const provider = new ShopifyProvider({
      shopDomain: "shop-acezone.myshopify.com",
      accessToken: "token",
      apiVersion: "2024-04",
    });
    const { facts, diagnostics } = await provider
      .searchProductInventoryWithDiagnostics("A-Rise");
    assertEquals(facts, []);
    assertEquals(diagnostics.no_match, true);
    assertEquals(diagnostics.error_reason, "shopify_returned_zero_products");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("403 from Shopify surfaces missing_read_products_scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ errors: "Not authorized" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
  try {
    const provider = new ShopifyProvider({
      shopDomain: "shop-acezone.myshopify.com",
      accessToken: "token",
      apiVersion: "2024-04",
    });
    const { facts, diagnostics } = await provider
      .searchProductInventoryWithDiagnostics("A-Rise");
    assertEquals(facts, []);
    assertEquals(diagnostics.error_reason, "missing_read_products_scope");
    assertEquals(diagnostics.http_status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("A-Rise query never selects A-Spire or A-Blaze", () => {
  const selected = selectShopifyProductsForStockQuery("A-Rise", [
    product({ id: 2, title: "A-Spire Wireless", handle: "a-spire-wireless" }),
    product({ id: 3, title: "A-Blaze", handle: "a-blaze" }),
  ]);
  assertEquals(selected, []);
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

Deno.test("product listing uses status=active (not status=any) on both calls", () => {
  // Regression: status=any is an ORDERS-only filter; products.json must use
  // status=active (aligned with knowledge sync-products), otherwise Shopify
  // returns zero products.
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const products = url.includes("title=") ? [] : [product({ id: 901, title: "A-Spire Wireless" })];
    return Promise.resolve(new Response(JSON.stringify({ products }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  return (async () => {
    try {
      const provider = new ShopifyProvider({ shopDomain: "x.myshopify.com", accessToken: "t", apiVersion: "2024-07" });
      await provider.searchProductInventory("A-Spire Wireless");
      assertEquals(calls.length, 2);
      for (const url of calls) {
        assert(url.includes("status=active"), `expected status=active in ${url}`);
        assert(!url.includes("status=any"), `status=any must not appear in ${url}`);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  })();
});

Deno.test("demo AirPods: title query zero but list returns products → matched in_stock", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    const products = url.includes("title=") ? [] : [
      product({ id: 11, title: "Apple Airpods 4", handle: "apple-airpods-4", variants: [{ id: 1, title: "Default Title", inventory_quantity: 7, inventory_policy: "deny", inventory_management: "shopify" }] }),
      product({ id: 12, title: "A-Blaze", handle: "a-blaze" }),
    ];
    return Promise.resolve(new Response(JSON.stringify({ products }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    const provider = new ShopifyProvider({ shopDomain: "test-app-store-ai-mailer.myshopify.com", accessToken: "t", apiVersion: "2024-07" });
    const { facts, diagnostics } = await provider.searchProductInventoryWithDiagnostics("airpods");
    assertEquals(diagnostics.matched_products.map((p) => p.title), ["Apple Airpods 4"]);
    assertEquals(facts[0]?.state, "in_stock");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("matched product without inventory_quantity → missing_read_inventory_scope, unknown", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    const products = url.includes("title=") ? [] : [
      product({ id: 21, title: "Apple Airpods 4", handle: "apple-airpods-4", variants: [{ id: 1, title: "Default Title", inventory_quantity: null, inventory_policy: null, inventory_management: null }] }),
    ];
    return Promise.resolve(new Response(JSON.stringify({ products }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    const provider = new ShopifyProvider({ shopDomain: "x.myshopify.com", accessToken: "t", apiVersion: "2024-07" });
    const { facts, diagnostics } = await provider.searchProductInventoryWithDiagnostics("airpods");
    assertEquals(diagnostics.matched_products.length, 1);
    assertEquals(diagnostics.error_reason, "missing_read_inventory_scope");
    assertEquals(facts[0]?.state, "unknown");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("inventory lookup diagnostics expose title and fallback match details", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    const products = url.includes("title=")
      ? []
      : [product({ id: 501, title: "A-Spire Wireless" }), product({ id: 502, title: "A-Blaze" })];
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
    const result = await provider.searchProductInventoryWithDiagnostics("A-Spire Wireless");
    assertEquals(result.facts.length, 1);
    assertEquals(result.diagnostics.title_search_product_count, 0);
    assertEquals(result.diagnostics.list_fallback_attempted, true);
    assertEquals(result.diagnostics.list_fallback_product_count, 2);
    assertEquals(result.diagnostics.matched_products[0], {
      id: "501",
      title: "A-Spire Wireless",
      handle: "a-spire-wireless",
    });
    assertEquals(result.diagnostics.ambiguous_match, false);
    assertEquals(result.diagnostics.no_match, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
