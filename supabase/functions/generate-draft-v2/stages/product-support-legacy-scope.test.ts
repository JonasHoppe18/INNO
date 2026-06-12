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
  { id: "ablaze", product_id: "14930213372227", source_title: "Why does my headset keep disconnecting for A-Blaze?", content: "A-Blaze only" },
  { id: "aspire-wired", product_id: "7548544745718", source_title: "My microphone isn't working on my A-Spire", content: "wired A-Spire only" },
  { id: "arise", product_id: "7548536488182", source_title: "Repair on A-RISE", content: "A-Rise only" },
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
  assert(keptIds.has("legacy-aspire-w-48"), "legacy A-Spire Wireless row kept via title mention");

  // Blocked
  assert(!keptIds.has("ablaze"), "A-Blaze-only excluded");
  assert(!keptIds.has("aspire-wired"), "wired A-Spire-only excluded");
  assert(!keptIds.has("arise"), "A-Rise-only excluded");
  assert(!keptIds.has("legacy-ablaze-44"), "legacy A-Blaze row excluded");

  assert.equal(diagnostics.product_scope, SELECTED_SCOPE);
  assert.deepEqual(diagnostics.included_row_ids.sort(), ["aspire-w", "legacy-aspire-w-48", "shared"].sort());
  assert.deepEqual(
    diagnostics.excluded_cross_product_row_ids.sort(),
    ["ablaze", "aspire-wired", "arise", "legacy-ablaze-44"].sort(),
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
  assert(!keptIds.has("ablaze"));
  assert(!keptIds.has("aspire-wired"));
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
  assert(!keptIds.has("aspire-w"), "A-Spire Wireless excluded when A-Blaze selected");
  assert(!keptIds.has("legacy-aspire-w-48"), "A-Spire Wireless legacy excluded when A-Blaze selected");
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
