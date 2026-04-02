import { getGlsTrackingSnapshot, type TrackingSnapshot as GlsProviderSnapshot } from "./tracking/providers/gls/index.ts";

type TrackingEvent = {
  status?: string;
  statusText?: string;
  statusDescription?: string;
  description?: string;
  city?: string;
  location?: string;
  locationName?: string;
  depot?: string;
  date?: string;
  dateTime?: string;
  eventTime?: string;
};

export type NormalizedTrackingEvent = {
  code: string | null;
  description: string | null;
  occurredAt: string | null;
  location?: string | null;
  pickupPoint?: {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
};

export type TrackingSnapshot = {
  statusCode: string | null;
  statusText: string;
  deliveredAt?: string | null;
  outForDeliveryAt?: string | null;
  expectedDeliveryAt?: string | null;
  pickupReadyAt?: string | null;
  pickupPoint?: NormalizedTrackingEvent["pickupPoint"];
  lastEvent?: NormalizedTrackingEvent | null;
  events: NormalizedTrackingEvent[];
  deliveryCity?: string | null;
};

export type TrackingDetail = {
  carrier: string;
  statusText: string;
  trackingNumber: string;
  trackingUrl: string;
  carrierStatus?: string | null;
  deliveredToParcelShop?: boolean;
  lastEventAt?: string | null;
  source?: "shopify" | "webshipper";
  lookupSource?: string;
  lookupDetail?: string;
  snapshot?: TrackingSnapshot | null;
};

type CarrierCode = "postnord" | "gls" | "dao" | "bring" | "dhl" | "ups" | "unknown";

const GLS_TRACKING_ENDPOINT =
  "https://gls-group.eu/app/service/open/rest/TrackAndTrace/piece/";
const TRACKING_EVENTS_ENABLED = (Deno.env.get("TRACKING_EVENTS_ENABLED") ?? "false")
  .toLowerCase() === "true";
const BRING_API_UID = Deno.env.get("BRING_API_UID") ?? "";
const BRING_API_KEY = Deno.env.get("BRING_API_KEY") ?? "";
const BRING_TRACKING_API_URL = Deno.env.get("BRING_TRACKING_API_URL") ?? "https://api.bring.com/tracking/api/v1/trackings";
const POSTNORD_API_KEY = Deno.env.get("POSTNORD_API_KEY") ?? "";
const POSTNORD_TRACKING_API_URL =
  Deno.env.get("POSTNORD_TRACKING_API_URL") ??
  "https://api2.postnord.com/rest/shipment/v5/trackandtrace/findByIdentifier.json";
const POSTNORD_TRACKING_LOCALE = Deno.env.get("POSTNORD_TRACKING_LOCALE") ?? "en";
const DAO_TRACKING_API_URL = Deno.env.get("DAO_TRACKING_API_URL") ?? "";
const DAO_API_KEY = Deno.env.get("DAO_API_KEY") ?? "";
const DAO_API_AUTH_HEADER = Deno.env.get("DAO_API_AUTH_HEADER") ?? "Authorization";
const DAO_API_KEY_PREFIX = Deno.env.get("DAO_API_KEY_PREFIX") ?? "Bearer ";
const DAO_TRACKING_QUERY_PARAM = Deno.env.get("DAO_TRACKING_QUERY_PARAM") ?? "tracking_number";
const DHL_TRACKING_API_URL = Deno.env.get("DHL_TRACKING_API_URL") ?? "";
const DHL_API_KEY = Deno.env.get("DHL_API_KEY") ?? "";
const DHL_API_AUTH_HEADER = Deno.env.get("DHL_API_AUTH_HEADER") ?? "DHL-API-Key";
const DHL_API_KEY_PREFIX = Deno.env.get("DHL_API_KEY_PREFIX") ?? "";
const DHL_TRACKING_QUERY_PARAM = Deno.env.get("DHL_TRACKING_QUERY_PARAM") ?? "trackingNumber";
const UPS_TRACKING_API_URL = Deno.env.get("UPS_TRACKING_API_URL") ?? "";
const UPS_API_KEY = Deno.env.get("UPS_API_KEY") ?? "";
const UPS_API_AUTH_HEADER = Deno.env.get("UPS_API_AUTH_HEADER") ?? "Authorization";
const UPS_API_KEY_PREFIX = Deno.env.get("UPS_API_KEY_PREFIX") ?? "Bearer ";
const UPS_TRACKING_QUERY_PARAM = Deno.env.get("UPS_TRACKING_QUERY_PARAM") ?? "trackingNumber";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = extractText(entry);
      if (text) return text;
    }
    return "";
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = [
      "text",
      "value",
      "description",
      "eventDescription",
      "displayName",
      "name",
      "label",
      "status",
      "statusText",
      "message",
      "en",
      "sv",
      "da",
      "no",
    ];
    for (const key of keys) {
      const text = extractText(obj[key]);
      if (text) return text;
    }
  }
  return "";
}

function pickOrderKey(order: any): string | null {
  return (
    (order?.id ? String(order.id) : null) ||
    (order?.order_number ? String(order.order_number) : null) ||
    (order?.name ? String(order.name) : null)
  );
}

function formatTimestamp(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  try {
    return parsed.toLocaleString("da-DK", {
      timeZone: "Europe/Copenhagen",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return parsed.toISOString();
  }
}

function extractTrackingNumberFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const keys = ["match", "trackingNumber", "trackingnumber", "id", "shipmentId"];
    for (const key of keys) {
      const value = parsed.searchParams.get(key);
      if (value) return value;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? null;
  } catch {
    return null;
  }
}

function normalizeIso(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString();
}

function normalizePickupPoint(value: any): NormalizedTrackingEvent["pickupPoint"] {
  if (!value || typeof value !== "object") return null;
  const point = {
    name: asString(value?.name || value?.title || value?.pickup_point_name) || null,
    address: asString(value?.address || value?.address1 || value?.street) || null,
    city: asString(value?.city || value?.town) || null,
    postalCode: asString(value?.postal_code || value?.zip || value?.zip_code) || null,
    country: asString(value?.country || value?.country_code) || null,
  };
  if (!point.name && !point.address && !point.city && !point.postalCode && !point.country) return null;
  return point;
}

function buildSnapshotFromStatusText(statusText: string): TrackingSnapshot {
  const lower = asString(statusText).toLowerCase();
  let statusCode = "in_transit";
  if (lower.includes("leveret") || lower.includes("delivered")) statusCode = "delivered";
  else if (lower.includes("out for delivery") || lower.includes("ude til levering")) {
    statusCode = "out_for_delivery";
  } else if (lower.includes("pickup") || lower.includes("pakkeshop") || lower.includes("afhent")) {
    statusCode = "pickup_ready";
  } else if (lower.includes("delay") || lower.includes("forsink") || lower.includes("exception")) {
    statusCode = "exception";
  }

  return {
    statusCode,
    statusText: statusText || "Shipped - follow the parcel via tracking link.",
    events: [],
  };
}

function toNormalizedEvent(value: any): NormalizedTrackingEvent | null {
  if (!value || typeof value !== "object") return null;
  const code = extractText(
    value?.code || value?.event_code || value?.status || value?.status_code || value?.eventCode,
  ) || null;
  const description = extractText(
    value?.description ||
      value?.statusText ||
      value?.status_text ||
      value?.label ||
      value?.message ||
      value?.eventDescription,
  ) || null;
  const occurredAt =
    normalizeIso(
      value?.occurredAt ||
        value?.occurred_at ||
        value?.dateTime ||
        value?.date ||
        value?.eventDate ||
        value?.eventTime ||
        value?.created_at ||
        value?.updated_at,
    ) || null;
  const location = extractText(
    value?.location ||
      value?.locationName ||
      value?.city ||
      value?.depot ||
      value?.hub ||
      value?.eventLocation ||
      value?.location?.displayName,
  ) || null;
  const pickupPoint = normalizePickupPoint(
    value?.pickupPoint || value?.pickup_point || value?.pickup || value?.parcel_shop || value?.service_point,
  );
  if (!code && !description && !occurredAt && !location && !pickupPoint) return null;
  return { code, description, occurredAt, location, pickupPoint };
}

function extractWebshipperSnapshot(webshipper: any): TrackingSnapshot | null {
  if (!webshipper || typeof webshipper !== "object") return null;
  const statusText = normalizeStatusText(
    asString(webshipper?.status || webshipper?.status_text || webshipper?.last_event?.description || ""),
  );
  const statusCodeRaw = asString(webshipper?.status_code || webshipper?.status);
  const events = Array.isArray(webshipper?.events)
    ? webshipper.events.map((event: any) => toNormalizedEvent(event)).filter(Boolean) as NormalizedTrackingEvent[]
    : [];
  const lastEvent = events.length ? events[events.length - 1] : toNormalizedEvent(webshipper?.last_event);

  const deliveredAt = normalizeIso(webshipper?.delivered_at || webshipper?.deliveredAt);
  const outForDeliveryAt = normalizeIso(
    webshipper?.out_for_delivery_at || webshipper?.outForDeliveryAt,
  );
  const pickupReadyAt = normalizeIso(webshipper?.pickup_ready_at || webshipper?.pickupReadyAt);
  const pickupPoint = normalizePickupPoint(webshipper?.pickup_point);

  let statusCode = statusCodeRaw || "";
  if (!statusCode && deliveredAt) statusCode = "delivered";
  if (!statusCode && outForDeliveryAt) statusCode = "out_for_delivery";
  if (!statusCode && pickupReadyAt) statusCode = "pickup_ready";
  if (!statusCode && lastEvent?.code) statusCode = String(lastEvent.code);
  if (!statusCode && statusText) statusCode = buildSnapshotFromStatusText(statusText).statusCode || "";

  return {
    statusCode: statusCode || null,
    statusText,
    deliveredAt,
    outForDeliveryAt,
    pickupReadyAt,
    pickupPoint: pickupPoint || lastEvent?.pickupPoint || null,
    lastEvent: lastEvent || null,
    events,
  };
}

function detectCarrier(input: {
  company?: string | null;
  trackingUrl?: string | null;
  trackingNumber?: string | null;
}): CarrierCode {
  const company = asString(input.company).toLowerCase();
  const trackingUrl = asString(input.trackingUrl).toLowerCase();
  const trackingNumber = asString(input.trackingNumber).toLowerCase();

  if (
    company.includes("postnord") ||
    trackingUrl.includes("postnord") ||
    trackingNumber.startsWith("00")
  ) {
    return "postnord";
  }
  if (company.includes("gls") || trackingUrl.includes("gls")) {
    return "gls";
  }
  if (company.includes("dao") || trackingUrl.includes("dao")) {
    return "dao";
  }
  if (company.includes("bring") || trackingUrl.includes("bring")) {
    return "bring";
  }
  if (company.includes("dhl") || trackingUrl.includes("dhl")) {
    return "dhl";
  }
  if (company.includes("ups") || trackingUrl.includes("ups")) {
    return "ups";
  }
  return "unknown";
}

function normalizePreferredCarriers(value?: string[]): CarrierCode[] {
  if (!Array.isArray(value)) return [];
  const allowed: CarrierCode[] = ["postnord", "gls", "dao", "bring", "dhl", "ups"];
  const seen = new Set<CarrierCode>();
  const normalized: CarrierCode[] = [];
  for (const entry of value) {
    const carrier = asString(entry).toLowerCase() as CarrierCode;
    if (!allowed.includes(carrier) || seen.has(carrier)) continue;
    seen.add(carrier);
    normalized.push(carrier);
  }
  return normalized;
}

function buildShopifyFallbackTracking(
  candidate: {
    company: string;
    trackingNumber: string;
    trackingUrl: string;
    source?: "shopify" | "webshipper";
  },
  carrierLabel?: string,
): TrackingDetail {
  return {
    carrier: carrierLabel || candidate.company || "Carrier",
    statusText: "Shipped - follow the parcel via tracking link.",
    trackingNumber: candidate.trackingNumber,
    trackingUrl: candidate.trackingUrl,
    source: candidate.source || "shopify",
    lookupSource: "shopify_fallback",
    lookupDetail: "generic_fallback",
    snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
  };
}

function normalizeStatusText(raw: string): string {
  const lower = String(raw || "").toLowerCase();
  if (!lower) return "Shipped - follow the parcel via tracking link.";
  if (lower.includes("out for delivery") || lower.includes("ude til levering")) {
    return "Out for delivery today.";
  }
  if (lower.includes("delivered") || lower.includes("leveret")) {
    return raw || "Delivered.";
  }
  if (lower.includes("transit") || lower.includes("på vej") || lower.includes("under transport")) {
    return "In transit.";
  }
  return raw;
}

function toCarrierLabel(carrier: CarrierCode | string): string {
  const value = String(carrier || "").toLowerCase();
  if (value === "gls") return "GLS";
  if (value === "dao") return "DAO";
  if (value === "dhl") return "DHL";
  if (value === "ups") return "UPS";
  if (value === "postnord") return "PostNord";
  if (value === "bring") return "Bring";
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Carrier";
}

function buildCarrierRequestUrl(
  baseUrl: string,
  trackingNumber: string,
  queryParam: string,
): string | null {
  const raw = asString(baseUrl);
  if (!raw) return null;
  try {
    const withTemplate = raw.includes("{tracking_number}")
      ? raw.replaceAll("{tracking_number}", encodeURIComponent(trackingNumber))
      : raw;
    const parsed = new URL(withTemplate);
    if (!raw.includes("{tracking_number}")) {
      parsed.searchParams.set(queryParam || "trackingNumber", trackingNumber);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildCarrierFallback(
  carrier: CarrierCode | string,
  trackingNumber: string,
  trackingUrl: string,
  detail: string,
): TrackingDetail {
  return {
    carrier: toCarrierLabel(carrier),
    statusText: "Shipped - follow the parcel via tracking link.",
    trackingNumber,
    trackingUrl,
    snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
    lookupSource: "shopify_fallback",
    lookupDetail: detail,
  };
}

function extractCarrierEventsFromPayload(payload: any): NormalizedTrackingEvent[] {
  const candidateArrays = [
    payload?.events,
    payload?.history,
    payload?.trackingEvents,
    payload?.shipments?.[0]?.events,
    payload?.shipments?.[0]?.trackingEvents,
    payload?.trackResponse?.shipment?.[0]?.package?.[0]?.activity,
  ];
  const events: NormalizedTrackingEvent[] = [];
  for (const candidate of candidateArrays) {
    if (!Array.isArray(candidate)) continue;
    for (const event of candidate) {
      const normalized = toNormalizedEvent(event);
      if (normalized) events.push(normalized);
    }
  }
  return events;
}

function extractCarrierStatusFromPayload(payload: any, fallback = ""): string {
  const statusCandidates = [
    payload?.statusText,
    payload?.status,
    payload?.trackingStatus,
    payload?.shipment?.status,
    payload?.shipment?.statusText,
    payload?.shipments?.[0]?.status,
    payload?.shipments?.[0]?.statusText,
    payload?.trackResponse?.shipment?.[0]?.package?.[0]?.currentStatus?.description,
    payload?.trackResponse?.shipment?.[0]?.package?.[0]?.deliveryStatus?.description,
  ];
  for (const candidate of statusCandidates) {
    const text = extractText(candidate);
    if (text) return normalizeStatusText(text);
  }
  return normalizeStatusText(fallback || "Shipped - follow the parcel via tracking link.");
}

async function fetchCarrierViaApi(options: {
  carrier: CarrierCode;
  trackingNumber: string;
  trackingUrl: string;
  apiUrl: string;
  apiKey: string;
  authHeader: string;
  apiKeyPrefix: string;
  queryParam: string;
}): Promise<TrackingDetail> {
  const {
    carrier,
    trackingNumber,
    trackingUrl,
    apiUrl,
    apiKey,
    authHeader,
    apiKeyPrefix,
    queryParam,
  } = options;
  const carrierLabel = toCarrierLabel(carrier);
  if (!apiUrl || !apiKey) {
    return buildCarrierFallback(carrier, trackingNumber, trackingUrl, "api_config_missing");
  }
  const requestUrl = buildCarrierRequestUrl(apiUrl, trackingNumber, queryParam);
  if (!requestUrl) {
    return buildCarrierFallback(carrier, trackingNumber, trackingUrl, "api_url_invalid");
  }

  try {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        [authHeader || "Authorization"]: `${apiKeyPrefix || ""}${apiKey}`,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      return buildCarrierFallback(carrier, trackingNumber, trackingUrl, `api_failed:http_${response.status}`);
    }
    const events = extractCarrierEventsFromPayload(payload);
    const lastEvent = events.length ? events[events.length - 1] : null;
    const statusText = extractCarrierStatusFromPayload(payload, lastEvent?.description || "");
    const snapshot: TrackingSnapshot = {
      ...buildSnapshotFromStatusText(statusText),
      lastEvent,
      events,
      deliveredAt:
        String(buildSnapshotFromStatusText(statusText).statusCode || "") === "delivered"
          ? (lastEvent?.occurredAt || null)
          : null,
      outForDeliveryAt:
        String(buildSnapshotFromStatusText(statusText).statusCode || "") === "out_for_delivery"
          ? (lastEvent?.occurredAt || null)
          : null,
    };
    return {
      carrier: carrierLabel,
      statusText,
      trackingNumber,
      trackingUrl,
      lastEventAt: lastEvent?.occurredAt || null,
      snapshot,
      lookupSource: `${carrier}_api`,
      lookupDetail: "ok",
    };
  } catch {
    return buildCarrierFallback(carrier, trackingNumber, trackingUrl, "api_failed:request_error");
  }
}

function extractPostNordEvents(payload: any): NormalizedTrackingEvent[] {
  const root = payload?.TrackingInformationResponse || payload || {};
  const shipments = Array.isArray(root?.shipments) ? root.shipments : [];
  const events: NormalizedTrackingEvent[] = [];

  for (const shipment of shipments) {
    const shipmentEvents = Array.isArray(shipment?.events) ? shipment.events : [];
    for (const event of shipmentEvents) {
      const normalized = toNormalizedEvent(event);
      if (normalized) events.push(normalized);
    }

    const items = Array.isArray(shipment?.items) ? shipment.items : [];
    for (const item of items) {
      const itemEvents = Array.isArray(item?.events) ? item.events : [];
      for (const event of itemEvents) {
        const normalized = toNormalizedEvent(event);
        if (normalized) events.push(normalized);
      }
    }
  }

  const dated = events
    .map((event) => ({
      event,
      ts: event.occurredAt ? Date.parse(event.occurredAt) : Number.NaN,
    }))
    .sort((a, b) => {
      const aValid = Number.isFinite(a.ts);
      const bValid = Number.isFinite(b.ts);
      if (aValid && bValid) return a.ts - b.ts;
      if (aValid) return 1;
      if (bValid) return -1;
      return 0;
    })
    .map((entry) => entry.event);

  return dated;
}

function extractPostNordStatusText(payload: any, latestEvent: NormalizedTrackingEvent | null): string {
  const root = payload?.TrackingInformationResponse || payload || {};
  const shipments = Array.isArray(root?.shipments) ? root.shipments : [];
  const firstShipment = shipments[0] || null;
  const firstItem = Array.isArray(firstShipment?.items) ? firstShipment.items[0] || null : null;
  const raw =
    asString(latestEvent?.description || "") ||
    asString(firstItem?.statusText || firstItem?.status || "") ||
    asString(firstShipment?.statusText || firstShipment?.status || "") ||
    "Shipped - follow the parcel via tracking link.";
  return normalizeStatusText(raw);
}

function extractPostNordExpectedDelivery(payload: any): string | null {
  const root = payload?.TrackingInformationResponse || payload || {};
  const shipments = Array.isArray(root?.shipments) ? root.shipments : [];
  const firstShipment = shipments[0] || null;
  const firstItem = Array.isArray(firstShipment?.items) ? firstShipment.items[0] || null : null;
  return (
    normalizeIso(
      firstItem?.expectedDeliveryTime ||
        firstItem?.estimatedDeliveryTime ||
        firstItem?.expectedDeliveryDate ||
        firstItem?.estimatedDeliveryDate ||
        firstShipment?.expectedDeliveryTime ||
        firstShipment?.estimatedDeliveryTime ||
        firstShipment?.expectedDeliveryDate ||
        firstShipment?.estimatedDeliveryDate,
    ) || null
  );
}

function extractPostNordDeliveryCity(payload: any): string | null {
  const root = payload?.TrackingInformationResponse || payload || {};
  const shipments = Array.isArray(root?.shipments) ? root.shipments : [];
  const firstShipment = shipments[0] || null;
  const firstItem = Array.isArray(firstShipment?.items) ? firstShipment.items[0] || null : null;

  // Try every known PostNord field name for recipient/delivery address
  const addr =
    firstItem?.deliveryAddress ||
    firstItem?.recipientAddress ||
    firstItem?.toAddress ||
    firstItem?.addressTo ||
    firstItem?.consigneeAddress ||
    firstItem?.dropOffAddress ||
    firstItem?.receiver?.address ||
    firstShipment?.deliveryAddress ||
    firstShipment?.recipientAddress ||
    firstShipment?.toAddress ||
    firstShipment?.addressTo ||
    firstShipment?.consignee?.address ||
    firstShipment?.receiver?.address ||
    root?.deliveryAddress ||
    root?.recipientAddress ||
    null;

  if (addr && typeof addr === "object") {
    const postalCode = asString(
      addr?.postalCode || addr?.postal_code || addr?.zip || addr?.zipCode || addr?.postCode || ""
    );
    const city = asString(
      addr?.city || addr?.cityName || addr?.town || addr?.municipality || ""
    );
    if (postalCode && city) return `${postalCode} ${city}`;
    if (city) return city;
    if (postalCode) return postalCode;
  }

  // Fallback: check if any event location looks like a postal code + city (e.g. "1620 KØBENHAVN V")
  // PostNord sometimes puts recipient info in the last delivery event's location
  const events = Array.isArray(firstItem?.events) ? firstItem.events :
    Array.isArray(firstShipment?.events) ? firstShipment.events : [];
  for (const event of events) {
    const loc = asString(event?.location || event?.city || "");
    if (/^\d{4}\s+\w/.test(loc)) return loc; // Matches "1620 KØBENHAVN V" pattern
  }

  return null;
}

function extractPostNordStatusCode(payload: any, statusText: string): string | null {
  const root = payload?.TrackingInformationResponse || payload || {};
  const shipments = Array.isArray(root?.shipments) ? root.shipments : [];
  const firstShipment = shipments[0] || null;
  const firstItem = Array.isArray(firstShipment?.items) ? firstShipment.items[0] || null : null;
  const rawCode = extractText(
    firstItem?.statusCode || firstItem?.status || firstShipment?.statusCode || firstShipment?.status,
  ).toLowerCase();

  if (rawCode.includes("delivered")) return "delivered";
  if (rawCode.includes("out_for_delivery") || rawCode.includes("out for delivery")) {
    return "out_for_delivery";
  }
  if (rawCode.includes("pickup") || rawCode.includes("collect")) return "pickup_ready";
  if (rawCode.includes("delay") || rawCode.includes("exception")) return "exception";
  return buildSnapshotFromStatusText(statusText).statusCode || null;
}

function mapGlsStatusToInternal(status: string): string {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "DELIVEREDPS") return "pickup_ready";
  if (["DELIVERED", "FINAL"].includes(normalized)) return "delivered";
  if (normalized === "INDELIVERY") return "out_for_delivery";
  if (normalized === "INWAREHOUSE") return "pickup_ready";
  if (normalized === "NOTDELIVERED" || normalized === "CANCELED") return "exception";
  return "in_transit";
}

function mapGlsCarrierStatusToText(status: string): string {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "DELIVEREDPS") return "Delivered to parcel shop.";
  if (normalized === "DELIVERED" || normalized === "FINAL") return "Delivered.";
  if (normalized === "INDELIVERY") return "Out for delivery today.";
  if (normalized === "INTRANSIT") return "In transit.";
  if (normalized === "PREADVICE") return "Shipment data received by carrier.";
  if (normalized === "NOTDELIVERED") return "Delivery attempt was not successful.";
  if (normalized === "INWAREHOUSE") return "Ready for pickup.";
  if (normalized === "CANCELED") return "Shipment was canceled.";
  return "Shipped - follow the parcel via tracking link.";
}

function mapGlsSnapshotToTrackingDetail(
  snapshot: GlsProviderSnapshot,
  fallbackUrl: string,
): TrackingDetail {
  const latest = snapshot.latestEvent;
  const events = Array.isArray(snapshot.events)
    ? snapshot.events.map((event) => ({
      code: String(event?.code || "").trim() || null,
      description: String(event?.description || "").trim() || null,
      occurredAt: normalizeIso(event?.eventDateTime) || null,
      location:
        [event?.postalCode, event?.city, event?.country]
          .map((part) => String(part || "").trim())
          .filter(Boolean)
          .join(" ") || null,
    })).filter((event) => event.code || event.description || event.occurredAt || event.location)
    : [];
  const newestEventFromList = [...events].sort((a, b) => {
    const aTs = a.occurredAt ? Date.parse(a.occurredAt) : Number.NaN;
    const bTs = b.occurredAt ? Date.parse(b.occurredAt) : Number.NaN;
    const aValid = Number.isFinite(aTs);
    const bValid = Number.isFinite(bTs);
    if (aValid && bValid) return bTs - aTs;
    if (aValid) return -1;
    if (bValid) return 1;
    return 0;
  })[0] || null;
  const normalizedLatestFromSnapshot =
    latest && (String(latest.code || "").trim() || String(latest.description || "").trim() || String(latest.eventDateTime || "").trim())
      ? {
        code: String(latest.code || "").trim() || null,
        description: String(latest.description || "").trim() || null,
        occurredAt: normalizeIso(latest.eventDateTime) || null,
        location:
          [latest.postalCode, latest.city, latest.country]
            .map((part) => String(part || "").trim())
            .filter(Boolean)
            .join(" ") || null,
      }
      : null;
  const lastEvent = normalizedLatestFromSnapshot || newestEventFromList;
  const statusText =
    normalizeStatusText(
      (() => {
        const eventDescription = String(lastEvent?.description || "").trim();
        if (eventDescription && eventDescription.toLowerCase() !== "tracking event") {
          return eventDescription;
        }
        return mapGlsCarrierStatusToText(snapshot.status);
      })() ||
        "Shipped - follow the parcel via tracking link.",
    );
  const statusCode = mapGlsStatusToInternal(snapshot.status);

  return {
    carrier: "GLS",
    statusText,
    trackingNumber: snapshot.trackingNumber,
    trackingUrl: fallbackUrl,
    carrierStatus: snapshot.status,
    deliveredToParcelShop: Boolean(snapshot.deliveredToParcelShop),
    lastEventAt: normalizeIso(snapshot.statusDateTime) || lastEvent?.occurredAt || null,
    lookupSource: "gls_api",
    lookupDetail: "ok",
    snapshot: {
      statusCode,
      statusText,
      deliveredAt: statusCode === "delivered" ? (normalizeIso(snapshot.statusDateTime) || null) : null,
      outForDeliveryAt:
        statusCode === "out_for_delivery" ? (normalizeIso(snapshot.statusDateTime) || null) : null,
      pickupReadyAt: statusCode === "pickup_ready" ? (normalizeIso(snapshot.statusDateTime) || null) : null,
      pickupPoint: snapshot.parcelShop
        ? {
          name: snapshot.parcelShop.name || null,
          address: snapshot.parcelShop.addressLine || null,
          city: snapshot.parcelShop.city || null,
          postalCode: snapshot.parcelShop.postalCode || null,
          country: snapshot.parcelShop.country || null,
        }
        : null,
      lastEvent,
      events,
    },
  };
}

async function fetchGLSStatus(
  trackingNumber: string,
  fallbackUrl?: string | null,
): Promise<TrackingDetail | null> {
  const publicUrl =
    asString(fallbackUrl) || `https://gls-group.eu/EU/en/parcel-tracking?match=${trackingNumber}`;

  try {
    const providerSnapshot = await getGlsTrackingSnapshot(trackingNumber);
    return mapGlsSnapshotToTrackingDetail(providerSnapshot, publicUrl);
  } catch {
    // Fallback to public GLS endpoint below.
  }

  const url = `${GLS_TRACKING_ENDPOINT}${encodeURIComponent(trackingNumber)}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      return {
        carrier: "GLS",
        statusText: "Shipped - follow the parcel via tracking link.",
        trackingNumber,
        trackingUrl: publicUrl,
        lookupSource: "shopify_fallback",
        lookupDetail: `api_failed:http_${response.status}`,
        snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
      };
    }

    const historyCandidates =
      payload?.tuStatus?.history ??
      payload?.history ??
      payload?.events ??
      payload?.tuStatus?.statusHistory ??
      [];
    const events: TrackingEvent[] = Array.isArray(historyCandidates) ? historyCandidates : [];
    const latest = events[events.length - 1] ?? payload?.tuStatus ?? null;

    const baseStatus =
      latest?.statusDescription ??
      latest?.statusText ??
      latest?.description ??
      payload?.tuStatus?.statusDescription ??
      "Status ikke tilgængelig";
    const timestampRaw = latest?.dateTime ?? latest?.date ?? latest?.eventTime ?? null;
    const timestamp = formatTimestamp(timestampRaw);

    return {
      carrier: "GLS",
      statusText: timestamp ? `${baseStatus} (${timestamp})` : String(baseStatus),
      trackingNumber,
      trackingUrl: publicUrl,
      lastEventAt: timestamp ?? null,
      lookupSource: "gls_public_api",
      lookupDetail: "ok",
      snapshot: buildSnapshotFromStatusText(timestamp ? `${baseStatus} (${timestamp})` : String(baseStatus)),
    };
  } catch {
    return {
      carrier: "GLS",
      statusText: "Shipped - follow the parcel via tracking link.",
      trackingNumber,
      trackingUrl: publicUrl,
      lookupSource: "shopify_fallback",
      lookupDetail: "api_failed:request_error",
      snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
    };
  }
}

function htmlToText(input: string): string {
  return String(input || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchPostNordStatus(
  trackingNumber: string,
  trackingUrl?: string | null,
): Promise<TrackingDetail> {
  const url = asString(trackingUrl) || `https://www.postnord.dk/track-trace?shipmentId=${trackingNumber}`;
  let postNordApiIssue = POSTNORD_API_KEY ? null : "api_key_missing";

  if (POSTNORD_API_KEY) {
    try {
      const apiUrl = new URL(POSTNORD_TRACKING_API_URL);
      apiUrl.searchParams.set("id", trackingNumber);
      apiUrl.searchParams.set("apikey", POSTNORD_API_KEY);
      apiUrl.searchParams.set("locale", POSTNORD_TRACKING_LOCALE);
      apiUrl.searchParams.set("returnType", "json");

      const response = await fetch(apiUrl.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload) {
        const events = extractPostNordEvents(payload);
        const lastEvent = events.length ? events[events.length - 1] : null;
        const statusText = extractPostNordStatusText(payload, lastEvent);
        const expectedDeliveryAt = extractPostNordExpectedDelivery(payload);
        const statusCode = extractPostNordStatusCode(payload, statusText);
        const deliveredAt = statusCode === "delivered" ? (lastEvent?.occurredAt || null) : null;
        const outForDeliveryAt =
          statusCode === "out_for_delivery" ? (lastEvent?.occurredAt || expectedDeliveryAt || null) : null;
        const deliveryCity = extractPostNordDeliveryCity(payload);
        const snapshot: TrackingSnapshot = {
          ...buildSnapshotFromStatusText(statusText),
          statusCode,
          deliveredAt,
          outForDeliveryAt,
          expectedDeliveryAt,
          lastEvent,
          events,
          deliveryCity,
        };

        return {
          carrier: "PostNord",
          statusText,
          trackingNumber,
          trackingUrl: url,
          lastEventAt: lastEvent?.occurredAt || null,
          snapshot,
          lookupSource: "postnord_api",
          lookupDetail: "ok",
        };
      }
      postNordApiIssue = response.ok ? "empty_payload" : `http_${response.status}`;
    } catch {
      postNordApiIssue = "request_error";
      // Fallback to public tracking page parser below.
    }
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const raw = await response.text().catch(() => "");
    const text = htmlToText(raw).toLowerCase();

    // Best-effort parse af PostNord offentlige track side.
    const deliveredMatch = text.match(/blev leveret[^.]{0,120}/i);
    if (deliveredMatch?.[0]) {
      const statusText = deliveredMatch[0].replace(/\s+/g, " ").trim();
      return {
        carrier: "PostNord",
        statusText: statusText.charAt(0).toUpperCase() + statusText.slice(1),
        trackingNumber,
        trackingUrl: url,
        lookupSource: "postnord_public_page",
        lookupDetail: postNordApiIssue ? `api_failed:${postNordApiIssue}` : "public_page_parse",
      };
    }

    if (text.includes("ude til levering")) {
      return {
        carrier: "PostNord",
        statusText: "Pakken er ude til levering.",
        trackingNumber,
        trackingUrl: url,
        lookupSource: "postnord_public_page",
        lookupDetail: postNordApiIssue ? `api_failed:${postNordApiIssue}` : "public_page_parse",
      };
    }

    if (text.includes("leveret")) {
      return {
        carrier: "PostNord",
        statusText: "Pakken er leveret.",
        trackingNumber,
        trackingUrl: url,
        lookupSource: "postnord_public_page",
        lookupDetail: postNordApiIssue ? `api_failed:${postNordApiIssue}` : "public_page_parse",
      };
    }

    if (text.includes("under transport") || text.includes("på vej")) {
      return {
        carrier: "PostNord",
        statusText: "Pakken er på vej.",
        trackingNumber,
        trackingUrl: url,
        lookupSource: "postnord_public_page",
        lookupDetail: postNordApiIssue ? `api_failed:${postNordApiIssue}` : "public_page_parse",
      };
    }
  } catch {
    // Ignore and fall back.
  }

  return {
    carrier: "PostNord",
    statusText: "Shipped - follow the parcel via tracking link.",
    trackingNumber,
    trackingUrl: url,
    lookupSource: "shopify_fallback",
    lookupDetail: postNordApiIssue ? `api_failed:${postNordApiIssue}` : "public_page_no_match",
    snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
  };
}

async function fetchDaoStatus(
  trackingNumber: string,
  trackingUrl?: string | null,
): Promise<TrackingDetail> {
  const publicUrl = asString(trackingUrl) || `https://www.dao.as/track-and-trace/?id=${trackingNumber}`;
  return await fetchCarrierViaApi({
    carrier: "dao",
    trackingNumber,
    trackingUrl: publicUrl,
    apiUrl: DAO_TRACKING_API_URL,
    apiKey: DAO_API_KEY,
    authHeader: DAO_API_AUTH_HEADER,
    apiKeyPrefix: DAO_API_KEY_PREFIX,
    queryParam: DAO_TRACKING_QUERY_PARAM,
  });
}

async function fetchBringStatus(
  trackingNumber: string,
  trackingUrl?: string | null,
): Promise<TrackingDetail> {
  const publicUrl = asString(trackingUrl) || `https://sporing.bring.no/sporing/${trackingNumber}`;
  if (!BRING_API_UID || !BRING_API_KEY) {
    return {
      carrier: "Bring",
      statusText: "Shipped - follow the parcel via tracking link.",
      trackingNumber,
      trackingUrl: publicUrl,
      lookupSource: "shopify_fallback",
      lookupDetail: "api_config_missing",
      snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
    };
  }

  try {
    const response = await fetch(
      `${BRING_TRACKING_API_URL}?q=${encodeURIComponent(trackingNumber)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Mybring-API-Uid": BRING_API_UID,
          "X-Mybring-API-Key": BRING_API_KEY,
        },
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      return {
        carrier: "Bring",
        statusText: "Shipped - follow the parcel via tracking link.",
        trackingNumber,
        trackingUrl: publicUrl,
        lookupSource: "shopify_fallback",
        lookupDetail: `api_failed:http_${response.status}`,
        snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
      };
    }

    const event =
      payload?.consignments?.[0]?.packageSet?.[0]?.packages?.[0]?.eventSet?.[0] ||
      payload?.consignments?.[0]?.events?.[0] ||
      null;
    const description = asString(
      event?.description || event?.status || payload?.consignments?.[0]?.statusDescription || "",
    );
    const statusText = normalizeStatusText(description || "Shipped - follow the parcel via tracking link.");

    return {
      carrier: "Bring",
      statusText,
      trackingNumber,
      trackingUrl: publicUrl,
      lookupSource: "bring_api",
      lookupDetail: "ok",
      snapshot: buildSnapshotFromStatusText(statusText),
    };
  } catch {
    return {
      carrier: "Bring",
      statusText: "Shipped - follow the parcel via tracking link.",
      trackingNumber,
      trackingUrl: publicUrl,
      lookupSource: "shopify_fallback",
      lookupDetail: "api_failed:request_error",
      snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
    };
  }
}

async function fetchDhlStatus(
  trackingNumber: string,
  trackingUrl?: string | null,
): Promise<TrackingDetail> {
  const publicUrl = asString(trackingUrl) || `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${trackingNumber}`;
  return await fetchCarrierViaApi({
    carrier: "dhl",
    trackingNumber,
    trackingUrl: publicUrl,
    apiUrl: DHL_TRACKING_API_URL,
    apiKey: DHL_API_KEY,
    authHeader: DHL_API_AUTH_HEADER,
    apiKeyPrefix: DHL_API_KEY_PREFIX,
    queryParam: DHL_TRACKING_QUERY_PARAM,
  });
}

async function fetchUpsStatus(
  trackingNumber: string,
  trackingUrl?: string | null,
): Promise<TrackingDetail> {
  const publicUrl = asString(trackingUrl) || `https://www.ups.com/track?tracknum=${trackingNumber}`;
  return await fetchCarrierViaApi({
    carrier: "ups",
    trackingNumber,
    trackingUrl: publicUrl,
    apiUrl: UPS_TRACKING_API_URL,
    apiKey: UPS_API_KEY,
    authHeader: UPS_API_AUTH_HEADER,
    apiKeyPrefix: UPS_API_KEY_PREFIX,
    queryParam: UPS_TRACKING_QUERY_PARAM,
  });
}

function collectTrackingCandidates(order: any) {
  const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
  const candidates: Array<{
    company: string;
    trackingNumber: string;
    trackingUrl: string;
    source?: "shopify" | "webshipper";
    statusText?: string;
    snapshot?: TrackingSnapshot | null;
  }> = [];

  const webshipper = order?.webshipper_tracking;
  if (webshipper && typeof webshipper === "object") {
    const wsNumber = asString(webshipper?.tracking_number);
    const wsUrl = asString(webshipper?.tracking_url);
    const wsCarrier = asString(webshipper?.carrier) || "webshipper";
    const wsStatus = asString(webshipper?.status);
    if (wsNumber || wsUrl) {
      candidates.push({
        company: wsCarrier,
        trackingNumber: wsNumber || extractTrackingNumberFromUrl(wsUrl) || "",
        trackingUrl: wsUrl,
        source: "webshipper",
        statusText: wsStatus || "",
        snapshot: TRACKING_EVENTS_ENABLED ? extractWebshipperSnapshot(webshipper) : null,
      });
    }
  }

  for (const fulfillment of fulfillments) {
    const company = asString(fulfillment?.tracking_company);
    const trackingNumber =
      asString(fulfillment?.tracking_number) ||
      (Array.isArray(fulfillment?.tracking_numbers)
        ? asString(fulfillment.tracking_numbers.find((entry: unknown) => asString(entry)))
        : "");
    const urls = Array.isArray(fulfillment?.tracking_urls)
      ? fulfillment.tracking_urls
      : fulfillment?.tracking_url
      ? [fulfillment.tracking_url]
      : [];
    const trackingUrl =
      asString(urls.find((entry: unknown) => asString(entry))) ||
      asString(fulfillment?.tracking_url);
    const resolvedNumber = trackingNumber || extractTrackingNumberFromUrl(trackingUrl) || "";
    if (!resolvedNumber) continue;
    candidates.push({
      company,
      trackingNumber: resolvedNumber,
      trackingUrl,
      source: "shopify",
      statusText: "",
    });
  }

  return candidates;
}

export async function fetchTrackingDetailsForOrders(
  orders: any[],
  options?: { preferredCarriers?: string[] },
): Promise<Record<string, TrackingDetail>> {
  if (!Array.isArray(orders) || orders.length === 0) return {};
  const details: Record<string, TrackingDetail> = {};
  const preferredCarriers = normalizePreferredCarriers(options?.preferredCarriers);
  const hasCarrierPreference = preferredCarriers.length > 0;

  for (const order of orders) {
    const key = pickOrderKey(order);
    if (!key) continue;
    const candidates = collectTrackingCandidates(order);
    if (!candidates.length) continue;

    const candidate = candidates[0];
    const carrier = detectCarrier({
      company: candidate.company,
      trackingUrl: candidate.trackingUrl,
      trackingNumber: candidate.trackingNumber,
    });
    const carrierAllowed = !hasCarrierPreference || preferredCarriers.includes(carrier);

    let detail: TrackingDetail;
    if (candidate.source === "webshipper" && (candidate.statusText || candidate.snapshot)) {
      const snapshotFromSource = candidate.snapshot || null;
      const resolvedStatusText =
        normalizeStatusText(candidate.statusText || snapshotFromSource?.statusText || "");
      detail = {
        carrier: candidate.company || "Webshipper",
        statusText: resolvedStatusText,
        trackingNumber: candidate.trackingNumber,
        trackingUrl: candidate.trackingUrl,
        source: "webshipper",
        lookupSource: "webshipper_tracking",
        lookupDetail: "ok",
        snapshot:
          TRACKING_EVENTS_ENABLED && snapshotFromSource
            ? snapshotFromSource
            : buildSnapshotFromStatusText(resolvedStatusText),
      };
      details[key] = detail;
      continue;
    }

    if (!carrierAllowed) {
      detail = buildShopifyFallbackTracking(candidate, candidate.company || "Carrier");
      detail.lookupDetail = "carrier_not_selected";
    } else if (carrier === "gls") {
      detail = (await fetchGLSStatus(candidate.trackingNumber, candidate.trackingUrl)) ?? {
        carrier: "GLS",
        statusText: "Shipped - follow the parcel via tracking link.",
        trackingNumber: candidate.trackingNumber,
        trackingUrl: candidate.trackingUrl,
      };
      detail.source = candidate.source || "shopify";
    } else if (carrier === "postnord") {
      detail = await fetchPostNordStatus(candidate.trackingNumber, candidate.trackingUrl);
      detail.source = candidate.source || "shopify";
    } else if (carrier === "dao") {
      detail = await fetchDaoStatus(candidate.trackingNumber, candidate.trackingUrl);
      detail.source = candidate.source || "shopify";
    } else if (carrier === "bring") {
      detail = await fetchBringStatus(candidate.trackingNumber, candidate.trackingUrl);
      detail.source = candidate.source || "shopify";
    } else if (carrier === "dhl") {
      detail = await fetchDhlStatus(candidate.trackingNumber, candidate.trackingUrl);
      detail.source = candidate.source || "shopify";
    } else if (carrier === "ups") {
      detail = await fetchUpsStatus(candidate.trackingNumber, candidate.trackingUrl);
      detail.source = candidate.source || "shopify";
    } else {
      detail = buildShopifyFallbackTracking(candidate, candidate.company || "Carrier");
      detail.lookupDetail = "carrier_unknown";
    }

    details[key] = detail;
  }

  return details;
}

export async function fetchTrackingSummariesForOrders(
  orders: any[],
): Promise<Record<string, string>> {
  const details = await fetchTrackingDetailsForOrders(orders);
  const summaries: Record<string, string> = {};
  for (const [key, detail] of Object.entries(details)) {
    summaries[key] = `${detail.carrier} tracking (${detail.trackingNumber}): ${detail.statusText} — Link: ${detail.trackingUrl}`;
  }
  return summaries;
}
