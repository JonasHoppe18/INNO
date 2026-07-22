// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import {
  ANALYTICS_WEBHOOK_TOPICS,
  COMMERCE_WEBHOOK_TOPICS,
  PRODUCT_WEBHOOK_TOPICS,
  ensureShopifyWebhooks,
} from "./shopify-webhooks.js";

Deno.test("PRODUCT_WEBHOOK_TOPICS covers create/update/delete", () => {
  assertEquals(PRODUCT_WEBHOOK_TOPICS, [
    "products/create", "products/update", "products/delete",
  ]);
});

Deno.test("commerce webhook topics include anonymous order and refund facts", () => {
  assertEquals(ANALYTICS_WEBHOOK_TOPICS, [
    "orders/create", "orders/updated", "refunds/create",
  ]);
  assertEquals(COMMERCE_WEBHOOK_TOPICS, [
    ...PRODUCT_WEBHOOK_TOPICS,
    ...ANALYTICS_WEBHOOK_TOPICS,
  ]);
});

Deno.test("ensureShopifyWebhooks POSTs one create per topic", async () => {
  const posted = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posted.push(JSON.parse(init.body).webhook.topic);
    return { ok: true, status: 201, json: async () => ({}) };
  };
  try {
    await ensureShopifyWebhooks({
      domain: "x.myshopify.com", accessToken: "t", apiVersion: "2024-07",
      appUrl: "https://app.example.com", topics: ["products/create", "products/delete"],
    });
  } finally { globalThis.fetch = origFetch; }
  assertEquals(posted, ["products/create", "products/delete"]);
});
