import type {
  CommerceReadProvider,
  CustomerSnapshot,
  JsonValue,
  OrderSnapshot,
} from "./types";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedEmail(value: unknown): string {
  return clean(value).toLowerCase();
}

function safeLookup(value: unknown): string {
  const result = clean(value);
  return /^[#a-z0-9_-]{1,80}$/i.test(result) ? result : "";
}

function mapOrder(raw: any): OrderSnapshot {
  const orderNumber = clean(raw?.order_number ?? raw?.name).replace(/^#/, "");
  const cancelled = Boolean(raw?.cancelled_at);
  const fulfillmentStatus = raw?.fulfillment_status == null ? null : clean(raw.fulfillment_status);
  return {
    id: clean(raw?.id),
    orderNumber,
    status: cancelled ? "cancelled" : fulfillmentStatus || clean(raw?.financial_status) || "unknown",
    financialStatus: raw?.financial_status ?? null,
    fulfillmentStatus,
    createdAt: raw?.created_at ?? null,
    updatedAt: raw?.updated_at ?? null,
    total: raw?.total_price ?? null,
    currency: raw?.currency ?? null,
    items: Array.isArray(raw?.line_items)
      ? raw.line_items.map((item: any) => ({ id: clean(item?.id), title: clean(item?.title), quantity: Number(item?.quantity ?? 0) }))
      : [],
    fulfillments: Array.isArray(raw?.fulfillments)
      ? raw.fulfillments.map((fulfillment: any) => ({
          id: clean(fulfillment?.id),
          status: fulfillment?.status ?? null,
          carrier: fulfillment?.tracking_company ?? null,
          trackingNumber: fulfillment?.tracking_number ?? null,
          trackingUrl: fulfillment?.tracking_url ?? null,
          shipmentStatus: fulfillment?.shipment_status ?? null,
        }))
      : [],
  };
}

function orderNumberMatches(order: OrderSnapshot, query: string): boolean {
  const wanted = clean(query).replace(/^#/, "");
  return Boolean(wanted) && [order.id, order.orderNumber].some((value) => clean(value).replace(/^#/, "") === wanted);
}

export interface ShopifyReadOnlyProviderOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  customer?: CustomerSnapshot | null;
  fetchImpl?: typeof fetch;
}

/**
 * A separate GET-only adapter for the experiment. It does not expose or import
 * any of the existing action/update functions.
 */
export class ShopifyReadOnlyProvider implements CommerceReadProvider {
  readonly providerName = "shopify_read_only";
  private readonly domain: string;
  private readonly token: string;
  private readonly apiVersion: string;
  private readonly customer: CustomerSnapshot | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ShopifyReadOnlyProviderOptions) {
    this.domain = clean(options.shopDomain).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    this.token = options.accessToken;
    this.apiVersion = options.apiVersion ?? process.env.SHOPIFY_API_VERSION ?? "2026-07";
    this.customer = options.customer ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!this.domain || !this.token) throw new Error("Shopify read-only provider requires server-side credentials.");
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(`https://${this.domain}/admin/api/${this.apiVersion}/${path.replace(/^\/+/, "")}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", "X-Shopify-Access-Token": this.token },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Shopify read failed (${response.status}).`);
    return payload;
  }

  async getOrder(orderId: string): Promise<OrderSnapshot | null> {
    const lookup = safeLookup(orderId);
    if (!lookup) return null;
    const customerEmail = normalizedEmail(this.customer?.email);
    if (!customerEmail) return null;
    const payload = await this.get("orders.json", {
      status: "any",
      limit: "50",
      name: `#${lookup.replace(/^#/, "")}`,
      email: customerEmail,
    });
    const orders = Array.isArray(payload?.orders) ? payload.orders.map(mapOrder) : [];
    const byName = orders.find((order: OrderSnapshot) => orderNumberMatches(order, lookup));
    if (byName) return byName;

    // Numeric Shopify IDs are a fallback only, and the raw order email must
    // match the verified case identity before any order data is returned.
    if (!/^\d+$/.test(lookup)) return null;
    try {
      const directPayload = await this.get(`orders/${lookup}.json`);
      const rawOrder = directPayload?.order;
      if (!rawOrder || normalizedEmail(rawOrder.email) !== customerEmail) return null;
      return mapOrder(rawOrder);
    } catch (error: any) {
      if (error?.message?.includes("(404)")) return null;
      throw error;
    }
  }

  async getOrderHistory(customerEmail: string | null | undefined): Promise<OrderSnapshot[]> {
    const email = clean(customerEmail);
    if (!email || !email.includes("@")) return [];
    const payload = await this.get("orders.json", { status: "any", limit: "50", email });
    return Array.isArray(payload?.orders) ? payload.orders.map(mapOrder) : [];
  }

  async getCustomer(): Promise<CustomerSnapshot | null> {
    return this.customer;
  }

  async getProduct(query: string): Promise<JsonValue> {
    const productQuery = clean(query);
    if (!productQuery) return { status: "missing_query" };
    const payload = await this.get("products.json", { status: "active", limit: "10", title: productQuery });
    const products = Array.isArray(payload?.products) ? payload.products : [];
    return {
      status: products.length ? "ok" : "not_found",
      products: products.map((product: any) => ({ id: product?.id ?? null, title: product?.title ?? null, handle: product?.handle ?? null, variants: product?.variants ?? [] })),
    };
  }

  async inspectFulfillment(orderId: string): Promise<JsonValue> {
    const order = await this.getOrder(orderId);
    if (!order) return { status: "not_found", order_id: clean(orderId) };
    return { status: "ok", order_id: order.id, order_number: order.orderNumber, fulfillment_status: order.fulfillmentStatus, fulfillments: order.fulfillments ?? [] };
  }
}
