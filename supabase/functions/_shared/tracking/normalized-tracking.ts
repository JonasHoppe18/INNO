// Shared normalized read-only tracking model. Additive layer on top of the
// existing TrackingDetail produced by _shared/tracking.ts — it does NOT replace
// or alter the live GLS/PostNord resolver. Pure (no I/O).
import type { TrackingDetail } from "../tracking.ts";

export type ShipmentDirection = "outbound" | "return";

export type TrackingVerification =
  | "shopify_fulfillment"
  | "customer_provided"
  | "carrier_verified";

export type NormalizedTrackingState =
  | "label_created"
  | "in_transit"
  | "out_for_delivery"
  | "pickup_ready"
  | "delivered"
  | "exception"
  | "returned_to_sender"
  | "unknown"
  | "lookup_error";

export interface TrackingFact {
  tracking_number: string;
  carrier?: string;
  direction: ShipmentDirection;
  verification: TrackingVerification;
  state: NormalizedTrackingState;
  last_event_at?: string;
  delivered_at?: string;
  eta?: string;
  tracking_url?: string;
  source_order_id?: string;
}

// A real provider failure/timeout/malformed response — never "in transit".
export function isLookupFailureDetail(detail: TrackingDetail): boolean {
  const ld = String(detail.lookupDetail ?? "").toLowerCase();
  return ld.startsWith("api_failed") || ld === "request_error" ||
    ld === "api_url_invalid";
}

// A generic Shopify fallback (no live carrier verification): the carrier is
// unknown/not-selected, or its API is unconfigured. NOT a failure.
export function isGenericFallbackDetail(detail: TrackingDetail): boolean {
  const ls = String(detail.lookupSource ?? "").toLowerCase();
  const ld = String(detail.lookupDetail ?? "").toLowerCase();
  return ls === "shopify_fallback" ||
    ld === "generic_fallback" ||
    ld === "api_config_missing" ||
    ld === "carrier_unknown" ||
    ld === "carrier_not_selected";
}

// A live carrier actually returned a status (API or parsed public page).
export function isLiveVerifiedDetail(detail: TrackingDetail): boolean {
  return !isLookupFailureDetail(detail) && !isGenericFallbackDetail(detail);
}

function mapVerifiedState(detail: TrackingDetail): NormalizedTrackingState {
  const carrierStatus = String(detail.carrierStatus ?? "").toUpperCase();
  const text = String(detail.statusText ?? "").toLowerCase();
  if (carrierStatus === "PREADVICE") return "label_created";
  if (
    carrierStatus === "RETURNED" ||
    text.includes("return to sender") ||
    text.includes("returned to sender") ||
    text.includes("returneret til afsender")
  ) {
    return "returned_to_sender";
  }
  switch (String(detail.snapshot?.statusCode ?? "")) {
    case "delivered":
      return "delivered";
    case "out_for_delivery":
      return "out_for_delivery";
    case "pickup_ready":
      return "pickup_ready";
    case "exception":
      return "exception";
    case "in_transit":
      return "in_transit";
    case "label_created":
      return "label_created";
    default:
      return "unknown";
  }
}

// Maps an existing TrackingDetail into the normalized TrackingFact. Strict
// precedence: failure → lookup_error; live → mapped state; generic → unknown
// (the caller may upgrade a generic outbound via a concrete Shopify
// fulfillment.shipment_status). Never maps a failure/fallback to in_transit.
export function normalizeTrackingDetail(
  detail: TrackingDetail,
  ctx: {
    direction: ShipmentDirection;
    source_order_id?: string;
  },
): TrackingFact {
  const failure = isLookupFailureDetail(detail);
  const live = isLiveVerifiedDetail(detail);

  const state: NormalizedTrackingState = failure
    ? "lookup_error"
    : live
    ? mapVerifiedState(detail)
    : "unknown";

  const verification: TrackingVerification = ctx.direction === "outbound"
    ? (live ? "carrier_verified" : "shopify_fulfillment")
    : (live ? "carrier_verified" : "customer_provided");

  return {
    tracking_number: String(detail.trackingNumber ?? ""),
    carrier: detail.carrier || undefined,
    direction: ctx.direction,
    verification,
    state,
    last_event_at: detail.lastEventAt ?? detail.snapshot?.lastEvent?.occurredAt ?? undefined,
    delivered_at: detail.snapshot?.deliveredAt ?? undefined,
    eta: detail.snapshot?.expectedDeliveryAt ?? undefined,
    tracking_url: detail.trackingUrl || undefined,
    source_order_id: ctx.source_order_id,
  };
}

// Concrete Shopify fulfillment.shipment_status → state, for the generic-fallback
// outbound case ONLY (so we never infer in_transit just because a number exists,
// but DO use a real Shopify-reported status).
export function shopifyShipmentStatusToState(
  shipmentStatus?: string | null,
): NormalizedTrackingState | null {
  switch (String(shipmentStatus ?? "").toLowerCase()) {
    case "delivered":
      return "delivered";
    case "in_transit":
      return "in_transit";
    case "out_for_delivery":
      return "out_for_delivery";
    case "ready_for_pickup":
      return "pickup_ready";
    case "attempted_delivery":
      return "exception";
    case "label_printed":
    case "confirmed":
      return "label_created";
    default:
      return null;
  }
}
