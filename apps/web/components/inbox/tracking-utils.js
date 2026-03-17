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

  const metaParts = [
    parsed?.trackingCarrier || "",
    parsed?.trackingLookupSource || parsed?.trackingSource || "",
    formatEventTimestamp(log?.created_at),
  ].filter(Boolean);

  const detailParts = [
    parsed?.trackingLookupDetail || "",
    parsed?.trackingNumber ? `#${parsed.trackingNumber}` : "",
  ].filter(Boolean);

  return {
    id: String(log?.id || `${step}-${log?.created_at || title}`),
    title,
    meta: metaParts.join(" • "),
    detail: detailParts.join(" • "),
    timestamp: log?.created_at || null,
    isCurrent: step === "carrier_tracking" || step === "carrier tracking",
  };
}

export function buildTrackingTimeline({ logs = [], order = null }) {
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
