// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildTrustedProductUrl,
  computeRecommendable,
  detectPlaceholderPrice,
  isPlaceholderPriceAmount,
  mapShopifyProductToNormalizedProduct,
  toShopProductRow,
} from "./normalize-product.ts";

Deno.test("isPlaceholderPriceAmount flags sentinel and zero, not real prices", () => {
  assertEquals(isPlaceholderPriceAmount(99999), true);
  assertEquals(isPlaceholderPriceAmount(99999.0), true);
  assertEquals(isPlaceholderPriceAmount(0), true);
  assertEquals(isPlaceholderPriceAmount(199), false);
  assertEquals(isPlaceholderPriceAmount(50), false);
  // Unknown price is NOT a placeholder.
  assertEquals(isPlaceholderPriceAmount(null), false);
  assertEquals(isPlaceholderPriceAmount(undefined), false);
});

Deno.test("detectPlaceholderPrice honours hide-price tag and sentinel amount", () => {
  assertEquals(detectPlaceholderPrice({ amount: 199, tags: ["new"] }), false);
  assertEquals(detectPlaceholderPrice({ amount: 99999, tags: [] }), true);
  assertEquals(
    detectPlaceholderPrice({ amount: 199, tags: ["hide-price"] }),
    true,
  );
  assertEquals(
    detectPlaceholderPrice({ amount: 199, tags: ["Hidden-Price"] }),
    true,
  );
});

Deno.test("computeRecommendable: placeholder-priced and accessory products are not recommendable", () => {
  // A real, available headset is recommendable.
  assertEquals(
    computeRecommendable({
      isPlaceholderPrice: false,
      available: true,
      productType: "Headset",
      tags: [],
      title: "A-Spire Wireless",
    }),
    true,
  );
  // Placeholder price → not recommendable.
  assertEquals(
    computeRecommendable({
      isPlaceholderPrice: true,
      available: true,
      productType: "Headset",
      tags: [],
      title: "A-Live",
    }),
    false,
  );
  // Accessory (ear pads) → not recommendable.
  assertEquals(
    computeRecommendable({
      isPlaceholderPrice: false,
      available: true,
      productType: "Accessory",
      tags: [],
      title: "Ear pads",
    }),
    false,
  );
  // Unavailable → not recommendable.
  assertEquals(
    computeRecommendable({
      isPlaceholderPrice: false,
      available: false,
      productType: "Headset",
      tags: [],
      title: "A-Rise",
    }),
    false,
  );
});

Deno.test("buildTrustedProductUrl builds public URL and refuses unsafe inputs", () => {
  assertEquals(
    buildTrustedProductUrl("www.acezone.io", "a-spire"),
    "https://www.acezone.io/products/a-spire",
  );
  assertEquals(
    buildTrustedProductUrl("https://www.acezone.io/", "/a-spire"),
    "https://www.acezone.io/products/a-spire",
  );
  // Never expose the internal myshopify host.
  assertEquals(
    buildTrustedProductUrl("shop-acezone.myshopify.com", "a-spire"),
    null,
  );
  // Missing handle or domain → no link (never invent one).
  assertEquals(buildTrustedProductUrl("www.acezone.io", null), null);
  assertEquals(buildTrustedProductUrl(null, "a-spire"), null);
});

Deno.test("mapShopifyProductToNormalizedProduct keeps Shopify parsing platform-neutral on output", () => {
  const raw = {
    id: 7548544745718,
    title: "A-Spire",
    body_html: "<p>The <b>A-Spire</b> is a premium gaming headset.</p>",
    handle: "a-spire",
    status: "active",
    published_at: "2024-01-01T00:00:00Z",
    updated_at: "2026-05-01T10:00:00Z",
    product_type: "Headset",
    tags: ["headset", "wired"],
    variants: [
      { id: 1, title: "Default", price: "199.00" },
      { id: 2, title: "Bundle", price: "249.00" },
    ],
  };

  const n = mapShopifyProductToNormalizedProduct(raw, {
    publicStorefrontDomain: "www.acezone.io",
    currency: "DKK",
  });

  assertEquals(n.platform, "shopify");
  assertEquals(n.external_id, "7548544745718");
  assertEquals(n.title, "A-Spire");
  assert(n.description.includes("premium gaming headset"));
  assert(!n.description.includes("<"));
  assertEquals(n.handle, "a-spire");
  assertEquals(n.product_url, "https://www.acezone.io/products/a-spire");
  assertEquals(n.status, "active");
  assertEquals(n.available, true);
  assertEquals(n.price_amount, 199);
  assertEquals(n.min_price, 199);
  assertEquals(n.max_price, 249);
  assertEquals(n.currency, "DKK");
  assertEquals(n.is_placeholder_price, false);
  assertEquals(n.recommendable, true);
  assertEquals(n.product_updated_at, "2026-05-01T10:00:00Z");
  assertEquals(n.raw, raw);
});

Deno.test("mapShopifyProductToNormalizedProduct marks 99999-priced product as placeholder + not recommendable", () => {
  const raw = {
    id: 7844464132342,
    title: "A-Live",
    body_html: "Advanced version.",
    handle: "a-live",
    status: "active",
    published_at: "2024-01-01T00:00:00Z",
    product_type: "Headset",
    tags: [],
    variants: [{ id: 9, title: "Default", price: "99999.00" }],
  };
  const n = mapShopifyProductToNormalizedProduct(raw, {
    publicStorefrontDomain: "www.acezone.io",
  });
  assertEquals(n.price_amount, 99999);
  assertEquals(n.is_placeholder_price, true);
  assertEquals(n.recommendable, false);
  // No currency provided → null, not invented.
  assertEquals(n.currency, null);
});

Deno.test("toShopProductRow emits platform-neutral columns scoped by shop_ref_id (never legacy shop_id)", () => {
  const raw = {
    id: 1,
    title: "A-Rise",
    body_html: "Pro headset",
    handle: "a-rise",
    status: "active",
    published_at: "2024-01-01T00:00:00Z",
    product_type: "Headset",
    tags: [],
    variants: [{ id: 1, title: "Default", price: "1199.00" }],
  };
  const n = mapShopifyProductToNormalizedProduct(raw, {
    publicStorefrontDomain: "www.acezone.io",
  });
  const row = toShopProductRow(n, {
    shopRefId: "38df5fef-2a23-47f3-803e-39f2d6f1ed99",
    syncedAt: "2026-06-20T00:00:00Z",
  });

  assertEquals(row.shop_ref_id, "38df5fef-2a23-47f3-803e-39f2d6f1ed99");
  assert(!("shop_id" in row), "row must not set legacy shop_id");
  assertEquals(row.external_id, "1");
  assertEquals(row.platform, "shopify");
  assertEquals(row.handle, "a-rise");
  assertEquals(row.product_url, "https://www.acezone.io/products/a-rise");
  assertEquals(row.price_amount, 1199);
  assertEquals(row.price, "1199.00"); // back-compat text column preserved
  assertEquals(row.currency, null);
  assertEquals(row.status, "active");
  assertEquals(row.available, true);
  assertEquals(row.is_placeholder_price, false);
  assertEquals(row.recommendable, true);
  assertEquals(row.synced_at, "2026-06-20T00:00:00Z");
  assertEquals(row.last_seen_at, "2026-06-20T00:00:00Z");
  assertEquals(row.raw, raw);
});
