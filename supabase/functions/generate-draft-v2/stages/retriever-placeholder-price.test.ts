import { assertEquals } from "jsr:@std/assert@1";
import { isShopifyProductNotLive } from "./retriever.ts";

Deno.test("isShopifyProductNotLive honours the synced is_placeholder_price flag", () => {
  // Flag set by the sync → not live, even when the price string looks normal.
  assertEquals(
    isShopifyProductNotLive({ is_placeholder_price: true, price: "199.00" }),
    true,
  );
});

Deno.test("isShopifyProductNotLive falls back to the hard-coded sentinel-price check", () => {
  // No flag present (legacy chunk) → hard-coded fallback still catches 99999.
  assertEquals(isShopifyProductNotLive({ price: "99999.00" }), true);
  assertEquals(isShopifyProductNotLive({ price: "0.00" }), true);
});

Deno.test("isShopifyProductNotLive flags hide-price/waitlist tags and draft status", () => {
  assertEquals(isShopifyProductNotLive({ tags: "hide-price" }), true);
  assertEquals(isShopifyProductNotLive({ tags: "waitlist, new" }), true);
  assertEquals(isShopifyProductNotLive({ status: "draft" }), true);
});

Deno.test("isShopifyProductNotLive returns false for a normal live product", () => {
  assertEquals(
    isShopifyProductNotLive({
      is_placeholder_price: false,
      price: "199.00",
      tags: "headset",
      status: "active",
    }),
    false,
  );
});
