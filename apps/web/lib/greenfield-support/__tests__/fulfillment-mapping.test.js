import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { renderResponseSegments, validateStructuredResponse } from "../response-contract";
import { InMemoryCommerceProvider } from "../providers";
import { ShopifyReadOnlyProvider } from "../shopify-read-only";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function rawOrder(overrides = {}) {
  return {
    id: 17591640981853,
    order_number: 1055,
    email: "customer@example.test",
    fulfillment_status: "partial",
    financial_status: "paid",
    line_items: [
      { id: 46594101018973, variant_id: 63712473186653, title: "Cable", quantity: 5, fulfillable_quantity: 0 },
      { id: 46594101051741, variant_id: 63712473383261, title: "Mic", quantity: 1, fulfillable_quantity: 1 },
    ],
    fulfillments: [
      {
        id: 8175577104733,
        status: "success",
        tracking_company: "Bring",
        tracking_number: "TRACK-A",
        tracking_url: "https://tracking.example.test/TRACK-A",
        shipment_status: null,
        line_items: [{ id: 46594101018973, quantity: 2 }],
      },
      {
        id: 8175577104734,
        status: "success",
        tracking_company: "PostNord",
        tracking_number: "TRACK-B",
        tracking_url: "https://tracking.example.test/TRACK-B",
        shipment_status: null,
        line_items: [
          { id: 46594101018973, quantity: 3 },
          { id: 46594101051741, quantity: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

function shopifyFixtureProvider(payload = rawOrder()) {
  return new ShopifyReadOnlyProvider({
    shopDomain: "demo.myshopify.com",
    accessToken: "server-token",
    customer: { email: "customer@example.test" },
    fetchImpl: async () => jsonResponse({ orders: [payload] }),
  });
}

function fulfillmentOrder(overrides = {}) {
  return {
    id: "shopify-1055",
    orderNumber: "1055",
    status: "partial",
    financialStatus: "paid",
    fulfillmentStatus: "partial",
    items: [
      { id: "line-cable", title: "Cable", quantity: 5 },
      { id: "line-mic", title: "Mic", quantity: 1 },
    ],
    fulfillments: [
      {
        id: "fulfillment-a",
        status: "success",
        carrier: "Bring",
        trackingNumber: "TRACK-A",
        trackingUrl: "https://tracking.example.test/TRACK-A",
        shipmentStatus: null,
        itemMappingStatus: "verified",
        items: [{ orderLineItemId: "line-cable", title: "Cable", quantity: 2, orderedQuantity: 5, fulfilledQuantity: 5 }],
      },
      {
        id: "fulfillment-b",
        status: "success",
        carrier: "PostNord",
        trackingNumber: "TRACK-B",
        trackingUrl: "https://tracking.example.test/TRACK-B",
        shipmentStatus: null,
        itemMappingStatus: "verified",
        items: [
          { orderLineItemId: "line-cable", title: "Cable", quantity: 3, orderedQuantity: 5, fulfilledQuantity: 5 },
          { orderLineItemId: "line-mic", title: "Mic", quantity: 1, orderedQuantity: 1, fulfilledQuantity: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

function deliveredTrackingProvider() {
  return {
    providerName: "test_ship24",
    lookup: async (input) => ({
      status: "ok",
      data: {
        trackingNumber: input.trackingNumber,
        carrier: input.carrierHint,
        status: "delivered",
        subStatus: "delivered",
        latestEvent: null,
        estimatedDelivery: null,
        checkpoints: [],
        exception: null,
        observedAt: "2026-09-08T12:00:00.000Z",
        provider: "test_ship24",
        source: "test",
      },
    }),
  };
}

async function registryForOrder(order = fulfillmentOrder(), options = {}) {
  const dependencies = await createDemoDependencies();
  const commerce = new InMemoryCommerceProvider({
    customer: { email: dependencies.tenant.customerEmail, name: dependencies.tenant.customerName },
    orders: [order],
  });
  return createCapabilityRegistry({
    ...dependencies,
    commerce,
    tracking: options.tracking === undefined ? deliveredTrackingProvider() : options.tracking,
    orderReferences: options.orderReferences ?? [order.orderNumber],
  });
}

describe("generic read-only fulfillment mapping", () => {
  it("preserves stable line-item joins, partial quantities, split fulfillments, and tracking per fulfillment", async () => {
    const provider = shopifyFixtureProvider();
    const order = await provider.getOrder("1055");

    expect(order.items).toEqual([
      { id: "46594101018973", title: "Cable", quantity: 5, variantId: "63712473186653" },
      { id: "46594101051741", title: "Mic", quantity: 1, variantId: "63712473383261" },
    ]);
    expect(order.fulfillments).toHaveLength(2);
    expect(order.fulfillments[0]).toMatchObject({ id: "8175577104733", trackingNumber: "TRACK-A", itemMappingStatus: "verified" });
    expect(order.fulfillments[0].items).toEqual([expect.objectContaining({ orderLineItemId: "46594101018973", title: "Cable", quantity: 2, orderedQuantity: 5, fulfilledQuantity: 5 })]);
    expect(order.fulfillments[1].items).toEqual([
      expect.objectContaining({ orderLineItemId: "46594101018973", title: "Cable", quantity: 3 }),
      expect.objectContaining({ orderLineItemId: "46594101051741", title: "Mic", quantity: 1 }),
    ]);
    expect(order.fulfillments[0].items.some((item) => item.title === "Mic")).toBe(false);
    expect((await provider.inspectFulfillment("1055")).items).toEqual(order.items);
  });

  it("keeps an explicit unavailable state when Shopify omits fulfillment line items", async () => {
    const provider = shopifyFixtureProvider({
      ...rawOrder(),
      fulfillments: [{ ...rawOrder().fulfillments[0], line_items: undefined }],
    });
    const result = await provider.inspectFulfillment("1055");

    expect(result.fulfillments[0]).toMatchObject({ itemMappingStatus: "unavailable", items: [] });
    expect(result.status).toBe("ok");
    expect(result).not.toMatchObject({ status: "not_found" });
  });

  it("rejects a cross-order inspect request while keeping the existing order focus boundary", async () => {
    const registry = await registryForOrder();
    await registry.execute("get_order", JSON.stringify({ order_id: "1055" }));
    const result = await registry.execute("inspect_fulfillment", JSON.stringify({ order_id: "1063" }));

    expect(result).toMatchObject({ status: "invalid_request", error: { code: "order_focus_conflict" } });
  });

  it("rejects model-controlled cross-workspace scope arguments", async () => {
    const registry = await registryForOrder();
    const result = await registry.execute("inspect_fulfillment", JSON.stringify({ order_id: "1055", workspace_id: "other-workspace" }));

    expect(result).toMatchObject({ status: "invalid_arguments", error: { code: "trusted_context_argument" } });
  });

  it("validates and renders a mapped delivered item only with matching tracking provenance", async () => {
    const registry = await registryForOrder();
    await registry.execute("get_order", JSON.stringify({ order_id: "1055" }));
    const fulfillment = await registry.execute("inspect_fulfillment", JSON.stringify({ order_id: "1055" }));
    const tracking = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "TRACK-A" }));
    const result = validateStructuredResponse({
      segments: [{
        type: "fact",
        fact_kind: "shipment_item",
        evidence: [
          { result_id: fulfillment.resultId, field_paths: ["data.fulfillments[0].items[0]"] },
          { result_id: tracking.resultId, field_paths: ["data.tracking_identifier.fulfillment_id", "data.live_tracking.status"] },
        ],
      }],
    }, registry);

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("The delivered shipment included 2 × Cable.");
  });

  it("preserves shipped semantics without turning fulfillment into delivery", async () => {
    const registry = await registryForOrder(fulfillmentOrder(), { tracking: undefined });
    const fulfillment = await registry.execute("inspect_fulfillment", JSON.stringify({ order_id: "1055" }));
    const result = validateStructuredResponse({
      segments: [{ type: "fact", fact_kind: "shipment_item", evidence: [{ result_id: fulfillment.resultId, field_paths: ["data.fulfillments[0].items[0]"] }] }],
    }, registry);

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, registry);
    expect(rendered).toContain("The shipment included 2 × Cable.");
    expect(rendered).not.toContain("delivered");
  });

  it("rejects cross-fulfillment item mixing and cross-fulfillment delivered tracking", async () => {
    const registry = await registryForOrder();
    const fulfillment = await registry.execute("inspect_fulfillment", JSON.stringify({ order_id: "1055" }));
    const trackingB = await registry.execute("get_tracking", JSON.stringify({ tracking_number: "TRACK-B" }));

    const mixedItems = validateStructuredResponse({
      segments: [{
        type: "fact",
        fact_kind: "shipment_item",
        evidence: [{ result_id: fulfillment.resultId, field_paths: ["data.fulfillments[0].items[0].title", "data.fulfillments[1].items[0].quantity"] }],
      }],
    }, registry);
    expect(mixedItems.allValid).toBe(false);
    expect(mixedItems.issues[0].code).toBe("shipment_item_fields_required");

    const mixedTracking = validateStructuredResponse({
      segments: [{
        type: "fact",
        fact_kind: "shipment_item",
        evidence: [
          { result_id: fulfillment.resultId, field_paths: ["data.fulfillments[0].items[0]"] },
          { result_id: trackingB.resultId, field_paths: ["data.tracking_identifier.fulfillment_id", "data.live_tracking.status"] },
        ],
      }],
    }, registry);
    expect(mixedTracking.allValid).toBe(false);
    expect(mixedTracking.issues[0].code).toBe("shipment_item_tracking_scope_mismatch");
  });

  it("keeps missing item mapping explicit instead of manufacturing a relationship", async () => {
    const registry = await registryForOrder(fulfillmentOrder({
      fulfillments: [{ id: "fulfillment-a", status: "success", trackingNumber: "TRACK-A", trackingUrl: null, shipmentStatus: null, itemMappingStatus: "unavailable", items: [] }],
    }));
    const fulfillment = await registry.execute("inspect_fulfillment", JSON.stringify({ order_id: "1055" }));
    const result = validateStructuredResponse({
      segments: [{ type: "fact", fact_kind: "shipment_item", evidence: [{ result_id: fulfillment.resultId, field_paths: ["data.fulfillments[0].items[0]"] }] }],
    }, registry);

    expect(result.allValid).toBe(false);
    expect(result.issues[0].code).toBe("unknown_field_path");
    expect(fulfillment.data.fulfillments[0]).toMatchObject({ itemMappingStatus: "unavailable", items: [] });
  });

  it("keeps the existing order-item title/quantity binding intact", async () => {
    const registry = await registryForOrder();
    const order = await registry.execute("get_order", JSON.stringify({ order_id: "1055" }));
    const result = validateStructuredResponse({
      segments: [{ type: "fact", fact_kind: "order_item", evidence: [{ result_id: order.resultId, field_paths: ["data.items[0]"] }] }],
    }, registry);

    expect(result.allValid).toBe(true);
    expect(renderResponseSegments(result.approvedSegments, registry)).toContain("5 × Cable");
  });
});
