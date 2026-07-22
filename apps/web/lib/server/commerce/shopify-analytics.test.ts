// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { mapShopifyOrderFact, mapShopifyRefundFact } from "./shopify-analytics.js";

Deno.test("mapShopifyOrderFact keeps only non-customer analytics fields", () => {
  const row = mapShopifyOrderFact({
    id: 42,
    order_number: 1001,
    created_at: "2026-07-20T10:00:00Z",
    current_total_price: "799.95",
    currency: "dkk",
    financial_status: "paid",
    email: "must-not-be-stored@example.com",
    shipping_address: { address1: "Must not be stored" },
  }, { workspaceId: "workspace", shopId: "shop", syncedAt: "2026-07-22T10:00:00Z" });

  assertEquals(row, {
    workspace_id: "workspace",
    shop_id: "shop",
    external_order_id: "42",
    order_number: "1001",
    order_created_at: "2026-07-20T10:00:00Z",
    total_amount: 799.95,
    currency: "DKK",
    financial_status: "paid",
    cancelled_at: null,
    synced_at: "2026-07-22T10:00:00Z",
  });
});

Deno.test("mapShopifyRefundFact sums successful refund transactions and maps product facts", () => {
  const result = mapShopifyRefundFact({
    id: 9,
    order_id: 42,
    processed_at: "2026-07-21T10:00:00Z",
    note: "Free text must not be stored",
    transactions: [
      { kind: "refund", status: "success", amount: "125.50", currency: "DKK" },
      { kind: "refund", status: "failure", amount: "10.00", currency: "DKK" },
    ],
    refund_line_items: [{
      line_item_id: 7,
      quantity: 1,
      subtotal: "100.00",
      total_tax: "25.50",
      line_item: { id: 7, product_id: 88, title: "Must not be stored" },
    }],
  }, { workspaceId: "workspace", shopId: "shop", syncedAt: "2026-07-22T10:00:00Z" });

  assertEquals(result, {
    refund: {
      workspace_id: "workspace",
      shop_id: "shop",
      external_refund_id: "9",
      external_order_id: "42",
      refunded_at: "2026-07-21T10:00:00Z",
      amount: 125.5,
      currency: "DKK",
      synced_at: "2026-07-22T10:00:00Z",
    },
    items: [{
      external_line_item_id: "7",
      external_product_id: "88",
      quantity: 1,
      amount: 125.5,
    }],
  });
});
