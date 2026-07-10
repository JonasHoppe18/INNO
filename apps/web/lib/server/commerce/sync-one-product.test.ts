// @ts-nocheck
import { assertEquals, assert } from "jsr:@std/assert@1";
import { buildProductContext, chunkText, stripHtml, upsertProductKnowledge } from "./sync-one-product.js";

Deno.test("buildProductContext labels prices with currency", () => {
  const ctx = buildProductContext(
    { title: "A-Blaze", variants: [{ title: "Default", price: "199.00" }] },
    { currency: "EUR" },
  );
  assert(ctx.includes("Price: EUR 199.00"));
  assert(ctx.includes("Product: A-Blaze"));
});

Deno.test("stripHtml removes tags and collapses whitespace", () => {
  assertEquals(stripHtml("<p>Hej   <b>der</b></p>"), "Hej der");
});

Deno.test("chunkText returns empty for blank input", () => {
  assertEquals(chunkText(""), []);
});

function fakeClient(calls) {
  return {
    from(table) {
      return {
        delete() { return this; },
        eq() { return this; },
        insert(row) { calls.push({ table, row }); return { error: null }; },
      };
    },
  };
}

Deno.test("upsertProductKnowledge inserts chunks with product_id metadata", async () => {
  const calls = [];
  const normalized = {
    price_display: "199.00",
    currency: "EUR",
    handle: "a-blaze",
    product_updated_at: "2026-07-01T00:00:00Z",
    product_url: "https://shop.example.com/products/a-blaze",
    status: "active",
    is_placeholder_price: false,
  };
  const res = await upsertProductKnowledge({
    serviceClient: fakeClient(calls),
    creds: { shop_id: "s1", workspace_id: "w1" },
    product: { id: 42, title: "A-Blaze", variants: [{ price: "199.00" }] },
    normalized,
    currency: "EUR",
    embedText: async () => [0.1, 0.2],
  });
  assertEquals(res.indexed, true);
  assert(calls.length >= 1);
  assertEquals(calls[0].row.metadata.product_id, "42");
  assertEquals(calls[0].row.metadata.currency, "EUR");
  assertEquals(calls[0].row.metadata.price, "199.00");
  assertEquals(calls[0].row.metadata.handle, "a-blaze");
  assertEquals(calls[0].row.metadata.url, "https://shop.example.com/products/a-blaze");
  assertEquals(calls[0].row.metadata.status, "active");
  assertEquals(calls[0].row.metadata.is_placeholder_price, false);
  assertEquals(calls[0].row.metadata.product_updated_at, "2026-07-01T00:00:00Z");
});

Deno.test("upsertProductKnowledge defaults is_placeholder_price to false when normalized is omitted", async () => {
  const calls = [];
  const res = await upsertProductKnowledge({
    serviceClient: fakeClient(calls),
    creds: { shop_id: "s1", workspace_id: "w1" },
    product: { id: 43, title: "No Normalized", variants: [{ price: "10.00" }] },
    currency: "EUR",
    embedText: async () => [0.1, 0.2],
  });
  assertEquals(res.indexed, true);
  assertEquals(calls[0].row.metadata.is_placeholder_price, false);
  assertEquals(calls[0].row.metadata.handle, null);
  assertEquals(calls[0].row.metadata.price, null);
});
