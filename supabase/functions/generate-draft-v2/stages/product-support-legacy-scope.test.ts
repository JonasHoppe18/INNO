import assert from "node:assert/strict";
import test from "node:test";
import {
  externalIdFromProductScope,
  scopeLegacyChunksToProduct,
} from "./product-support-legacy-scope.ts";

// Mirrors the real AceZone product_id → product mapping (resolved via
// shop_products). The selected product is A-Spire Wireless.
const SELECTED_SCOPE = "product-9114609942851";
const SELECTED_TITLE = "A-Spire Wireless";

const CHUNKS = [
  { id: "aspire-w", product_id: "9114609942851", source_title: "Why does my A-Spire Wireless keep disconnecting?", content: "..." },
  { id: "shared", product_id: null, source_title: "Headset still doesn't work after guides", content: "general escalation" },
  { id: "explicit-shared", product_id: null, products: ["all products"], source_title: "General support escalation", content: "shared escalation" },
  { id: "applies-all", product_id: null, products: ["a-blaze"], applies_to_all_products: true, source_title: "Explicit shared app guidance", content: "shared app guidance" },
  { id: "ablaze", product_id: "14930213372227", source_title: "Why does my headset keep disconnecting for A-Blaze?", content: "A-Blaze only" },
  { id: "aspire-wired", product_id: "7548544745718", source_title: "My microphone isn't working on my A-Spire", content: "wired A-Spire only" },
  { id: "arise", product_id: "7548536488182", source_title: "Repair on A-RISE", content: "A-Rise only" },
  { id: "products-aspire-wired", product_id: null, products: ["a-spire"], source_title: "Sidetone_Guide_A-Spire.pdf", content: "wired A-Spire sidetone" },
  { id: "products-aspire-wireless", product_id: null, products: ["a-spire-wireless"], source_title: "A-Spire Wireless dongle guide", content: "wireless dongle" },
  { id: "products-ablaze", product_id: null, products: ["a-blaze"], source_title: "A-Blaze app guide", content: "A-Blaze app" },
  { id: "products-arise", product_id: null, products: ["a-rise"], source_title: "A-Rise ear pads", content: "A-Rise ear pads" },
  // Legacy numeric ids that no longer resolve via shop_products:
  { id: "legacy-aspire-w-48", product_id: "48", source_title: "Why am I only hearing audio in 1 earcup for A-Spire Wireless?", content: "factory reset" },
  { id: "legacy-ablaze-44", product_id: "44", source_title: "Why am I only hearing audio in 1 earcup for A-blaze?", content: "factory reset" },
];

test("externalIdFromProductScope strips the product- prefix", () => {
  assert.equal(externalIdFromProductScope("product-9114609942851"), "9114609942851");
  assert.equal(externalIdFromProductScope("product_9114609942851"), "9114609942851");
  // Only the leading product- prefix is stripped; other slugs pass through.
  assert.equal(externalIdFromProductScope("custom-slug"), "custom-slug");
});

test("A-Spire Wireless preview keeps selected + shared, excludes other products", () => {
  const { kept, diagnostics } = scopeLegacyChunksToProduct({
    productScope: SELECTED_SCOPE,
    selectedProductTitle: SELECTED_TITLE,
    chunks: CHUNKS,
  });
  const keptIds = new Set(kept.map((c) => c.id));

  // Allowed
  assert(keptIds.has("aspire-w"), "selected-product row kept");
  assert(keptIds.has("shared"), "shared (no product_id) row kept");
  assert(keptIds.has("explicit-shared"), "explicit shared row kept");
  assert(keptIds.has("applies-all"), "applies_to_all_products row kept");
  assert(keptIds.has("products-aspire-wireless"), "matching metadata.products row kept");
  assert(keptIds.has("legacy-aspire-w-48"), "legacy A-Spire Wireless row kept via title mention");

  // Blocked
  assert(!keptIds.has("ablaze"), "A-Blaze-only excluded");
  assert(!keptIds.has("aspire-wired"), "wired A-Spire-only excluded");
  assert(!keptIds.has("arise"), "A-Rise-only excluded");
  assert(!keptIds.has("products-aspire-wired"), "wired A-Spire metadata.products row excluded");
  assert(!keptIds.has("products-ablaze"), "A-Blaze metadata.products row excluded");
  assert(!keptIds.has("products-arise"), "A-Rise metadata.products row excluded");
  assert(!keptIds.has("legacy-ablaze-44"), "legacy A-Blaze row excluded");

  assert.equal(diagnostics.product_scope, SELECTED_SCOPE);
  assert.deepEqual(diagnostics.included_row_ids.sort(), [
    "applies-all",
    "aspire-w",
    "explicit-shared",
    "legacy-aspire-w-48",
    "products-aspire-wireless",
    "shared",
  ].sort());
  assert.deepEqual(
    diagnostics.excluded_cross_product_row_ids.sort(),
    [
      "ablaze",
      "aspire-wired",
      "arise",
      "legacy-ablaze-44",
      "products-ablaze",
      "products-arise",
      "products-aspire-wired",
    ].sort(),
  );
});

test("without a resolved title, scoping still works by canonical id", () => {
  const { kept } = scopeLegacyChunksToProduct({
    productScope: SELECTED_SCOPE,
    selectedProductTitle: null,
    chunks: CHUNKS,
  });
  const keptIds = new Set(kept.map((c) => c.id));
  // Canonical id + shared kept; cross-product excluded.
  assert(keptIds.has("aspire-w"));
  assert(keptIds.has("shared"));
  assert(keptIds.has("explicit-shared"));
  assert(keptIds.has("applies-all"));
  assert(!keptIds.has("ablaze"));
  assert(!keptIds.has("aspire-wired"));
  assert(!keptIds.has("products-aspire-wireless"));
  assert(!keptIds.has("products-aspire-wired"));
  // Legacy numeric ids cannot be confirmed without the title → excluded (safe).
  assert(!keptIds.has("legacy-aspire-w-48"));
  assert(!keptIds.has("legacy-ablaze-44"));
});

test("different selected product excludes A-Spire Wireless rows (no cross-product mixing)", () => {
  const { kept } = scopeLegacyChunksToProduct({
    productScope: "product-14930213372227", // A-Blaze selected
    selectedProductTitle: "A-Blaze",
    chunks: CHUNKS,
  });
  const keptIds = new Set(kept.map((c) => c.id));
  assert(keptIds.has("ablaze"), "A-Blaze row kept when A-Blaze is selected");
  assert(keptIds.has("shared"), "shared row always kept");
  assert(keptIds.has("products-ablaze"), "A-Blaze metadata.products row kept");
  assert(!keptIds.has("aspire-w"), "A-Spire Wireless excluded when A-Blaze selected");
  assert(!keptIds.has("products-aspire-wireless"), "A-Spire Wireless metadata.products row excluded");
  assert(!keptIds.has("legacy-aspire-w-48"), "A-Spire Wireless legacy excluded when A-Blaze selected");
});

test("A-Rise excludes metadata.products rows scoped to wired A-Spire", () => {
  const { kept } = scopeLegacyChunksToProduct({
    productScope: "product-7548536488182",
    selectedProductTitle: "A-Rise",
    chunks: CHUNKS,
  });
  const keptIds = new Set(kept.map((c) => c.id));
  assert(keptIds.has("products-arise"), "matching A-Rise metadata.products row kept");
  assert(!keptIds.has("products-aspire-wired"), "wired A-Spire metadata.products row excluded");
});

test("wired A-Spire excludes metadata.products rows scoped to A-Spire Wireless", () => {
  const { kept } = scopeLegacyChunksToProduct({
    productScope: "product-7548544745718",
    selectedProductTitle: "A-Spire",
    chunks: CHUNKS,
  });
  const keptIds = new Set(kept.map((c) => c.id));
  assert(keptIds.has("products-aspire-wired"), "matching wired A-Spire metadata.products row kept");
  assert(!keptIds.has("products-aspire-wireless"), "A-Spire Wireless metadata.products row excluded");
});

// --- Prefix-variant disambiguation via sibling product titles ---------------
// Wired "A-Spire" and "A-Spire Wireless" are distinct products. A legacy
// numeric-id row that clearly names one variant must not leak into the other.
const SHOP_PRODUCT_TITLES = [
  "A-Spire Wireless",
  "A-Spire",
  "A-Blaze",
  "A-Rise",
];

const VARIANT_CHUNKS = [
  // Legacy numeric ids that no longer resolve via shop_products:
  { id: "legacy-wireless-mic", product_id: "50", source_title: 'My microphone sounds like its "pulsating" for A-spire Wireless?', content: "..." },
  { id: "legacy-wired-mic", product_id: "51", source_title: "My microphone isn't working on my A-Spire?", content: "wired only" },
  { id: "shared", product_id: null, source_title: "Headset still doesn't work after guides", content: "general escalation" },
];

test("wired A-Spire excludes a legacy row naming A-Spire Wireless (prefix-variant leak)", () => {
  const { kept } = scopeLegacyChunksToProduct({
    productScope: "product-7548544745718", // wired A-Spire
    selectedProductTitle: "A-Spire",
    siblingProductTitles: SHOP_PRODUCT_TITLES,
    chunks: VARIANT_CHUNKS,
  });
  const keptIds = new Set(kept.map((c) => c.id));
  assert(!keptIds.has("legacy-wireless-mic"), "A-Spire Wireless legacy row excluded for wired A-Spire");
  assert(keptIds.has("legacy-wired-mic"), "wired A-Spire legacy row kept for wired A-Spire");
  assert(keptIds.has("shared"), "truly shared row always kept");
});

test("A-Spire Wireless keeps its own legacy row and excludes the wired-only legacy row", () => {
  const { kept } = scopeLegacyChunksToProduct({
    productScope: "product-9114609942851", // A-Spire Wireless
    selectedProductTitle: "A-Spire Wireless",
    siblingProductTitles: SHOP_PRODUCT_TITLES,
    chunks: VARIANT_CHUNKS,
  });
  const keptIds = new Set(kept.map((c) => c.id));
  assert(keptIds.has("legacy-wireless-mic"), "A-Spire Wireless legacy row kept for A-Spire Wireless");
  assert(!keptIds.has("legacy-wired-mic"), "wired-only A-Spire legacy row excluded for A-Spire Wireless");
  assert(keptIds.has("shared"), "truly shared row always kept");
});

test("explicitly shared row stays allowed even with sibling titles present", () => {
  const { kept } = scopeLegacyChunksToProduct({
    productScope: "product-7548544745718",
    selectedProductTitle: "A-Spire",
    siblingProductTitles: SHOP_PRODUCT_TITLES,
    chunks: [
      { id: "explicit-shared", product_id: null, products: ["all products"], source_title: "General support escalation", content: "shared" },
      { id: "applies-all", product_id: null, applies_to_all_products: true, source_title: "Shared app guidance", content: "shared" },
    ],
  });
  const keptIds = new Set(kept.map((c) => c.id));
  assert(keptIds.has("explicit-shared"), "explicit shared row kept");
  assert(keptIds.has("applies-all"), "applies_to_all_products row kept");
});

test("empty chunk list does not throw and keeps nothing", () => {
  const { kept, diagnostics } = scopeLegacyChunksToProduct({
    productScope: SELECTED_SCOPE,
    selectedProductTitle: SELECTED_TITLE,
    chunks: [],
  });
  assert.equal(kept.length, 0);
  assert.equal(diagnostics.included_row_ids.length, 0);
  assert.equal(diagnostics.excluded_cross_product_row_ids.length, 0);
});
