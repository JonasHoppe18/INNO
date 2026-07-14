import { assertEquals } from "jsr:@std/assert@1";
import { ShopifyProvider } from "./shopify-provider.ts";

// Shopify's orders.json?name= filter is a PREFIX match: querying "443" can
// return order #4435. getOrderByName must therefore only ever hand back an
// order whose name matches the query exactly — a prefix hit is NOT the
// customer's order and must never be treated as identified.

function rawOrder(name: string): Record<string, unknown> {
  return {
    id: name.replace(/^#/, ""),
    order_number: name.replace(/^#/, ""),
    name,
    email: "c@example.com",
    financial_status: "paid",
    fulfillment_status: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    total_price: "100.00",
    currency: "DKK",
    line_items: [],
    fulfillments: [],
  };
}

async function withOrdersResponse<T>(
  orders: Record<string, unknown>[],
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ orders }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function provider(): ShopifyProvider {
  return new ShopifyProvider({
    shopDomain: "test-shop.myshopify.com",
    accessToken: "test-token",
    apiVersion: "2024-01",
  });
}

Deno.test("getOrderByName: prefix-only hit (no exact name) → null, never orders[0]", async () => {
  const order = await withOrdersResponse(
    [rawOrder("#4435"), rawOrder("#4436")],
    () => provider().getOrderByName("443"),
  );
  assertEquals(order, null);
});

Deno.test("getOrderByName: exact match among prefix results is selected", async () => {
  const order = await withOrdersResponse(
    [rawOrder("#4435"), rawOrder("#443")],
    () => provider().getOrderByName("443"),
  );
  assertEquals(order?.name, "#443");
});

Deno.test("getOrderByName: '#'-prefixed query still matches exactly", async () => {
  const order = await withOrdersResponse(
    [rawOrder("#443")],
    () => provider().getOrderByName("#443"),
  );
  assertEquals(order?.name, "#443");
});

Deno.test("getOrderByName: empty result → null", async () => {
  const order = await withOrdersResponse([], () => provider().getOrderByName("443"));
  assertEquals(order, null);
});
