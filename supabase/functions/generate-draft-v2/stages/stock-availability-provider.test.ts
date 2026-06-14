import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { mapShopifyProductToStockFacts } from "../../_shared/integrations/commerce/shopify-provider.ts";

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

