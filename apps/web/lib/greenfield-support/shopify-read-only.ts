import type {
  CommerceReadProvider,
  CustomerSnapshot,
  JsonValue,
  OrderSnapshot,
  ProductAvailabilityState,
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

function normalizedProductText(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function hasOwn(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

function numeric(value: unknown): number | null {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function inventoryPolicy(value: unknown): "deny" | "continue" | null {
  const result = clean(value).toLowerCase();
  return result === "deny" || result === "continue" ? result : null;
}

function trackedSignal(variant: Record<string, unknown>): true | false | null {
  if (hasOwn(variant, "tracked")) return typeof variant.tracked === "boolean" ? variant.tracked : null;
  if (hasOwn(variant, "inventory_item_tracked")) {
    return typeof variant.inventory_item_tracked === "boolean" ? variant.inventory_item_tracked : null;
  }
  if (!hasOwn(variant, "inventory_management")) return null;
  if (variant.inventory_management == null || clean(variant.inventory_management) === "") return false;
  return clean(variant.inventory_management).toLowerCase() === "shopify" ? true : null;
}

function sellableQuantity(variant: Record<string, unknown>): number | null {
  for (const key of ["sellable_online_quantity", "sellableOnlineQuantity", "inventory_quantity", "inventoryQuantity"]) {
    if (!hasOwn(variant, key)) continue;
    const value = numeric(variant[key]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Maps only explicit Shopify inventory signals to a customer-safe state.
 * A positive quantity is never enough on its own: tracking and policy must
 * also be known, and an explicit availableForSale=false prevents a claim.
 */
export function shopifyAvailabilityState(
  rawVariant: Record<string, unknown>,
  options: { locationScopeResolved?: boolean } = {},
): ProductAvailabilityState {
  const tracked = trackedSignal(rawVariant);
  if (tracked === false) return "NOT_TRACKED";
  if (tracked === null) return "UNKNOWN";

  const availableForSale = hasOwn(rawVariant, "availableForSale")
    ? rawVariant.availableForSale
    : hasOwn(rawVariant, "available_for_sale")
      ? rawVariant.available_for_sale
      : undefined;
  if (availableForSale === false) return "UNKNOWN";
  if (options.locationScopeResolved === false) return "UNKNOWN";

  const quantity = sellableQuantity(rawVariant);
  const policy = inventoryPolicy(rawVariant.inventory_policy ?? rawVariant.inventoryPolicy);
  if (quantity === null || policy === null) return "UNKNOWN";
  if (quantity > 0) return "AVAILABLE";
  return policy === "continue" ? "AVAILABLE_TO_ORDER" : "OUT_OF_STOCK";
}

function variantLookupValues(variant: Record<string, unknown>, product?: Record<string, unknown>): string[] {
  const productPrefix = product?.title == null ? "" : `${clean(product.title)} `;
  return [
    variant.title,
    variant.sku,
    variant.option1,
    variant.option2,
    variant.option3,
    `${productPrefix}${clean(variant.title)}`,
    `${productPrefix}${clean(variant.sku)}`,
  ]
    .map(normalizedProductText)
    .filter(Boolean);
}

function productIdentityValues(product: Record<string, unknown>): string[] {
  return [product.title, product.handle].map(normalizedProductText).filter(Boolean);
}

function selectAvailabilityProducts(query: string, products: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const wanted = normalizedProductText(query);
  if (!wanted) return [];
  const exact = products.filter((product) =>
    productIdentityValues(product).includes(wanted) ||
    (Array.isArray(product.variants) && product.variants.some((variant) =>
      variant && typeof variant === "object" && variantLookupValues(variant as Record<string, unknown>, product).includes(wanted),
    )),
  );
  if (exact.length) return exact;
  return products.filter((product) =>
    productIdentityValues(product).some((value) => value.includes(wanted)) ||
    (Array.isArray(product.variants) && product.variants.some((variant) =>
      variant && typeof variant === "object" && variantLookupValues(variant as Record<string, unknown>, product).some((value) => value.includes(wanted)),
    )),
  );
}

function selectedAvailabilityVariants(query: string, product: Record<string, unknown>): Array<Record<string, unknown>> {
  const variants = Array.isArray(product.variants)
    ? product.variants.filter((variant): variant is Record<string, unknown> => Boolean(variant && typeof variant === "object"))
    : [];
  const wanted = normalizedProductText(query);
  if (productIdentityValues(product).includes(wanted) || productIdentityValues(product).some((value) => value.includes(wanted))) return variants;
  const exact = variants.filter((variant) => variantLookupValues(variant, product).includes(wanted));
  if (exact.length) return exact;
  const contains = variants.filter((variant) => variantLookupValues(variant, product).some((value) => value.includes(wanted)));
  return contains.length ? contains : variants;
}

function publicAvailabilityVariant(
  variant: Record<string, unknown>,
  locationScopeResolved: boolean,
): Record<string, JsonValue> {
  const state = shopifyAvailabilityState(variant, { locationScopeResolved });
  return {
    id: variant.id == null ? null : clean(variant.id),
    title: variant.title == null ? null : clean(variant.title),
    sku: variant.sku == null ? null : clean(variant.sku),
    availability_state: state,
  };
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

  async getProductAvailability(query: string): Promise<JsonValue> {
    const productQuery = clean(query);
    const observedAt = new Date().toISOString();
    if (!productQuery) return { status: "unknown", query: productQuery, provider: this.providerName, source: "shopify_live", observed_at: observedAt, products: [] };

    const fields = "id,title,handle,status,published_at,variants";
    const titlePayload = await this.get("products.json", {
      status: "active",
      limit: "10",
      title: productQuery,
      fields,
    });
    let products = Array.isArray(titlePayload?.products) ? titlePayload.products : [];
    if (!products.length) {
      const listingPayload = await this.get("products.json", { status: "active", limit: "250", fields });
      products = Array.isArray(listingPayload?.products) ? listingPayload.products : [];
    }
    const matches = selectAvailabilityProducts(productQuery, products);
    if (!matches.length) {
      return {
        status: "not_found",
        query: productQuery,
        provider: this.providerName,
        source: "shopify_live",
        observed_at: observedAt,
        products: [],
      };
    }

    let locationScopeResolved = true;
    let locationScope: "single_active_location" | "multiple_active_locations" | "unknown" = "single_active_location";
    try {
      const locationsPayload = await this.get("locations.json", { limit: "250" });
      const locations = Array.isArray(locationsPayload?.locations) ? locationsPayload.locations : [];
      const activeLocations = locations.filter((location: any) => location?.active !== false);
      if (activeLocations.length !== 1) {
        locationScopeResolved = false;
        locationScope = activeLocations.length > 1 ? "multiple_active_locations" : "unknown";
      }
    } catch {
      locationScopeResolved = false;
      locationScope = "unknown";
    }

    const outputProducts = matches.map((product: any) => {
      const variants = selectedAvailabilityVariants(productQuery, product);
      return {
        id: product?.id == null ? null : clean(product.id),
        title: product?.title == null ? null : clean(product.title),
        handle: product?.handle == null ? null : clean(product.handle),
        variants: variants.map((variant) => publicAvailabilityVariant(variant, locationScopeResolved)),
      };
    });
    const selectedVariantCount = outputProducts.reduce((count, product) => count + product.variants.length, 0);
    const ambiguous = matches.length !== 1 || selectedVariantCount !== 1;
    const singleProductIsNamed = matches.length === 1 && (
      productIdentityValues(matches[0]).includes(normalizedProductText(productQuery)) ||
      productIdentityValues(matches[0]).some((value) => value.includes(normalizedProductText(productQuery)))
    );
    return {
      status: ambiguous ? "ambiguous" : "ok",
      selection: ambiguous ? "ambiguous" : singleProductIsNamed ? "product" : "exact_variant",
      query: productQuery,
      provider: this.providerName,
      source: "shopify_live",
      observed_at: observedAt,
      location_scope: locationScope,
      products: outputProducts,
    };
  }

  async inspectFulfillment(orderId: string): Promise<JsonValue> {
    const order = await this.getOrder(orderId);
    if (!order) return { status: "not_found", order_id: clean(orderId) };
    return { status: "ok", order_id: order.id, order_number: order.orderNumber, fulfillment_status: order.fulfillmentStatus, fulfillments: order.fulfillments ?? [] };
  }
}
