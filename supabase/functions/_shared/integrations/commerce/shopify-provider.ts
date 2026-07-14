import type {
  CommerceProvider,
  Order,
  TrackingInfo,
  Address,
  RefundOpts,
  RefundResult,
  RefundRecord,
  LineItemEdit,
  ActionType,
  StockAvailabilityFact,
  StockState,
} from './types.ts';

// Maps the `refunds[]` array already present in the Shopify REST order payload
// to normalised RefundRecord[]. Read-only and additive — no extra fetch.
// Exported for unit testing.
export function mapShopifyRefunds(rawRefunds: unknown): RefundRecord[] {
  if (!Array.isArray(rawRefunds)) return [];
  return rawRefunds.map((r: any) => ({
    id: r?.id != null ? String(r.id) : undefined,
    created_at: r?.created_at ?? null,
    processed_at: r?.processed_at ?? null,
    note: r?.note ?? null,
    transactions: Array.isArray(r?.transactions)
      ? r.transactions.map((t: any) => ({
          id: t?.id != null ? String(t.id) : undefined,
          amount: t?.amount != null ? String(t.amount) : undefined,
          currency: t?.currency ?? undefined,
          gateway: t?.gateway ?? undefined,
          status: t?.status ?? undefined,
          kind: t?.kind ?? undefined,
          processed_at: t?.processed_at ?? null,
          created_at: t?.created_at ?? null,
        }))
      : [],
  }));
}

// Constructor config for ShopifyProvider
export interface ShopifyProviderConfig {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

// Internal type for raw Shopify REST order response
type RawShopifyOrder = Record<string, any>;

// Builds the base URL for Shopify Admin REST API calls.
// Domain is normalised (strips https://) to match the pattern used throughout
// the existing shopify.ts and automation-actions.ts shared modules.
function buildShopifyUrl(
  shopDomain: string,
  apiVersion: string,
  path: string,
): string {
  const domain = shopDomain.replace(/^https?:\/\//, '');
  return `https://${domain}/admin/api/${apiVersion}/${path.replace(/^\/+/, '')}`;
}

// Executes a fetch against the Shopify Admin REST API and returns parsed JSON.
// Access token is sent via the X-Shopify-Access-Token header — same pattern as
// automation-actions.ts shopifyRequest helper.
async function shopifyFetch<T>(
  shopDomain: string,
  accessToken: string,
  apiVersion: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = buildShopifyUrl(shopDomain, apiVersion, path);
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message =
      (json as any)?.errors ??
      (json as any)?.error ??
      text ??
      `Shopify responded with status ${response.status}`;
    throw Object.assign(
      new Error(typeof message === 'string' ? message : JSON.stringify(message)),
      { status: response.status },
    );
  }

  return json as T;
}

// Maps a raw Shopify REST order object to the normalised Order interface.
function mapOrder(raw: RawShopifyOrder): Order {
  return {
    id: String(raw.id),
    order_number: raw.order_number ?? raw.name,
    name: raw.name ?? `#${raw.order_number}`,
    email: raw.email ?? undefined,
    financial_status: raw.financial_status ?? 'unknown',
    fulfillment_status: raw.fulfillment_status ?? null,
    cancelled_at: raw.cancelled_at ?? null,
    closed_at: raw.closed_at ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    total_price: raw.total_price ?? '0.00',
    currency: raw.currency ?? '',
    shipping_address: raw.shipping_address
      ? {
          address1: raw.shipping_address.address1 ?? '',
          address2: raw.shipping_address.address2 ?? undefined,
          city: raw.shipping_address.city ?? '',
          province: raw.shipping_address.province ?? undefined,
          zip: raw.shipping_address.zip ?? '',
          country: raw.shipping_address.country_code ?? raw.shipping_address.country ?? '',
          first_name: raw.shipping_address.first_name ?? undefined,
          last_name: raw.shipping_address.last_name ?? undefined,
          phone: raw.shipping_address.phone ?? undefined,
        }
      : undefined,
    line_items: Array.isArray(raw.line_items)
      ? raw.line_items.map((item: any) => ({
          id: String(item.id),
          title: item.title ?? '',
          variant_id: item.variant_id != null ? String(item.variant_id) : undefined,
          quantity: item.quantity ?? 0,
          price: item.price ?? '0.00',
          sku: item.sku ?? undefined,
        }))
      : [],
    fulfillments: Array.isArray(raw.fulfillments)
      ? raw.fulfillments.map((f: any) => ({
          id: String(f.id),
          status: f.status ?? '',
          tracking_number: f.tracking_number ?? undefined,
          tracking_url: f.tracking_url ?? undefined,
          tracking_company: f.tracking_company ?? undefined,
          shipment_status: f.shipment_status ?? undefined,
        }))
      : [],
    refunds: mapShopifyRefunds(raw.refunds),
    tags: raw.tags ?? undefined,
    note: raw.note ?? undefined,
  };
}

function nullableString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function numericQuantity(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeInventoryPolicy(value: unknown): 'deny' | 'continue' | null {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'deny' || text === 'continue' ? text : null;
}

function normalizeProductLookupText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isSpecificProductQuery(query: string): boolean {
  const normalized = normalizeProductLookupText(query);
  if (!normalized) return false;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length >= 2) return true;
  // Known short model family (a-rise/a-spire/...) stays specific.
  if (/^a[- ]?(?:spire|blaze|rise|live)$/i.test(query.trim())) return true;
  // A single DISTINCTIVE token (>= 4 chars, e.g. "airpods", "arise") is
  // specific enough to attempt a local contains-match. Wrong-product safety is
  // still enforced by selectShopifyProductsForStockQuery's exact/contains rules,
  // so this cannot turn "airpods" into A-Blaze. Short/generic tokens are not.
  return tokens.length === 1 && tokens[0].length >= 4;
}

// Compact (space-stripped) normalization so spelling/spacing variants of the
// SAME token collapse together — "A-rise", "A Rise", "a-rise" and "arise" all
// become "arise" — while DISTINCT model names ("aspire", "ablaze") stay
// different. Used as an exact-equality tier only, never substring, so it cannot
// broaden A-Rise into A-Spire/A-Blaze.
function normalizeProductLookupCompact(value: unknown): string {
  return normalizeProductLookupText(value).replace(/\s+/g, '');
}

export function selectShopifyProductsForStockQuery(
  query: string,
  products: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (!isSpecificProductQuery(query)) return [];
  const normalizedQuery = normalizeProductLookupText(query);
  const compactQuery = normalizeProductLookupCompact(query);
  const withLookup = products.map((product) => ({
    product,
    title: normalizeProductLookupText(product.title),
    handle: normalizeProductLookupText(product.handle),
    titleCompact: normalizeProductLookupCompact(product.title),
    handleCompact: normalizeProductLookupCompact(product.handle),
  })).filter((entry) => entry.title || entry.handle);

  const exactTitle = withLookup.filter((entry) => entry.title === normalizedQuery);
  if (exactTitle.length > 0) return exactTitle.map((entry) => entry.product);

  const exactHandle = withLookup.filter((entry) => entry.handle === normalizedQuery);
  if (exactHandle.length > 0) return exactHandle.map((entry) => entry.product);

  // Space-insensitive exact match ("arise" → "A-Rise", "A Rise" → "A-Rise").
  const compactMatch = withLookup.filter((entry) =>
    (entry.titleCompact && entry.titleCompact === compactQuery) ||
    (entry.handleCompact && entry.handleCompact === compactQuery)
  );
  if (compactMatch.length > 0) return compactMatch.map((entry) => entry.product);

  const contains = withLookup.filter((entry) =>
    entry.title.includes(normalizedQuery) ||
    entry.handle.includes(normalizedQuery) ||
    normalizedQuery.includes(entry.title)
  );
  if (contains.length === 1) return [contains[0].product];
  return contains.map((entry) => entry.product);
}

export interface ShopifyProductInventoryLookupDiagnostics {
  query: string;
  title_search_product_count: number;
  list_fallback_attempted: boolean;
  list_fallback_product_count: number;
  matched_products: Array<{
    id: string | null;
    title: string | null;
    handle: string | null;
  }>;
  ambiguous_match: boolean;
  no_match: boolean;
  // Distinct reason the live lookup produced no usable products. Lets the
  // pipeline tell apart a genuine empty/zero-products store from an auth/scope
  // or wrong-shop problem instead of collapsing everything into "not_found".
  // null when the call succeeded (regardless of whether it matched).
  error_reason?:
    | "missing_read_products_scope"
    | "missing_read_inventory_scope"
    | "wrong_shop_context"
    | "shopify_returned_zero_products"
    | "lookup_error"
    | null;
  http_status?: number | null;
}

// True when matched products were returned but NONE of their variants expose a
// numeric inventory_quantity — the signature of a token without read_inventory.
// The product is identifiable; live stock simply cannot be read.
function matchedProductsLackInventory(
  products: Array<Record<string, unknown>>,
): boolean {
  if (products.length === 0) return false;
  let sawVariant = false;
  for (const product of products) {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    for (const v of variants) {
      sawVariant = true;
      const qty = (v as Record<string, unknown>)?.inventory_quantity;
      if (qty != null && Number.isFinite(Number(qty))) return false;
    }
  }
  return sawVariant;
}

// Classify a failed Admin API call into a distinct, actionable reason.
function classifyShopifyLookupError(
  err: unknown,
): { error_reason: NonNullable<ShopifyProductInventoryLookupDiagnostics["error_reason"]>; http_status: number | null } {
  const status = typeof (err as { status?: unknown })?.status === "number"
    ? (err as { status: number }).status
    : null;
  if (status === 401 || status === 403) {
    return { error_reason: "missing_read_products_scope", http_status: status };
  }
  if (status === 404) {
    return { error_reason: "wrong_shop_context", http_status: status };
  }
  return { error_reason: "lookup_error", http_status: status };
}

function productLookupDiagnostics(
  query: string,
  input: {
    titleProducts: Array<Record<string, unknown>>;
    listFallbackAttempted: boolean;
    listFallbackProductCount: number;
    matchedProducts: Array<Record<string, unknown>>;
  },
): ShopifyProductInventoryLookupDiagnostics {
  const productIds = new Set(
    input.matchedProducts
      .map((product) => String(product.id ?? "").trim())
      .filter(Boolean),
  );
  return {
    query,
    title_search_product_count: input.titleProducts.length,
    list_fallback_attempted: input.listFallbackAttempted,
    list_fallback_product_count: input.listFallbackProductCount,
    matched_products: input.matchedProducts.map((product) => ({
      id: product.id == null ? null : String(product.id),
      title: product.title == null ? null : String(product.title),
      handle: product.handle == null ? null : String(product.handle),
    })),
    ambiguous_match: productIds.size > 1,
    no_match: input.matchedProducts.length === 0,
  };
}

function stockStateForVariant(input: {
  productStatus: string | null;
  publishedAt: string | null;
  quantity: number | null;
  inventoryPolicy: 'deny' | 'continue' | null;
  inventoryManagement: string | null;
}): StockState {
  const status = String(input.productStatus ?? '').trim().toLowerCase();
  if (status === 'archived') return 'discontinued';
  if (status && status !== 'active') return 'unavailable';
  if (!input.publishedAt) return 'unavailable';
  if (!input.inventoryManagement) return 'unknown';
  if (input.inventoryPolicy === 'deny') {
    return (input.quantity ?? 0) > 0 ? 'in_stock' : 'out_of_stock';
  }
  if (input.inventoryPolicy === 'continue') {
    return (input.quantity ?? 0) > 0 ? 'in_stock' : 'unknown';
  }
  return (input.quantity ?? 0) > 0 ? 'in_stock' : 'unknown';
}

export function mapShopifyProductToStockFacts(
  product: Record<string, unknown>,
  checkedAt = new Date().toISOString(),
): StockAvailabilityFact[] {
  const productId = String(product?.id ?? '').trim();
  const productTitle = String(product?.title ?? '').trim();
  if (!productId || !productTitle) return [];
  const productStatus = nullableString(product?.status);
  const publishedAt = nullableString(product?.published_at);
  const productHandle = nullableString(product?.handle);
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.map((variantRaw) => {
    const variant = variantRaw && typeof variantRaw === 'object'
      ? variantRaw as Record<string, unknown>
      : {};
    const quantity = numericQuantity(variant?.inventory_quantity);
    const inventoryPolicy = normalizeInventoryPolicy(variant?.inventory_policy);
    const inventoryManagement = nullableString(variant?.inventory_management);
    return {
      product_id: productId,
      product_title: productTitle,
      product_handle: productHandle,
      variant_id: nullableString(variant?.id),
      variant_title: nullableString(variant?.title) ?? 'Default Title',
      sku: nullableString(variant?.sku),
      state: stockStateForVariant({
        productStatus,
        publishedAt,
        quantity,
        inventoryPolicy,
        inventoryManagement,
      }),
      quantity,
      inventory_policy: inventoryPolicy,
      inventory_management: inventoryManagement,
      product_status: productStatus,
      published_at: publishedAt,
      source: 'shopify_live' as const,
      checked_at: checkedAt,
    };
  });
}

export class ShopifyProvider implements CommerceProvider {
  readonly providerName = 'shopify';

  private readonly shopDomain: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;

  constructor(config: ShopifyProviderConfig) {
    this.shopDomain = config.shopDomain;
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion;
  }

  // Convenience wrapper around shopifyFetch bound to this provider's credentials.
  private fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    return shopifyFetch<T>(
      this.shopDomain,
      this.accessToken,
      this.apiVersion,
      path,
      init,
    );
  }

  // --- Read operations ---

  // GET /admin/api/{version}/orders/{id}.json
  async getOrder(id: string): Promise<Order | null> {
    try {
      const payload = await this.fetch<{ order?: RawShopifyOrder }>(
        `orders/${id}.json`,
      );
      if (!payload?.order) return null;
      return mapOrder(payload.order);
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  // GET /admin/api/{version}/orders.json?name=1234&status=any
  // Shopify matches on order name (e.g. "#1234" or "1234")
  async getOrderByName(name: string): Promise<Order | null> {
    const normalized = name.replace(/^#/, '').trim();
    const params = new URLSearchParams({ name: normalized, status: 'any', limit: '5' });
    const payload = await this.fetch<{ orders?: RawShopifyOrder[] }>(
      `orders.json?${params}`,
    );
    if (!Array.isArray(payload?.orders) || payload.orders.length === 0) return null;
    // Shopify name filter is a prefix match — only an exact name match may be
    // treated as the customer's order. A prefix hit (e.g. #4435 for query
    // "443") is a DIFFERENT order; returning it would let facts and actions
    // target the wrong order, so no match means null.
    const exact = payload.orders.find(
      (o) => o.name === `#${normalized}` || o.name === normalized,
    );
    return exact ? mapOrder(exact) : null;
  }

  // GET /admin/api/{version}/orders.json?email=...&status=any
  async listOrdersByEmail(email: string, limit = 50): Promise<Order[]> {
    const params = new URLSearchParams({
      email: email.trim(),
      status: 'any',
      limit: String(limit),
    });
    const payload = await this.fetch<{ orders?: RawShopifyOrder[] }>(
      `orders.json?${params}`,
    );
    if (!Array.isArray(payload?.orders)) return [];
    return payload.orders.map(mapOrder);
  }

  // GET /admin/api/{version}/orders.json?phone=...&status=any
  // Note: Shopify REST does not natively support phone-based order search.
  // We fetch by status=any and filter client-side.
  async listOrdersByPhone(phone: string, limit = 50): Promise<Order[]> {
    const params = new URLSearchParams({
      status: 'any',
      limit: String(limit),
    });
    const payload = await this.fetch<{ orders?: RawShopifyOrder[] }>(
      `orders.json?${params}`,
    );
    if (!Array.isArray(payload?.orders)) return [];
    const normalised = phone.replace(/\D/g, '');
    return payload.orders
      .filter((order: RawShopifyOrder) => {
        const orderPhone = String(
          order?.shipping_address?.phone ??
          order?.billing_address?.phone ??
          order?.customer?.phone ??
          '',
        ).replace(/\D/g, '');
        return orderPhone && orderPhone === normalised;
      })
      .map(mapOrder);
  }

  // TODO: Implement full tracking enrichment (e.g. via Webshipper integration).
  // For now returns empty array — tracking data is available via Shopify fulfillments
  // on the order object itself (see mapOrder fulfillments field).
  async getTracking(_orderId: string): Promise<TrackingInfo[]> {
    return [];
  }

  // --- Write operations ---

  // POST /admin/api/{version}/orders/{id}/cancel.json
  async cancelOrder(
    id: string,
    opts: { reason?: string; notifyCustomer?: boolean } = {},
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (opts.reason) body.reason = opts.reason;
    if (opts.notifyCustomer !== undefined) body.email = opts.notifyCustomer;

    await this.fetch(`orders/${id}/cancel.json`, {
      method: 'POST',
      body: Object.keys(body).length ? JSON.stringify(body) : undefined,
    });
  }

  // POST /admin/api/{version}/orders/{id}/refunds.json
  async refundOrder(id: string, opts: RefundOpts): Promise<RefundResult> {
    const transactions = opts.amount != null
      ? [{ kind: 'refund', amount: opts.amount.toFixed(2) }]
      : [];

    const payload = await this.fetch<{ refund?: any }>(
      `orders/${id}/refunds.json`,
      {
        method: 'POST',
        body: JSON.stringify({
          refund: {
            notify: opts.notify_customer ?? true,
            ...(opts.note ? { note: opts.note } : {}),
            ...(opts.reason ? { reason: opts.reason } : {}),
            ...(transactions.length ? { transactions } : {}),
          },
        }),
      },
    );

    const refund = payload?.refund;
    return {
      id: String(refund?.id ?? ''),
      amount: String(refund?.transactions?.[0]?.amount ?? opts.amount ?? '0.00'),
      status: refund?.status ?? 'unknown',
    };
  }

  // PUT /admin/api/{version}/orders/{id}.json — shipping_address field
  async updateShippingAddress(id: string, address: Address): Promise<void> {
    await this.fetch(`orders/${id}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        order: {
          id,
          shipping_address: address,
        },
      }),
    });
  }

  // PUT /admin/api/{version}/orders/{id}.json — note field
  async addNote(id: string, note: string): Promise<void> {
    await this.fetch(`orders/${id}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        order: { id, note },
      }),
    });
  }

  // PUT /admin/api/{version}/orders/{id}.json — tags field.
  // Fetches existing tags first to avoid overwriting them (same pattern as
  // automation-actions.ts addTag helper).
  async addTag(id: string, tag: string): Promise<void> {
    const current = await this.fetch<{ order?: { tags?: string } }>(
      `orders/${id}.json`,
      { method: 'GET' },
    );

    const existingTags = (current.order?.tags ?? '')
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean);

    if (!existingTags.includes(tag)) {
      existingTags.push(tag);
    }

    await this.fetch(`orders/${id}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        order: { id, tags: existingTags.join(', ') },
      }),
    });
  }

  // POST /admin/api/{version}/fulfillment_orders/{fulfillmentOrderId}/hold.json
  // Requires fetching the fulfillment order id first.
  async holdFulfillment(id: string): Promise<void> {
    const fulfillmentOrderId = await this.getPrimaryFulfillmentOrderId(id);
    await this.fetch(
      `fulfillment_orders/${fulfillmentOrderId}/hold.json`,
      { method: 'POST' },
    );
  }

  // POST /admin/api/{version}/fulfillment_orders/{fulfillmentOrderId}/release_hold.json
  async releaseFulfillment(id: string): Promise<void> {
    const fulfillmentOrderId = await this.getPrimaryFulfillmentOrderId(id);
    await this.fetch(
      `fulfillment_orders/${fulfillmentOrderId}/release_hold.json`,
      { method: 'POST' },
    );
  }

  // Uses Shopify GraphQL orderEdit mutations (begin → setQuantity → commit).
  // Not yet implemented — full implementation requires GraphQL plumbing.
  async editLineItems(_id: string, _edits: LineItemEdit[]): Promise<void> {
    throw new Error('Not yet implemented: editLineItems requires GraphQL orderEdit mutations');
  }

  // PUT /admin/api/{version}/orders/{id}.json — email/phone fields
  async updateCustomerContact(
    id: string,
    opts: { email?: string; phone?: string },
  ): Promise<void> {
    if (!opts.email && !opts.phone) {
      throw new Error('updateCustomerContact: email or phone must be provided');
    }
    await this.fetch(`orders/${id}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        order: {
          id,
          ...(opts.email ? { email: opts.email } : {}),
          ...(opts.phone ? { phone: opts.phone } : {}),
        },
      }),
    });
  }

  // --- Inventory lookup ---

  // Search products by title and return inventory status per variant.
  // Used by fact_resolver when customer asks about product availability.
  async searchProductInventory(
    query: string,
  ): Promise<StockAvailabilityFact[]> {
    const result = await this.searchProductInventoryWithDiagnostics(query);
    return result.facts;
  }

  async searchProductInventoryWithDiagnostics(
    query: string,
  ): Promise<{
    facts: StockAvailabilityFact[];
    diagnostics: ShopifyProductInventoryLookupDiagnostics;
  }> {
    try {
      const encoded = encodeURIComponent(query.slice(0, 100));
      // status MUST be a products-endpoint value (active|archived|draft).
      // "any" is an ORDERS-only filter — passing it to products.json makes
      // Shopify return zero, which is why orders worked but product/stock
      // lookup returned nothing. Align with knowledge sync-products: status=active.
      const payload = await this.fetch<{ products?: Array<Record<string, unknown>> }>(
        `products.json?title=${encoded}&status=active&limit=5&fields=id,title,handle,status,published_at,variants`,
      );
      const products = payload?.products ?? [];
      const checkedAt = new Date().toISOString();
      if (products.length > 0) {
        const diagnostics = productLookupDiagnostics(query, {
          titleProducts: products,
          listFallbackAttempted: false,
          listFallbackProductCount: 0,
          matchedProducts: products,
        });
        if (matchedProductsLackInventory(products)) {
          diagnostics.error_reason = "missing_read_inventory_scope";
        }
        return {
          facts: products.flatMap((product) =>
            mapShopifyProductToStockFacts(product, checkedAt)
          ),
          diagnostics,
        };
      }

      const fallbackPayload = await this.fetch<{ products?: Array<Record<string, unknown>> }>(
        `products.json?status=active&limit=250&fields=id,title,handle,status,published_at,variants`,
      );
      const listedProducts = fallbackPayload?.products ?? [];
      const fallbackProducts = selectShopifyProductsForStockQuery(
        query,
        listedProducts,
      );
      const diagnostics = productLookupDiagnostics(query, {
        titleProducts: products,
        listFallbackAttempted: true,
        listFallbackProductCount: listedProducts.length,
        matchedProducts: fallbackProducts,
      });
      // No active products at all in the store → distinct reason (empty/wrong
      // shop context), not a mere title miss.
      if (listedProducts.length === 0) {
        diagnostics.error_reason = "shopify_returned_zero_products";
      } else if (matchedProductsLackInventory(fallbackProducts)) {
        // Product identified, but no variant exposes inventory_quantity → the
        // token is missing read_inventory. Identity is usable; stock is unknown.
        diagnostics.error_reason = "missing_read_inventory_scope";
      }
      return {
        facts: fallbackProducts.flatMap((product) =>
          mapShopifyProductToStockFacts(product, checkedAt)
        ),
        diagnostics,
      };
    } catch (err) {
      const { error_reason, http_status } = classifyShopifyLookupError(err);
      const diagnostics = productLookupDiagnostics(query, {
        titleProducts: [],
        listFallbackAttempted: false,
        listFallbackProductCount: 0,
        matchedProducts: [],
      });
      diagnostics.error_reason = error_reason;
      diagnostics.http_status = http_status;
      return { facts: [], diagnostics };
    }
  }

  // --- Capability check ---

  // Shopify supports all defined action types.
  supportsAction(_type: ActionType): boolean {
    return true;
  }

  // --- Private helpers ---

  // GET /admin/api/{version}/orders/{orderId}/fulfillment_orders.json
  // Returns the first fulfillment order id — used by holdFulfillment / releaseFulfillment.
  private async getPrimaryFulfillmentOrderId(orderId: string): Promise<number> {
    const payload = await this.fetch<{
      fulfillment_orders?: Array<{ id?: number }>;
    }>(`orders/${orderId}/fulfillment_orders.json`);

    const fulfillmentOrders = Array.isArray(payload?.fulfillment_orders)
      ? payload.fulfillment_orders
      : [];

    const firstId = fulfillmentOrders[0]?.id;
    if (!firstId) {
      throw Object.assign(
        new Error(`No fulfillment order found for order ${orderId}`),
        { status: 404 },
      );
    }
    return firstId;
  }
}
