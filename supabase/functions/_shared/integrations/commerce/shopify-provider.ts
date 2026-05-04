import type {
  CommerceProvider,
  Order,
  TrackingInfo,
  Address,
  RefundOpts,
  RefundResult,
  LineItemEdit,
  ActionType,
} from './types.ts';

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
    tags: raw.tags ?? undefined,
    note: raw.note ?? undefined,
  };
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
    // Shopify name filter is a prefix match — verify exact match
    const exact = payload.orders.find(
      (o) => o.name === `#${normalized}` || o.name === normalized,
    );
    return exact ? mapOrder(exact) : mapOrder(payload.orders[0]);
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
  ): Promise<Array<{ title: string; variant: string; available: boolean; quantity: number }>> {
    try {
      const encoded = encodeURIComponent(query.slice(0, 100));
      const payload = await this.fetch<{ products?: Array<Record<string, unknown>> }>(
        `products.json?title=${encoded}&limit=5&fields=id,title,variants`,
      );
      const products = payload?.products ?? [];
      const results: Array<{ title: string; variant: string; available: boolean; quantity: number }> = [];
      for (const product of products) {
        const title = String(product.title ?? "");
        const variants = Array.isArray(product.variants) ? product.variants : [];
        for (const v of variants) {
          const qty = Number(v.inventory_quantity ?? 0);
          results.push({
            title,
            variant: String(v.title ?? "Default"),
            available: qty > 0,
            quantity: qty,
          });
        }
      }
      return results;
    } catch {
      return [];
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
