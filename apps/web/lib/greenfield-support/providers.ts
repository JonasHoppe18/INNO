import type {
  CommerceReadProvider,
  CustomerSnapshot,
  LiveTrackingProvider,
  JsonValue,
  OrderSnapshot,
  TrackingSnapshot,
} from "./types";

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function orderMatches(order: OrderSnapshot, query: string): boolean {
  const wanted = normalize(query).replace(/^#/, "");
  if (!wanted) return false;
  return [order.id, order.orderNumber, `#${order.orderNumber}`].some(
    (candidate) => normalize(candidate).replace(/^#/, "") === wanted,
  );
}

export interface InMemoryCommerceData {
  customer?: CustomerSnapshot | null;
  orders?: OrderSnapshot[];
  products?: Array<{ query: string; value: JsonValue }>;
  tracking?: TrackingSnapshot[];
}

/** Test/development provider. It is scoped at construction and has no writes. */
export class InMemoryCommerceProvider implements CommerceReadProvider {
  readonly providerName = "in_memory_fixture";
  private readonly customer: CustomerSnapshot | null;
  private readonly orders: OrderSnapshot[];
  private readonly products: Array<{ query: string; value: JsonValue }>;
  private readonly tracking: TrackingSnapshot[];

  constructor(data: InMemoryCommerceData = {}) {
    this.customer = data.customer ?? null;
    this.orders = data.orders ?? [];
    this.products = data.products ?? [];
    this.tracking = data.tracking ?? [];
  }

  async getOrder(orderId: string): Promise<OrderSnapshot | null> {
    return this.orders.find((order) => orderMatches(order, orderId)) ?? null;
  }

  async getOrderHistory(customerEmail: string | null | undefined): Promise<OrderSnapshot[]> {
    const email = normalize(customerEmail);
    if (!email) return [];
    return this.orders.filter((order) => normalize(this.customer?.email) === email || normalize((order as any).customerEmail) === email);
  }

  async getCustomer(): Promise<CustomerSnapshot | null> {
    return this.customer;
  }

  async getProduct(query: string): Promise<JsonValue> {
    const wanted = normalize(query);
    const matches = this.products.filter((entry) => normalize(entry.query).includes(wanted) || wanted.includes(normalize(entry.query)));
    if (matches.length === 0) return { status: "not_found", query };
    if (matches.length === 1) return matches[0].value;
    return { status: "ambiguous", query, matches: matches.map((entry) => entry.value) };
  }

  async getProductAvailability(query: string): Promise<JsonValue> {
    return { status: "unavailable", query, provider: this.providerName };
  }

  async inspectFulfillment(orderId: string): Promise<JsonValue> {
    const order = await this.getOrder(orderId);
    if (!order) return { status: "not_found", orderId };
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      fulfillmentStatus: order.fulfillmentStatus ?? null,
      fulfillments: order.fulfillments ?? [],
    };
  }
}

export class InMemoryTrackingProvider implements LiveTrackingProvider {
  readonly providerName = "in_memory_fixture";
  private readonly tracking: TrackingSnapshot[];

  constructor(tracking: TrackingSnapshot[] = []) {
    this.tracking = tracking;
  }

  async lookup(input: Parameters<LiveTrackingProvider["lookup"]>[0]) {
    const wanted = normalize(input?.trackingNumber);
    const match = this.tracking.find((item) => normalize(item.trackingNumber) === wanted);
    const observedAt = input?.provenance?.workspaceId ? "2026-09-03T08:00:00.000Z" : new Date().toISOString();
    if (!match) return { status: "not_found" as const, trackingNumber: input?.trackingNumber ?? "", provider: this.providerName, observedAt };
    return {
      status: "ok" as const,
      data: {
        trackingNumber: match.trackingNumber ?? input.trackingNumber,
        carrier: match.carrier ?? null,
        status: match.status ?? null,
        subStatus: null,
        latestEvent: null,
        estimatedDelivery: match.estimatedDelivery ?? null,
        checkpoints: [],
        exception: null,
        observedAt: match.observedAt,
        provider: this.providerName,
        source: "in_memory_fixture",
      },
    };
  }
}
