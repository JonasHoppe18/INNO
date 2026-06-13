import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  normalizeTrackingDetail,
  type TrackingFact,
} from "./normalized-tracking.ts";
import type { TrackingDetail } from "../tracking.ts";

function detail(partial: Partial<TrackingDetail>): TrackingDetail {
  return {
    carrier: "GLS",
    statusText: "In transit.",
    trackingNumber: "JJD000",
    trackingUrl: "https://gls-group.eu/track?match=JJD000",
    lookupSource: "gls_api",
    lookupDetail: "ok",
    snapshot: { statusCode: "in_transit", statusText: "In transit.", events: [] },
    ...partial,
  };
}

// 1. GLS outbound normalizes correctly (delivered)
Deno.test("GLS delivered → carrier_verified delivered (outbound)", () => {
  const f = normalizeTrackingDetail(
    detail({
      carrier: "GLS",
      carrierStatus: "DELIVERED",
      lookupSource: "gls_api",
      snapshot: { statusCode: "delivered", statusText: "Delivered.", deliveredAt: "2026-05-08T10:00:00Z", events: [] },
    }),
    { direction: "outbound", source_order_id: "111" },
  );
  assertEquals(f.direction, "outbound");
  assertEquals(f.verification, "carrier_verified");
  assertEquals(f.state, "delivered");
  assertEquals(f.delivered_at, "2026-05-08T10:00:00Z");
  assertEquals(f.source_order_id, "111");
});

// GLS PREADVICE → label_created
Deno.test("GLS PREADVICE → label_created", () => {
  const f = normalizeTrackingDetail(
    detail({ carrierStatus: "PREADVICE", snapshot: { statusCode: "in_transit", statusText: "Shipment data received by carrier.", events: [] } }),
    { direction: "outbound" },
  );
  assertEquals(f.state, "label_created");
});

// returned_to_sender from status text
Deno.test("return-to-sender text → returned_to_sender", () => {
  const f = normalizeTrackingDetail(
    detail({ statusText: "Returned to sender", carrierStatus: "NOTDELIVERED", snapshot: { statusCode: "exception", statusText: "Returned to sender", events: [] } }),
    { direction: "outbound" },
  );
  assertEquals(f.state, "returned_to_sender");
});

// 2. PostNord outbound normalizes correctly
Deno.test("PostNord out_for_delivery → carrier_verified out_for_delivery", () => {
  const f = normalizeTrackingDetail(
    detail({ carrier: "PostNord", lookupSource: "postnord_api", snapshot: { statusCode: "out_for_delivery", statusText: "Out for delivery today.", expectedDeliveryAt: "2026-05-09T00:00:00Z", events: [] } }),
    { direction: "outbound" },
  );
  assertEquals(f.carrier, "PostNord");
  assertEquals(f.verification, "carrier_verified");
  assertEquals(f.state, "out_for_delivery");
  assertEquals(f.eta, "2026-05-09T00:00:00Z");
});

// PostNord public-page parse counts as carrier-verified
Deno.test("PostNord public-page delivered → carrier_verified delivered", () => {
  const f = normalizeTrackingDetail(
    detail({ carrier: "PostNord", lookupSource: "postnord_public_page", lookupDetail: "public_page_parse", statusText: "Pakken er leveret.", snapshot: { statusCode: "delivered", statusText: "Pakken er leveret.", events: [] } }),
    { direction: "outbound" },
  );
  assertEquals(f.verification, "carrier_verified");
  assertEquals(f.state, "delivered");
});

// 6 & 7. provider failure → lookup_error, never in_transit
Deno.test("provider failure → lookup_error (never in_transit)", () => {
  for (const ld of ["api_failed:http_500", "request_error", "api_url_invalid"]) {
    const f = normalizeTrackingDetail(
      detail({ lookupSource: "shopify_fallback", lookupDetail: ld, statusText: "Shipped - follow the parcel via tracking link.", snapshot: { statusCode: "in_transit", statusText: "Shipped...", events: [] } }),
      { direction: "outbound" },
    );
    assertEquals(f.state, "lookup_error", ld);
    assert(f.state !== "in_transit");
  }
});

// 8. Shopify fallback never invents in_transit
Deno.test("generic shopify fallback → unknown, not in_transit (outbound = shopify_fulfillment)", () => {
  const f = normalizeTrackingDetail(
    detail({ lookupSource: "shopify_fallback", lookupDetail: "generic_fallback", statusText: "Shipped - follow the parcel via tracking link.", snapshot: { statusCode: "in_transit", statusText: "Shipped...", events: [] } }),
    { direction: "outbound" },
  );
  assertEquals(f.state, "unknown");
  assertEquals(f.verification, "shopify_fulfillment");
});

// config-missing dormant carrier → unknown (not lookup_error)
Deno.test("config-missing dormant carrier → unknown", () => {
  const f = normalizeTrackingDetail(
    detail({ carrier: "DHL", lookupSource: "shopify_fallback", lookupDetail: "api_config_missing", snapshot: { statusCode: "in_transit", statusText: "Shipped...", events: [] } }),
    { direction: "outbound" },
  );
  assertEquals(f.state, "unknown");
});

// 5. unsupported/unknown carrier → unknown
Deno.test("carrier_unknown → unknown", () => {
  const f = normalizeTrackingDetail(
    detail({ carrier: "Carrier", lookupSource: "shopify_fallback", lookupDetail: "carrier_unknown", snapshot: { statusCode: "in_transit", statusText: "Shipped...", events: [] } }),
    { direction: "return" },
  );
  assertEquals(f.state, "unknown");
  assertEquals(f.verification, "customer_provided");
});

// return live failure → customer_provided + lookup_error
Deno.test("return provider failure → customer_provided + lookup_error", () => {
  const f = normalizeTrackingDetail(
    detail({ lookupSource: "shopify_fallback", lookupDetail: "api_failed:http_503" }),
    { direction: "return" },
  );
  assertEquals(f.direction, "return");
  assertEquals(f.verification, "customer_provided");
  assertEquals(f.state, "lookup_error");
});

// return live ok → carrier_verified
Deno.test("return live ok → carrier_verified", () => {
  const f = normalizeTrackingDetail(
    detail({ lookupSource: "gls_api", lookupDetail: "ok", snapshot: { statusCode: "in_transit", statusText: "In transit.", events: [] } }),
    { direction: "return" },
  );
  assertEquals(f.verification, "carrier_verified");
  assertEquals(f.state, "in_transit");
});
