import type {
  LiveTrackingProvider,
  LiveTrackingSnapshot,
  TrackingCheckpoint,
  TrackingEvent,
  TrackingProviderResult,
} from "./types";

const SHIP24_SEARCH_URL = "https://api.ship24.com/public/v1/tracking/search";
const DEFAULT_TIMEOUT_MS = 8_000;

type Ship24Request = (trackingNumber: string, carrierHint?: string | null) => Promise<unknown>;

export interface Ship24ReadOnlyProviderOptions {
  apiKey?: string;
  apiUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => string;
  /** Test seam for a server-side Ship24 transport; it never changes the model contract. */
  requestImpl?: Ship24Request;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function iso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validTrackingNumber(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ._/-]{1,79}$/.test(value);
}

function carrierLabel(value: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized.startsWith("gls")) return "GLS";
  if (normalized.startsWith("postnord")) return "PostNord";
  if (normalized.startsWith("bring")) return "Bring";
  if (normalized.startsWith("dao")) return "DAO";
  if (normalized.startsWith("dhl")) return "DHL";
  if (normalized.startsWith("ups")) return "UPS";
  if (normalized.startsWith("fedex")) return "FedEx";
  if (normalized.startsWith("dpd")) return "DPD";
  return raw;
}

function providerFailure(
  status: "not_found" | "invalid_request" | "unavailable" | "unauthorized",
  trackingNumber: string,
  provider: string,
  observedAt: string,
  code: string,
  message: string,
): TrackingProviderResult {
  return { status, trackingNumber, provider, observedAt, error: { code, message } };
}

function dedupeEvents(events: TrackingEvent[]): TrackingEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = [event.status, event.subStatus, event.description, event.timestamp, event.location]
      .map((part) => text(part).toLowerCase())
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeEvent(event: unknown): TrackingEvent | null {
  const raw = object(event);
  const description = text(raw.status) || text(raw.description) || null;
  const timestamp = iso(raw.datetime) || iso(raw.occurrenceDatetime) || iso(raw.occurredAt) || null;
  const status = text(raw.statusMilestone) || text(raw.status) || null;
  const subStatus = text(raw.statusCode) || text(raw.code) || null;
  const location = text(raw.location) || text(raw.city) || null;
  if (!description && !timestamp && !status && !subStatus && !location) return null;
  return { description, timestamp, location, status, subStatus };
}

function latestEvent(events: TrackingEvent[]): TrackingEvent | null {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      if (!left.event.timestamp && !right.event.timestamp) return left.index - right.index;
      if (!left.event.timestamp) return 1;
      if (!right.event.timestamp) return -1;
      return right.event.timestamp.localeCompare(left.event.timestamp);
    })[0]?.event ?? null;
}

function exceptionValue(status: string | null, subStatus: string | null): string | null {
  const candidate = text(subStatus) || text(status);
  return /exception|failed|return/i.test(candidate) ? candidate : null;
}

function normalizeCanonicalDetail(detail: Record<string, unknown>, trackingNumber: string, observedAt: string): LiveTrackingSnapshot {
  const snapshot = object(detail.snapshot);
  const rawEvents = Array.isArray(snapshot.events) ? snapshot.events : [];
  const checkpoints = dedupeEvents(rawEvents.map(normalizeEvent).filter((event): event is TrackingCheckpoint => Boolean(event)));
  const latest = normalizeEvent(snapshot.lastEvent) || latestEvent(checkpoints);
  const status = text(snapshot.statusCode) || text(snapshot.statusText) || null;
  const subStatus = text(detail.carrierStatus) || null;
  return {
    trackingNumber: text(detail.trackingNumber) || trackingNumber,
    carrier: carrierLabel(text(detail.carrier)),
    status,
    subStatus,
    latestEvent: latest,
    estimatedDelivery: iso(snapshot.expectedDeliveryAt),
    checkpoints,
    exception: exceptionValue(status, subStatus),
    observedAt,
    provider: "ship24",
    source: "ship24_api",
  };
}

function normalizeShip24Payload(payload: unknown, trackingNumber: string, observedAt: string): TrackingProviderResult {
  const root = object(payload);
  if (root.detail && typeof root.detail === "object" && !Array.isArray(root.detail)) {
    const detail = object(root.detail);
    if (text(detail.lookupSource) !== "ship24_api" || text(detail.lookupDetail) !== "ok") {
      return providerFailure("not_found", trackingNumber, "ship24", observedAt, "tracking_not_found", "Ship24 returned no live tracking record.");
    }
    return { status: "ok", data: normalizeCanonicalDetail(detail, trackingNumber, observedAt) };
  }

  const data = object(root.data);
  const trackings = Array.isArray(data.trackings) ? data.trackings : [];
  const tracking = object(trackings[0]);
  if (!trackings.length || !Object.keys(tracking).length) {
    return providerFailure("not_found", trackingNumber, "ship24", observedAt, "tracking_not_found", "Ship24 returned no tracking record.");
  }

  const shipment = object(tracking.shipment);
  const delivery = object(shipment.delivery);
  const rawEvents = Array.isArray(tracking.events) ? tracking.events : [];
  const checkpoints = dedupeEvents(rawEvents.map(normalizeEvent).filter((event): event is TrackingCheckpoint => Boolean(event)));
  const latest = latestEvent(checkpoints);
  const status = text(shipment.statusMilestone) || latest?.status || null;
  const subStatus = text(shipment.statusCode) || latest?.subStatus || null;
  const carrier = carrierLabel(text(shipment.courierCode) || text(tracking.courierCode) || "");

  return {
    status: "ok",
    data: {
      trackingNumber,
      carrier,
      status,
      subStatus,
      latestEvent: latest,
      estimatedDelivery: iso(delivery.estimatedDeliveryDate),
      checkpoints,
      exception: exceptionValue(status, subStatus),
      observedAt,
      provider: "ship24",
      source: "ship24_api",
    },
  };
}

export class Ship24ReadOnlyProvider implements LiveTrackingProvider {
  readonly providerName = "ship24_read_only";
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => string;
  private readonly requestImpl?: Ship24Request;

  constructor(options: Ship24ReadOnlyProviderOptions = {}) {
    this.apiKey = text(options.apiKey ?? process.env.SHIP24_API_KEY);
    this.apiUrl = text(options.apiUrl) || SHIP24_SEARCH_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.requestImpl = options.requestImpl;
  }

  private async request(trackingNumber: string, carrierHint?: string | null): Promise<unknown> {
    if (this.requestImpl) return this.requestImpl(trackingNumber, carrierHint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ trackingNumber }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(`Ship24 response ${response.status}`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async lookup(input: {
    trackingNumber: string;
    carrierHint?: string | null;
    trackingUrl?: string | null;
    provenance: { source: "shopify_order_fulfillment" | "customer_message"; workspaceId: string; orderId?: string | null; orderNumber?: string | null; fulfillmentId?: string | null };
  }): Promise<TrackingProviderResult> {
    const trackingNumber = text(input?.trackingNumber);
    const observedAt = this.now();
    if (!trackingNumber || !validTrackingNumber(trackingNumber)) {
      return providerFailure("invalid_request", trackingNumber, "ship24", observedAt, "invalid_tracking_number", "A valid tracking number is required.");
    }
    if (!input?.provenance?.workspaceId) {
      return providerFailure("unauthorized", trackingNumber, "ship24", observedAt, "trusted_provenance_required", "Trusted tracking provenance is required.");
    }
    if (!this.requestImpl && !this.apiKey) {
      return providerFailure("unavailable", trackingNumber, "ship24", observedAt, "provider_not_configured", "Ship24 is not configured for this runtime.");
    }

    try {
      const payload = await this.request(trackingNumber, input.carrierHint);
      if (!payload) return providerFailure("unavailable", trackingNumber, "ship24", observedAt, "malformed_response", "Ship24 returned no usable response.");
      return normalizeShip24Payload(payload, trackingNumber, observedAt);
    } catch (error: any) {
      const status = Number(error?.status ?? 0);
      if (status === 401 || status === 403) {
        return providerFailure("unauthorized", trackingNumber, "ship24", observedAt, "provider_unauthorized", "Ship24 rejected the configured credentials.");
      }
      if (status === 400 || status === 422) {
        return providerFailure("invalid_request", trackingNumber, "ship24", observedAt, "provider_invalid_request", "Ship24 rejected the tracking request.");
      }
      return providerFailure("unavailable", trackingNumber, "ship24", observedAt, "provider_unavailable", "Ship24 could not verify the tracking status.");
    }
  }
}
