import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  fetchTrackingDetailsForOrders,
  resolveOutboundTrackingFacts,
  resolveReturnTrackingFact,
  type TrackingDetail,
} from "../tracking.ts";

function liveDetail(num: string, statusCode: string): TrackingDetail {
  return {
    carrier: "GLS",
    statusText: statusCode,
    trackingNumber: num,
    trackingUrl: `https://gls-group.eu/track?match=${num}`,
    lookupSource: "gls_api",
    lookupDetail: "ok",
    snapshot: { statusCode, statusText: statusCode, events: [] },
  };
}

const order = {
  id: "555",
  name: "#555",
  fulfillments: [
    { tracking_company: "GLS", tracking_number: "PARCEL_A", tracking_url: "https://gls-group.eu/track?match=PARCEL_A", shipment_status: "in_transit" },
    { tracking_company: "GLS", tracking_number: "PARCEL_B", tracking_url: "https://gls-group.eu/track?match=PARCEL_B", shipment_status: "delivered" },
  ],
};

// 9, 12, 13. multiple outbound parcels → all returned, direction outbound, separate states
Deno.test("resolveOutboundTrackingFacts returns all parcels with separate states", async () => {
  const facts = await resolveOutboundTrackingFacts(order, {
    fetchDetail: (c) => Promise.resolve(liveDetail(c.trackingNumber, c.trackingNumber === "PARCEL_A" ? "in_transit" : "delivered")),
  });
  assertEquals(facts.length, 2);
  assert(facts.every((f) => f.direction === "outbound"));
  assertEquals(facts.map((f) => f.state).sort(), ["delivered", "in_transit"]);
  assertEquals(facts.map((f) => f.tracking_number).sort(), ["PARCEL_A", "PARCEL_B"]);
  assert(facts.every((f) => f.source_order_id === "555"));
});

// 8 (generic fallback) → upgraded via concrete Shopify shipment_status, not invented
Deno.test("generic fallback upgraded by concrete Shopify shipment_status → shopify_fulfillment", async () => {
  const facts = await resolveOutboundTrackingFacts(
    { id: "9", fulfillments: [{ tracking_company: "Carrier", tracking_number: "X", shipment_status: "delivered" }] },
    { fetchDetail: () => Promise.resolve({ carrier: "Carrier", statusText: "Shipped...", trackingNumber: "X", trackingUrl: "", lookupSource: "shopify_fallback", lookupDetail: "carrier_unknown", snapshot: { statusCode: "in_transit", statusText: "Shipped...", events: [] } }) },
  );
  assertEquals(facts.length, 1);
  assertEquals(facts[0].verification, "shopify_fulfillment");
  assertEquals(facts[0].state, "delivered");
});

// 3 & 4. return tracking — supported carrier verified; unsupported stays customer_provided
Deno.test("resolveReturnTrackingFact: supported carrier → carrier_verified, direction return", async () => {
  const fact = await resolveReturnTrackingFact(
    { tracking_number: "JJD123", carrier_hint: "GLS" },
    { fetchDetail: () => Promise.resolve(liveDetail("JJD123", "in_transit")) },
  );
  assertEquals(fact.direction, "return");
  assertEquals(fact.verification, "carrier_verified");
  assertEquals(fact.state, "in_transit");
});

Deno.test("resolveReturnTrackingFact: unsupported carrier (USPS) → customer_provided + unknown, no fetch", async () => {
  let fetched = false;
  const fact = await resolveReturnTrackingFact(
    { tracking_number: "9588871095290073926950", carrier_hint: "USPS" },
    { fetchDetail: () => { fetched = true; return Promise.resolve(liveDetail("x", "delivered")); } },
  );
  assertEquals(fact.direction, "return");
  assertEquals(fact.verification, "customer_provided");
  assertEquals(fact.state, "unknown");
  assertEquals(fetched, false); // unsupported → never calls a carrier
});

// 11. outbound facts cannot be reused as return facts (distinct functions / direction)
Deno.test("outbound and return facts never share direction", async () => {
  const out = await resolveOutboundTrackingFacts(order, { fetchDetail: (c) => Promise.resolve(liveDetail(c.trackingNumber, "in_transit")) });
  const ret = await resolveReturnTrackingFact({ tracking_number: "PARCEL_A", carrier_hint: "GLS" }, { fetchDetail: () => Promise.resolve(liveDetail("PARCEL_A", "in_transit")) });
  assert(out.every((f) => f.direction === "outbound"));
  assertEquals(ret.direction, "return");
});

// 19. backward-compat: legacy function still present, same shape, empty for no fulfillments
Deno.test("fetchTrackingDetailsForOrders backward-compatible (no fulfillments → {})", async () => {
  const res = await fetchTrackingDetailsForOrders([{ id: "1", fulfillments: [] }]);
  assertEquals(res, {});
});
