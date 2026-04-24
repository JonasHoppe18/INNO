const asString = (value) => (typeof value === "string" ? value.trim() : "");

function stripThreadMeta(value = "") {
  return String(value || "")
    .replace(/\|?\s*thread_id\s*[:=]\s*[a-z0-9-]+/gi, "")
    .replace(/\s*\|thread_id:[a-z0-9-]+\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseTrackingLogDetail(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      detail: "",
      action: null,
      trackingStatus: null,
      trackingCarrier: null,
      trackingNumber: null,
      trackingUrl: null,
      trackingSource: null,
      trackingLookupSource: null,
      trackingLookupDetail: null,
    };
  }

  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      const detail =
        asString(parsed?.detail) ||
        asString(parsed?.message) ||
        asString(parsed?.summary) ||
        asString(parsed?.text) ||
        asString(parsed?.action) ||
        asString(parsed?.error) ||
        asString(parsed?.reason) ||
        asString(parsed?.status);
      return {
        detail: stripThreadMeta(detail),
        action: asString(parsed?.action || parsed?.actionType) || null,
        trackingStatus: asString(parsed?.status || parsed?.tracking_status) || null,
        trackingCarrier: asString(parsed?.carrier) || null,
        trackingNumber: asString(parsed?.tracking_number || parsed?.trackingNumber) || null,
        trackingUrl: asString(parsed?.tracking_url || parsed?.trackingUrl) || null,
        trackingSource: asString(parsed?.source) || null,
        trackingLookupSource:
          asString(parsed?.lookup_source || parsed?.lookupSource) || null,
        trackingLookupDetail:
          asString(parsed?.lookup_detail || parsed?.lookupDetail) || null,
      };
    } catch {
      return {
        detail: stripThreadMeta(raw),
        action: null,
        trackingStatus: null,
        trackingCarrier: null,
        trackingNumber: null,
        trackingUrl: null,
        trackingSource: null,
        trackingLookupSource: null,
        trackingLookupDetail: null,
      };
    }
  }

  return {
    detail: stripThreadMeta(raw),
    action: null,
    trackingStatus: null,
    trackingCarrier: null,
    trackingNumber: null,
    trackingUrl: null,
    trackingSource: null,
    trackingLookupSource: null,
    trackingLookupDetail: null,
  };
}

export function normalizeTrackingStatusLabel(value = "") {
  const text = asString(value);
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower.includes("afsendt - følg pakken via tracking-link")) {
    return "Shipped - follow the parcel via tracking link";
  }
  if (lower === "afsendt") return "Shipped";
  return text;
}

function formatEventTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildTrackingEventFromLog(log) {
  const parsed = parseTrackingLogDetail(log?.step_detail);
  const step = String(log?.step_name || "").toLowerCase();
  const isTrackingLog =
    step === "carrier_tracking" ||
    step === "carrier tracking" ||
    parsed?.action === "fetch_tracking" ||
    Boolean(parsed?.trackingStatus) ||
    Boolean(parsed?.trackingCarrier) ||
    Boolean(parsed?.trackingNumber) ||
    Boolean(parsed?.trackingUrl);

  if (!isTrackingLog) return null;

  const title =
    normalizeTrackingStatusLabel(parsed?.trackingStatus) ||
    parsed?.detail ||
    "Tracking lookup completed";

  // Try to get rich data from snapshot if available (new log format)
  let snapshot = null;
  try {
    const raw = String(log?.step_detail || "").trim();
    if (raw.startsWith("{")) {
      const full = JSON.parse(raw);
      snapshot = full?.snapshot || null;
    }
  } catch { /* ignore */ }

  // Use actual event timestamp (deliveredAt, lastEvent, or occurredAt) — NOT log created_at
  const actualTimestamp =
    snapshot?.deliveredAt ||
    snapshot?.outForDeliveryAt ||
    snapshot?.pickupReadyAt ||
    snapshot?.lastEvent?.occurredAt ||
    null;

  const location = snapshot?.lastEvent?.location || snapshot?.pickupPoint?.city || null;

  const metaParts = [
    parsed?.trackingCarrier || "",
    location,
    formatEventTimestamp(actualTimestamp || log?.created_at),
  ].filter(Boolean);

  return {
    id: String(log?.id || `${step}-${log?.created_at || title}`),
    title,
    meta: metaParts.join(" • "),
    detail: "",
    timestamp: actualTimestamp || log?.created_at || null,
    isCurrent: step === "carrier_tracking" || step === "carrier tracking",
  };
}

const NOISE_EVENT_PATTERN = /\b(e-?mail|text message|sms|notification has been sent|besked.*sendt|notifikation|received a notification from your shipper|preparing an item for you|tracking information will be updated)\b/i;
const GENERIC_TRACKING_EVENT_PATTERN = /^tracking event$/i;
const COUNTRY_ONLY_LOCATION_PATTERN = /^[a-z]{2}$/i;

function mapGlsEventCodeToDescription(code = "") {
  const raw = String(code || "").trim().toUpperCase();
  if (!raw) return "";
  const compact = raw.replace(/[^A-Z]/g, "");

  if (raw.includes("DELIVD") && (raw.includes("PSAPP") || raw.includes("PARCELSHOP"))) {
    return "Delivered to parcel shop";
  }
  if (raw.includes("OUTDEL")) return "Out for delivery";
  if (raw.includes("INBOD") || raw.includes("INBOUD")) return "Arrived at distribution center";
  if (raw.includes("OUTBOD")) return "Departed from distribution center";
  if (raw.includes("INTIAL") && raw.includes("PREADVICE")) {
    return "Shipment data received by carrier";
  }
  if (raw.includes("INTIAL")) return "Shipment accepted by carrier";

  if (compact === "PREADVICE") return "Shipment data received by carrier";
  if (compact === "PLANNEDPICKUP") return "Pickup planned";
  if (compact === "INPICKUP") return "Picked up by carrier";
  if (compact === "NOTPICKEDUP") return "Pickup not completed";
  if (compact === "INTRANSIT") return "In transit";
  if (compact === "INDELIVERY") return "Out for delivery";
  if (compact === "DELIVEREDPS") return "Delivered to parcel shop";
  if (compact === "INWAREHOUSE") return "Ready for pickup";
  if (compact === "DELIVERED" || compact === "FINAL") return "Delivered";
  if (compact === "NOTDELIVERED") return "Delivery attempt failed";
  if (compact === "CANCELED") return "Shipment canceled";
  return "";
}

function resolveEventDescription(event, carrier = "") {
  const rawDescription = asString(event?.description || "");
  const rawCode = asString(event?.code || "");
  if (rawDescription && !GENERIC_TRACKING_EVENT_PATTERN.test(rawDescription)) {
    if (/gls/i.test(String(carrier || ""))) {
      const mappedFromDescription = mapGlsEventCodeToDescription(rawDescription);
      if (mappedFromDescription) return mappedFromDescription;
    }
    return normalizeEventDescription(rawDescription);
  }
  if (/gls/i.test(String(carrier || ""))) {
    const mapped = mapGlsEventCodeToDescription(rawCode);
    if (mapped) return mapped;
  }
  if (rawCode) {
    return normalizeEventDescription(
      rawCode
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
  }
  return "Tracking event";
}

function resolveEventLocation(raw = "") {
  const input = asString(raw);
  if (!input) return "";
  if (COUNTRY_ONLY_LOCATION_PATTERN.test(input)) return "";
  const normalized = normalizeLocationName(input);
  if (COUNTRY_ONLY_LOCATION_PATTERN.test(normalized)) return "";
  return normalized;
}

function buildPickupPointLocation(snapshot) {
  const point = snapshot?.pickupPoint || null;
  if (!point || typeof point !== "object") return "";
  const name = asString(point?.name);
  const address = asString(point?.address);
  const city = asString(point?.city);
  const postalCode = asString(point?.postalCode);
  const cityLine = [postalCode, city].filter(Boolean).join(" ").trim();
  return cityLine || address || name || "";
}

function normalizeLocationName(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Map known PostNord depot codes → readable city names
  const DEPOT_MAP = {
    "NORDSJÆLLAND PO": "Nordsjælland",
    "ST KBH 385 1": "København",
    "ST KBH 385": "København",
    "BRØNDBY TERMINAL": "Brøndby",
    "TAULOV TERMINAL": "Taulov",
    "AARHUS TERMINAL": "Aarhus",
    "AALBORG TERMINAL": "Aalborg",
    "ODENSE TERMINAL": "Odense",
    "ESBJERG TERMINAL": "Esbjerg",
    "VEJLE TERMINAL": "Vejle",
    "KOLDING TERMINAL": "Kolding",
    "RANDERS TERMINAL": "Randers",
    "HERNING TERMINAL": "Herning",
    "HORSENS TERMINAL": "Horsens",
    "SILKEBORG TERMINAL": "Silkeborg",
    "ROSKILDE TERMINAL": "Roskilde",
    "HELSINGØR TERMINAL": "Helsingør",
    "POSTNORD DANMARK": "",
  };
  const upper = s.toUpperCase();
  if (DEPOT_MAP[upper] !== undefined) return DEPOT_MAP[upper];
  // Generic cleanup: remove "TERMINAL", "PO", "PO " suffixes and title-case
  const cleaned = s
    .replace(/\bTERMINAL\b/gi, "")
    .replace(/\bP\.?O\.?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // Title case
  return cleaned.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function normalizeEventDescription(raw = "") {
  const s = String(raw || "").trim();
  const l = s.toLowerCase();
  if (/delivered/.test(l) && !/not delivered|attempt/.test(l)) return "Delivered";
  if (/in progress|out for delivery|ude til levering/.test(l)) return "Out for delivery";
  if (/arrived at the distribution|arrived at distribution/.test(l)) return "Arrived at distribution center";
  if (/under transportation|in transit|på vej/.test(l)) return "In transit";
  if (/dropped off by sender|handed over|afleveret af afsender/.test(l)) return "Dropped off by sender";
  if (/delayed/.test(l)) return "Delayed";
  if (/ready for pickup|klar til afhentning|delivered to parcel shop|deliveredps/.test(l)) return "Ready for pickup";
  if (/delivery attempt|not delivered/.test(l)) return "Delivery attempt failed";
  if (/customs/.test(l)) return "In customs";
  return s;
}

function buildSnapshotEvents(snapshot, carrier) {
  if (!snapshot || !Array.isArray(snapshot.events) || snapshot.events.length === 0) return [];
  const sorted = [...snapshot.events].sort((a, b) => {
    const aTs = a?.occurredAt ? Date.parse(a.occurredAt) : Number.NaN;
    const bTs = b?.occurredAt ? Date.parse(b.occurredAt) : Number.NaN;
    const aValid = Number.isFinite(aTs);
    const bValid = Number.isFinite(bTs);
    if (aValid && bValid) return bTs - aTs;
    if (aValid) return -1;
    if (bValid) return 1;
    return 0;
  });
  const filtered = sorted.filter((event) => {
    const description = asString(event?.description || event?.code || "");
    return !NOISE_EVENT_PATTERN.test(description);
  });

  return filtered.map((event, index) => {
    const description = resolveEventDescription(event, carrier);
    const rawLocation = asString(event?.location || "");
    // For the latest (delivered) event, prefer the recipient delivery city from snapshot over terminal name
    const rawDeliveryCity = snapshot?.deliveryCity || "";
    const deliveryCity = rawDeliveryCity
      ? rawDeliveryCity.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      : "";
    const pickupPointLocation =
      index === 0 && /delivered to parcel shop/i.test(description)
        ? buildPickupPointLocation(snapshot)
        : "";
    const location = index === 0 && deliveryCity
      ? deliveryCity
      : pickupPointLocation || resolveEventLocation(rawLocation);
    const ts = formatEventTimestamp(event?.occurredAt);
    // For the latest event: embed timestamp in title so it's immediately visible
    const title = index === 0 && ts
      ? `${description} · ${ts}`
      : description;
    // Meta: location only (carrier name is redundant — already in modal header)
    const metaParts = [location].filter(Boolean);
    return {
      id: `snapshot-event-${index}-${event?.occurredAt || index}`,
      title,
      meta: metaParts.join(" • "),
      detail: "",
      timestamp: event?.occurredAt || null,
      isCurrent: index === 0,
    };
  });
}


export function buildTrackingTimeline({ logs = [], order = null }) {
  // Find the NEWEST carrier_tracking log entry (there may be multiple after regenerations)
  const carrierLog = (Array.isArray(logs) ? logs : [])
    .filter((log) => String(log?.step_name || "").toLowerCase() === "carrier_tracking")
    .sort((a, b) => {
      const aTs = a?.created_at ? Date.parse(a.created_at) : 0;
      const bTs = b?.created_at ? Date.parse(b.created_at) : 0;
      return bTs - aTs;
    })[0] ?? null;
  if (carrierLog) {
    const raw = String(carrierLog?.step_detail || "").trim();
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw);
        const snapshot = parsed?.snapshot || null;
        const carrier = asString(parsed?.carrier || "");
        const snapshotEvents = buildSnapshotEvents(snapshot, carrier);
        if (snapshotEvents.length > 0) return snapshotEvents;
        // Fallback: single event from status
        const status = normalizeTrackingStatusLabel(asString(parsed?.status || ""));
        if (status) {
          // Use actual event time from snapshot — NOT log creation time
          const actualTs =
            snapshot?.deliveredAt ||
            snapshot?.outForDeliveryAt ||
            snapshot?.pickupReadyAt ||
            snapshot?.lastEvent?.occurredAt ||
            null;
          const location = snapshot?.lastEvent?.location || snapshot?.pickupPoint?.city || null;
          const metaParts = [carrier, location, formatEventTimestamp(actualTs)].filter(Boolean);
          return [{
            id: `carrier-status-${carrierLog?.id || "0"}`,
            title: status,
            meta: metaParts.join(" • "),
            detail: "",
            timestamp: actualTs || carrierLog?.created_at || null,
            isCurrent: true,
          }];
        }
      } catch {
        // fall through
      }
    }
  }

  // Fallback: build from all logs
  const logEvents = (Array.isArray(logs) ? logs : [])
    .map(buildTrackingEventFromLog)
    .filter(Boolean)
    .sort((a, b) => {
      const aTs = Date.parse(a?.timestamp || 0);
      const bTs = Date.parse(b?.timestamp || 0);
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });

  if (logEvents.length) {
    return logEvents.map((event, index) => ({
      ...event,
      isCurrent: index === 0,
    }));
  }

  const trackingNumber = asString(order?.tracking?.number);
  const fallbackStatus =
    normalizeTrackingStatusLabel(order?.tracking?.status) ||
    (String(order?.fulfillmentStatus || "").toLowerCase() === "fulfilled"
      ? "Shipped"
      : "Tracking available");

  return [
    {
      id: `tracking-${trackingNumber || "fallback"}`,
      title: fallbackStatus,
      meta: order?.tracking?.company ? `${order.tracking.company} • Tracking` : "Tracking",
      detail: trackingNumber ? `#${trackingNumber}` : "",
      timestamp: null,
      isCurrent: true,
    },
  ];
}
