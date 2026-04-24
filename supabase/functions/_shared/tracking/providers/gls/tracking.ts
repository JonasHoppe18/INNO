import { getGlsAccessToken } from "./auth.ts";

const GLS_TRACKING_URL_BASE =
  "https://api.gls-group.net/track-and-trace-v1/tracking/simple/trackids";
const GLS_DELIVERY_INFO_URL_BASE =
  "https://api.gls-group.net/track-and-trace-v1/tracking/deliveryinfo/parcelid";
const GLS_PARCELSHOP_V2_URL = (Deno.env.get("GLS_PARCELSHOP_V2_URL") ?? "").trim();

export type GlsStatus =
  | "PLANNEDPICKUP"
  | "INPICKUP"
  | "NOTPICKEDUP"
  | "PREADVICE"
  | "INTRANSIT"
  | "INDELIVERY"
  | "DELIVEREDPS"
  | "DELIVERED"
  | "INWAREHOUSE"
  | "NOTDELIVERED"
  | "CANCELED"
  | "FINAL"
  | "UNKNOWN";

export type GlsParcelShop = {
  id?: string | null;
  name?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  openingHours?: string | null;
  source: "delivery_info" | "parcelshop_v2" | "tracking_event";
} | null;

export type TrackingSnapshot = {
  carrier: "gls";
  trackingNumber: string;
  unitNo: string | null;
  status: GlsStatus;
  statusDateTime: string | null;
  deliveredToParcelShop: boolean;
  parcelShop: GlsParcelShop;
  latestEvent: {
    code: string;
    description: string;
    eventDateTime: string;
    country?: string | null;
    city?: string | null;
    postalCode?: string | null;
  } | null;
  events: Array<{
    code: string;
    description: string;
    eventDateTime: string;
    country?: string | null;
    city?: string | null;
    postalCode?: string | null;
  }>;
  raw: unknown;
};

type NormalizedEvent = TrackingSnapshot["events"][number];

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "PLANNEDPICKUP",
  "INPICKUP",
  "NOTPICKEDUP",
  "PREADVICE",
  "INTRANSIT",
  "INDELIVERY",
  "DELIVEREDPS",
  "DELIVERED",
  "INWAREHOUSE",
  "NOTDELIVERED",
  "CANCELED",
  "FINAL",
]);

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toIsoOrNull(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString();
}

function normalizeStatus(value: unknown): GlsStatus {
  const raw = asString(value).toUpperCase();
  if (!raw) return "UNKNOWN";
  return KNOWN_STATUSES.has(raw) ? (raw as GlsStatus) : "UNKNOWN";
}

function pickFirstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return "";
}

function extractPostalCity(value: unknown): { postalCode: string | null; city: string | null } {
  const raw = asString(value);
  if (!raw) return { postalCode: null, city: null };
  const normalized = raw.replace(/\s+/g, " ").trim();
  const match = normalized.match(/\b(\d{4,5})\s+(.+)$/);
  if (!match) return { postalCode: null, city: null };
  const postalCode = asString(match[1]) || null;
  const city = asString(match[2]) || null;
  return { postalCode, city };
}

function normalizeEvent(event: unknown): NormalizedEvent | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const code = pickFirstString(record, ["code", "eventCode", "status", "eventType", "scanCode"]);
  const description = pickFirstString(record, [
    "description",
    "eventDescription",
    "statusText",
    "message",
    "label",
  ]);
  const eventDateTime = toIsoOrNull(
    record.eventDateTime ?? record.dateTime ?? record.eventTime ?? record.timestamp ?? record.date,
  );
  if (!code && !description && !eventDateTime) return null;

  const rawLocation = pickFirstString(record, [
    "location",
    "locationName",
    "eventLocation",
    "locationText",
    "depot",
    "hub",
    "terminal",
  ]);
  const parsedPostalCity = extractPostalCity(rawLocation);
  const country = asString(record.country || record.countryCode || record.countryName) || null;
  const city =
    asString(record.city || record.locationCity || record.cityName || record.town || record.locationName) ||
    parsedPostalCity.city ||
    null;
  const postalCode =
    asString(record.postalCode || record.zipCode || record.zip || record.postCode) ||
    parsedPostalCity.postalCode ||
    null;

  return {
    code: code || "UNKNOWN",
    description: description || "Tracking event",
    eventDateTime: eventDateTime || "",
    country,
    city,
    postalCode,
  };
}

function parseParcelList(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.parcels)) return root.parcels as Array<Record<string, unknown>>;
  if (Array.isArray(root.items)) return root.items as Array<Record<string, unknown>>;
  if (Array.isArray(root.data)) return root.data as Array<Record<string, unknown>>;
  return [];
}

function pickLatestEvent(events: NormalizedEvent[]): NormalizedEvent | null {
  if (!events.length) return null;
  const sorted = [...events].sort((a, b) => {
    const ta = Date.parse(a.eventDateTime || "");
    const tb = Date.parse(b.eventDateTime || "");
    const aValid = Number.isFinite(ta);
    const bValid = Number.isFinite(tb);
    if (aValid && bValid) return tb - ta;
    if (aValid) return -1;
    if (bValid) return 1;
    return 0;
  });
  return sorted[0] || null;
}

function parseParcelShopFromTrackingEvents(events: NormalizedEvent[]): GlsParcelShop {
  const parcelShopEvent = events.find((event) =>
    String(event.code || "").toUpperCase().includes("PS") ||
    /parcel.?shop|pakkeshop/i.test(String(event.description || ""))
  );
  if (!parcelShopEvent) return null;
  return {
    id: null,
    name: null,
    addressLine: null,
    postalCode: parcelShopEvent.postalCode || null,
    city: parcelShopEvent.city || null,
    country: parcelShopEvent.country || null,
    openingHours: null,
    source: "tracking_event",
  };
}

function normalizeParcelShop(value: unknown, source: GlsParcelShop["source"]): GlsParcelShop {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const addressRecord =
    record.address && typeof record.address === "object"
      ? (record.address as Record<string, unknown>)
      : null;
  const name = pickFirstString(record, ["name", "shopName", "parcelShopName", "displayName", "parcelShop"]);
  const addressLine =
    pickFirstString(record, ["addressLine", "address", "street", "streetName", "streetAddress"]) ||
    (addressRecord
      ? pickFirstString(addressRecord, [
          "addressLine",
          "address1",
          "addressLine1",
          "street",
          "streetName",
          "streetAddress",
        ])
      : "");
  const postalCode =
    pickFirstString(record, ["postalCode", "zipCode", "zip", "postCode"]) ||
    (addressRecord ? pickFirstString(addressRecord, ["postalCode", "zipCode", "zip", "postCode"]) : "");
  const city =
    pickFirstString(record, ["city", "town", "cityName", "municipality"]) ||
    (addressRecord ? pickFirstString(addressRecord, ["city", "town", "cityName", "municipality"]) : "");
  const country =
    pickFirstString(record, ["country", "countryCode", "countryName"]) ||
    (addressRecord ? pickFirstString(addressRecord, ["country", "countryCode", "countryName"]) : "");
  const openingHours = pickFirstString(record, ["openingHours", "openHours", "hours", "openingTime"]);
  const id = pickFirstString(record, ["id", "shopId", "parcelShopId"]);

  if (!id && !name && !addressLine && !postalCode && !city && !country && !openingHours) return null;
  return {
    id: id || null,
    name: name || null,
    addressLine: addressLine || null,
    postalCode: postalCode || null,
    city: city || null,
    country: country || null,
    openingHours: openingHours || null,
    source,
  };
}

function isParcelShopStatus(status: GlsStatus): boolean {
  return status === "DELIVEREDPS" || status === "INWAREHOUSE";
}

function shouldFetchParcelShopInfo(status: GlsStatus, unitNo: string | null): boolean {
  return Boolean(unitNo) && isParcelShopStatus(status);
}

async function fetchDeliveryInfoParcelShop(unitNo: string): Promise<GlsParcelShop> {
  const token = await getGlsAccessToken();
  const response = await fetch(
    `${GLS_DELIVERY_INFO_URL_BASE}/${encodeURIComponent(unitNo)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) return null;
  if (typeof payload !== "object" || !payload) return null;
  const root = payload as Record<string, unknown>;
  return (
    normalizeParcelShop(root.parcelShop || root.parcelshop || root, "delivery_info") ||
    null
  );
}

async function fetchParcelShopV2Info(shopId: string): Promise<GlsParcelShop> {
  if (!GLS_PARCELSHOP_V2_URL) return null;
  try {
    const endpoint = GLS_PARCELSHOP_V2_URL.includes("{shop_id}")
      ? GLS_PARCELSHOP_V2_URL.replaceAll("{shop_id}", encodeURIComponent(shopId))
      : `${GLS_PARCELSHOP_V2_URL.replace(/\/$/, "")}/${encodeURIComponent(shopId)}`;
    const response = await fetch(endpoint, { method: "GET", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) return null;
    return normalizeParcelShop(payload, "parcelshop_v2");
  } catch {
    return null;
  }
}

export async function getGlsTrackingSnapshot(
  trackingNumber: string,
): Promise<TrackingSnapshot> {
  const normalizedTrackingNumber = asString(trackingNumber);
  if (!normalizedTrackingNumber) {
    throw new Error("trackingNumber is required.");
  }

  const token = await getGlsAccessToken();
  const response = await fetch(
    `${GLS_TRACKING_URL_BASE}/${encodeURIComponent(normalizedTrackingNumber)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object"
        ? JSON.stringify(payload)
        : `HTTP ${response.status}`;
    throw new Error(`GLS tracking request failed: ${detail}`);
  }

  const parcels = parseParcelList(payload);
  if (!parcels.length) {
    return {
      carrier: "gls",
      trackingNumber: normalizedTrackingNumber,
      unitNo: null,
      status: "UNKNOWN",
      statusDateTime: null,
      deliveredToParcelShop: false,
      parcelShop: null,
      latestEvent: null,
      events: [],
      raw: payload,
    };
  }

  const parcel = parcels[0];
  const rawEvents = Array.isArray(parcel.events)
    ? parcel.events
    : Array.isArray(parcel.history)
    ? parcel.history
    : Array.isArray(parcel.trackEvents)
    ? parcel.trackEvents
    : [];
  const events = rawEvents.map(normalizeEvent).filter(Boolean) as NormalizedEvent[];
  const latestEvent = pickLatestEvent(events);
  const status = normalizeStatus(
    parcel.status ||
      parcel.parcelStatus ||
      latestEvent?.code ||
      "",
  );
  const statusDateTime = toIsoOrNull(
    parcel.statusDateTime ||
      parcel.lastStatusDateTime ||
      latestEvent?.eventDateTime ||
      "",
  );
  const unitNo = asString(parcel.unitNo || parcel.unitno || parcel.unitNumber) || null;
  let parcelShop =
    normalizeParcelShop(parcel.parcelShop || parcel.parcelshop || null, "tracking_event") ||
    parseParcelShopFromTrackingEvents(events);

  if (shouldFetchParcelShopInfo(status, unitNo)) {
    const deliveryInfoShop = await fetchDeliveryInfoParcelShop(unitNo as string);
    if (deliveryInfoShop) {
      parcelShop = deliveryInfoShop;
    } else if (parcelShop?.id) {
      const v2Shop = await fetchParcelShopV2Info(parcelShop.id);
      if (v2Shop) parcelShop = v2Shop;
    }
  }

  return {
    carrier: "gls",
    trackingNumber: normalizedTrackingNumber,
    unitNo,
    status,
    statusDateTime,
    deliveredToParcelShop: isParcelShopStatus(status),
    parcelShop: parcelShop || null,
    latestEvent,
    events,
    raw: payload,
  };
}
