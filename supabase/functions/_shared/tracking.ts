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
  pickupReadyAt?: string | null;
  pickupPoint?: NormalizedTrackingEvent["pickupPoint"];
  lastEvent?: NormalizedTrackingEvent | null;
  events: NormalizedTrackingEvent[];
};

export type TrackingDetail = {
  carrier: string;
  statusText: string;
  trackingNumber: string;
  trackingUrl: string;
  lastEventAt?: string | null;
  source?: "shopify" | "webshipper";
  snapshot?: TrackingSnapshot | null;
};

const GLS_TRACKING_ENDPOINT =
  "https://gls-group.eu/app/service/open/rest/TrackAndTrace/piece/";
const TRACKING_EVENTS_ENABLED = (Deno.env.get("TRACKING_EVENTS_ENABLED") ?? "false")
  .toLowerCase() === "true";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  const code =
    asString(value?.code || value?.event_code || value?.status || value?.status_code) || null;
  const description =
    asString(value?.description || value?.statusText || value?.status_text || value?.label || value?.message) ||
    null;
  const occurredAt =
    normalizeIso(
      value?.occurredAt ||
        value?.occurred_at ||
        value?.dateTime ||
        value?.date ||
        value?.eventTime ||
        value?.created_at ||
        value?.updated_at,
    ) || null;
  const location =
    asString(value?.location || value?.locationName || value?.city || value?.depot || value?.hub) || null;
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
}) {
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
  return "unknown";
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

async function fetchGLSStatus(
  trackingNumber: string,
  fallbackUrl?: string | null,
): Promise<TrackingDetail | null> {
  const url = `${GLS_TRACKING_ENDPOINT}${encodeURIComponent(trackingNumber)}`;
  const publicUrl =
    asString(fallbackUrl) || `https://gls-group.eu/EU/en/parcel-tracking?match=${trackingNumber}`;

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
      snapshot: buildSnapshotFromStatusText(timestamp ? `${baseStatus} (${timestamp})` : String(baseStatus)),
    };
  } catch {
    return {
      carrier: "GLS",
      statusText: "Kunne ikke hente live tracking lige nu.",
      trackingNumber,
      trackingUrl: publicUrl,
      snapshot: buildSnapshotFromStatusText("Tracking update unavailable right now."),
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
      };
    }

    if (text.includes("ude til levering")) {
      return {
        carrier: "PostNord",
        statusText: "Pakken er ude til levering.",
        trackingNumber,
        trackingUrl: url,
      };
    }

    if (text.includes("leveret")) {
      return {
        carrier: "PostNord",
        statusText: "Pakken er leveret.",
        trackingNumber,
        trackingUrl: url,
      };
    }

    if (text.includes("under transport") || text.includes("på vej")) {
      return {
        carrier: "PostNord",
        statusText: "Pakken er på vej.",
        trackingNumber,
        trackingUrl: url,
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
    snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
  };
}

async function fetchDaoStatus(
  trackingNumber: string,
  trackingUrl?: string | null,
): Promise<TrackingDetail> {
  const url = asString(trackingUrl);
  return {
    carrier: "DAO",
    statusText: "Shipped - follow the parcel via tracking link.",
    trackingNumber,
    trackingUrl: url || `https://www.dao.as/track-and-trace/?id=${trackingNumber}`,
    snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
  };
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
): Promise<Record<string, TrackingDetail>> {
  if (!Array.isArray(orders) || orders.length === 0) return {};
  const details: Record<string, TrackingDetail> = {};

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
        snapshot:
          TRACKING_EVENTS_ENABLED && snapshotFromSource
            ? snapshotFromSource
            : buildSnapshotFromStatusText(resolvedStatusText),
      };
      details[key] = detail;
      continue;
    }

    if (carrier === "gls") {
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
    } else {
      detail = {
        carrier: candidate.company || "Carrier",
        statusText: "Shipped - follow the parcel via tracking link.",
        trackingNumber: candidate.trackingNumber,
        trackingUrl: candidate.trackingUrl,
        source: candidate.source || "shopify",
        snapshot: buildSnapshotFromStatusText("Shipped - follow the parcel via tracking link."),
      };
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
