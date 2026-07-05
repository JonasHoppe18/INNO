// Ship24 outbound fallback provider (P2-1).
//
// READ-ONLY: POST https://api.ship24.com/public/v1/tracking/search returns live
// courier status for a tracking number in a single call, with no persistent
// tracker and no webhook. Used by fetchTrackingDetailForCandidate for carriers
// without a native API integration; it never touches the native GLS/PostNord
// paths.
//
// Safe by construction: the provider only ever emits a TrackingDetail and lets
// the shared normalizeTrackingDetail decide the final state. Verified milestone
// → carrier-verified state; empty/null/pending → generic fallback (→ unknown);
// real failure (429/5xx/timeout/malformed/network) → request/api_failed
// (→ lookup_error). It NEVER infers in_transit/delivered from the mere
// existence of a tracking number.
import type { NormalizedTrackingEvent, TrackingDetail, TrackingSnapshot } from "../../../tracking.ts";

const SHIP24_SEARCH_URL = "https://api.ship24.com/public/v1/tracking/search";
const DEFAULT_TIMEOUT_MS = Number(Deno.env.get("SHIP24_TIMEOUT_MS") ?? "5000");

function readEnv(name: string): string {
  try {
    const v = typeof Deno !== "undefined" ? Deno.env.get(name) : undefined;
    return String(v ?? "").trim();
  } catch {
    return "";
  }
}

export function isShip24Configured(): boolean {
  return readEnv("SHIP24_API_KEY").length > 0;
}

// Pure: Ship24 statusMilestone → the INTERNAL snapshot.statusCode vocabulary
// that mapVerifiedState already understands. pending/null/unknown → "" so the
// shared normalizer resolves it to "unknown" (never in_transit).
export function ship24MilestoneToInternalStatusCode(
  milestone: string | null | undefined,
): string {
  switch (String(milestone ?? "").toLowerCase()) {
    case "info_received":
      return "label_created";
    case "in_transit":
      return "in_transit";
    case "out_for_delivery":
      return "out_for_delivery";
    case "available_for_pickup":
      return "pickup_ready";
    case "delivered":
      return "delivered";
    case "failed_attempt":
    case "exception":
      return "exception";
    case "pending":
    default:
      return "";
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Normalize to ISO, consistent with the GLS/PostNord adapters. Invalid/empty → null.
function normalizeIso(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeShip24Event(event: Record<string, unknown>): NormalizedTrackingEvent | null {
  const description = asString(event.status) || asString(event.description);
  const occurredAt = normalizeIso(event.datetime) || normalizeIso(event.occurrenceDatetime);
  const code = asString(event.statusCode) || asString(event.statusMilestone) || null;
  const location = asString(event.location) || asString(event.city) || null;
  if (!description && !occurredAt && !code && !location) return null;
  return {
    code,
    description: description || null,
    occurredAt,
    location,
  };
}

function dedupeShip24Events(events: NormalizedTrackingEvent[]): NormalizedTrackingEvent[] {
  const seen = new Set<string>();
  const deduped: NormalizedTrackingEvent[] = [];
  for (const event of events) {
    const key = [
      String(event.code || "").trim().toLowerCase(),
      String(event.description || "").trim().toLowerCase(),
      String(event.location || "").trim().toLowerCase(),
      String(event.occurredAt || "").trim(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

function carrierLabel(courierCode: string): string {
  const c = courierCode.toLowerCase();
  if (c.startsWith("gls")) return "GLS";
  if (c.startsWith("postnord")) return "PostNord";
  if (c.startsWith("dhl")) return "DHL";
  if (c.startsWith("ups")) return "UPS";
  if (c.startsWith("fedex")) return "FedEx";
  if (c.startsWith("dpd")) return "DPD";
  if (c.startsWith("bring")) return "Bring";
  if (c.startsWith("dao")) return "DAO";
  return courierCode ? courierCode.toUpperCase() : "Carrier";
}

function genericFallback(
  trackingNumber: string,
  trackingUrl: string,
  detail: string,
): TrackingDetail {
  // lookupSource "shopify_fallback" → isGenericFallbackDetail → state "unknown".
  return {
    carrier: "Carrier",
    statusText: "Shipped - follow the parcel via tracking link.",
    trackingNumber,
    trackingUrl,
    lookupSource: "shopify_fallback",
    lookupDetail: detail,
  };
}

function failure(
  trackingNumber: string,
  trackingUrl: string,
  detail: string,
): TrackingDetail {
  // lookupDetail "api_failed:*" / "request_error" → isLookupFailureDetail →
  // state "lookup_error".
  return {
    carrier: "Carrier",
    statusText: "Tracking status could not be verified.",
    trackingNumber,
    trackingUrl,
    lookupSource: "ship24_api",
    lookupDetail: detail,
  };
}

// Pure: parsed Ship24 payload → TrackingDetail. Empty/null milestone with no
// events is a cold/unknown number → generic fallback (→ unknown). A real
// milestone → ship24_api/ok with an internal-coded snapshot.
export function ship24PayloadToTrackingDetail(
  payload: unknown,
  ctx: { trackingNumber: string; trackingUrl?: string },
): TrackingDetail {
  const trackingUrl = ctx.trackingUrl ?? "";
  const root = (payload && typeof payload === "object") ? payload as Record<string, unknown> : {};
  const data = (root.data && typeof root.data === "object") ? root.data as Record<string, unknown> : {};
  const trackings = Array.isArray(data.trackings) ? data.trackings : [];
  const tracking = (trackings[0] && typeof trackings[0] === "object")
    ? trackings[0] as Record<string, unknown>
    : null;
  const shipment = (tracking?.shipment && typeof tracking.shipment === "object")
    ? tracking.shipment as Record<string, unknown>
    : {};
  const events = Array.isArray(tracking?.events) ? tracking!.events as Array<Record<string, unknown>> : [];

  const milestone = asString(shipment.statusMilestone);
  const internalStatusCode = ship24MilestoneToInternalStatusCode(milestone);

  // Cold/unknown/empty number: 201 + null milestone + no events → unknown.
  if (!internalStatusCode && events.length === 0) {
    return genericFallback(ctx.trackingNumber, trackingUrl, "ship24_no_data");
  }

  const normalizedEvents = dedupeShip24Events(
    events
      .map((event) => normalizeShip24Event(event))
      .filter((event): event is NormalizedTrackingEvent => Boolean(event)),
  );
  const latest = events[0] ?? null;
  const courierCode = asString(latest?.courierCode) || asString(shipment.courierCode);
  const statusText = asString(latest?.status) || milestone || "Shipped - follow the parcel via tracking link.";
  const lastEventAt = normalizeIso(latest?.datetime) || normalizeIso(latest?.occurrenceDatetime) || null;

  // Return-to-sender: any exception_return signal → carrierStatus "RETURNED" so
  // the shared normalizer maps it to returned_to_sender.
  const shipmentStatusCode = asString(shipment.statusCode).toLowerCase();
  const latestStatusCode = asString(latest?.statusCode).toLowerCase();
  const isReturn = shipmentStatusCode.includes("exception_return") ||
    latestStatusCode.includes("exception_return");

  const stats = (tracking?.statistics && typeof tracking.statistics === "object")
    ? (tracking.statistics as Record<string, unknown>).timestamps as Record<string, unknown> | undefined
    : undefined;
  const delivery = (shipment.delivery && typeof shipment.delivery === "object")
    ? shipment.delivery as Record<string, unknown>
    : {};

  const snapshot: TrackingSnapshot = {
    statusCode: internalStatusCode || null,
    statusText,
    deliveredAt: internalStatusCode === "delivered" ? (normalizeIso(stats?.deliveredDatetime) || lastEventAt) : null,
    outForDeliveryAt: internalStatusCode === "out_for_delivery" ? (normalizeIso(stats?.outForDeliveryDatetime) || lastEventAt) : null,
    pickupReadyAt: internalStatusCode === "pickup_ready" ? (normalizeIso(stats?.availableForPickupDatetime) || lastEventAt) : null,
    expectedDeliveryAt: normalizeIso(delivery.estimatedDeliveryDate) || null,
    lastEvent: normalizedEvents[0] ?? null,
    events: normalizedEvents,
  };

  return {
    carrier: carrierLabel(courierCode),
    statusText,
    trackingNumber: ctx.trackingNumber,
    trackingUrl,
    carrierStatus: isReturn ? "RETURNED" : null,
    lastEventAt,
    lookupSource: "ship24_api",
    lookupDetail: "ok",
    snapshot,
  };
}

export type FetchShip24Options = {
  courierCode?: string;
  trackingUrl?: string;
  timeoutMs?: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

// Read-only single-call Ship24 lookup. Degrades to a safe TrackingDetail on
// every failure mode; never throws.
export async function fetchShip24Status(
  trackingNumber: string,
  opts?: FetchShip24Options,
): Promise<TrackingDetail> {
  const trackingUrl = opts?.trackingUrl ?? "";
  const apiKey = opts?.apiKey ?? readEnv("SHIP24_API_KEY");
  if (!apiKey) {
    return genericFallback(trackingNumber, trackingUrl, "api_config_missing");
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Omit courierCode by default so Ship24 auto-detects the courier.
    const body: Record<string, unknown> = { trackingNumber };
    if (opts?.courierCode) body.courierCode = [opts.courierCode];

    const response = await fetchImpl(SHIP24_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      return failure(trackingNumber, trackingUrl, `api_failed:http_${response.status}`);
    }

    const payload = await response.json().catch(() => null);
    if (!payload) {
      return failure(trackingNumber, trackingUrl, "request_error");
    }
    return ship24PayloadToTrackingDetail(payload, { trackingNumber, trackingUrl });
  } catch {
    return failure(trackingNumber, trackingUrl, "request_error");
  } finally {
    clearTimeout(timer);
  }
}
