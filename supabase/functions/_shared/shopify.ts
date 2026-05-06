import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptShopifyToken, getShopCredentialsForUser } from "./shopify-credentials.ts";

export type ShopifyOrder = Record<string, any>;

type ShopifyOrderFetcher = (email?: string | null) => Promise<ShopifyOrder[] | null>;

type FetchOrdersOptions = {
  supabase: SupabaseClient | null;
  userId?: string | null;
  workspaceId?: string | null;
  email?: string | null;
  orderNumber?: string | null;
  limit?: number;
  tokenSecret?: string | null;
  apiVersion: string;
  pageInfo?: string | null;
};

type WebshipperContext = {
  baseUrl: string;
  token: string;
};

type WebshipperTracking = {
  source: "webshipper";
  status?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  status_code?: string | null;
  delivered_at?: string | null;
  out_for_delivery_at?: string | null;
  pickup_ready_at?: string | null;
  pickup_point?: {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
  last_event?: {
    code?: string | null;
    description?: string | null;
    occurred_at?: string | null;
    location?: string | null;
  } | null;
  events?: Array<{
    code?: string | null;
    description?: string | null;
    occurred_at?: string | null;
    location?: string | null;
    pickup_point?: {
      name?: string | null;
      address?: string | null;
      city?: string | null;
      postal_code?: string | null;
      country?: string | null;
    } | null;
  }>;
};

async function fetchShopifyOrdersPage(options: FetchOrdersOptions): Promise<{
  orders: ShopifyOrder[];
  nextPageInfo: string | null;
}> {
  const {
    supabase,
    userId,
    workspaceId,
    email,
    orderNumber,
    limit = 50,
    apiVersion,
    pageInfo = null,
  } = options;

  if (!supabase || !userId) {
    return { orders: [], nextPageInfo: null };
  }

  try {
    const data = await getShopCredentialsForUser({
      supabase,
      userId,
      workspaceId,
    });

    const domain = data.shop_domain.replace(/^https?:\/\//, "");
    const url = new URL(`https://${domain}/admin/api/${apiVersion}/orders.json`);
    if (pageInfo) {
      url.searchParams.set("page_info", pageInfo);
    } else {
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("status", "any");
      if (email?.trim()) {
        url.searchParams.set("email", email.trim());
      }
      if (orderNumber?.trim()) {
        url.searchParams.set("name", `#${orderNumber.trim().replace(/^#/, "")}`);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": data.access_token,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      console.warn("shopify-shared: orders slog fejl", response.status, text);
      return { orders: [], nextPageInfo: null };
    }
    const payload = await response.json().catch(() => null);
    const linkHeader = response.headers.get("link") ?? "";
    const nextPageInfo = extractNextPageInfo(linkHeader);
    return {
      orders: Array.isArray(payload?.orders) ? payload.orders : [],
      nextPageInfo,
    };
  } catch (err) {
    console.warn("shopify-shared: fetch exception", err);
    return { orders: [], nextPageInfo: null };
  }
}

// Henter en side af ordrer (anvendes til både enkel fetch og pagination)
export async function fetchShopifyOrders(
  options: FetchOrdersOptions,
): Promise<ShopifyOrder[]> {
  const { orders } = await fetchShopifyOrdersPage(options);
  return orders;
}

// Udtrækker et muligt ordrenummer fra emnefeltet (fx "Ordre 1234")
export function extractSubjectNumber(subject?: string | null): string | null {
  if (!subject) return null;
  const text = String(subject || "");
  const explicitMatch = text.match(
    /\b(?:ordre|order)\s*(?:nr\.?|number)?\s*#?\s*(\d{3,})\b/i,
  );
  if (explicitMatch?.[1]) return explicitMatch[1];
  const hashMatch = text.match(/#\s*(\d{3,})\b/);
  return hashMatch?.[1] || null;
}

// Tjekker om en ordre indeholder kandidatnummeret i kendte id-felter
export function matchesOrderNumber(order: any, candidate: string): boolean {
  const normalizedCandidate = String(candidate || "").replace(/\D/g, "");
  if (!normalizedCandidate) return false;
  const orderNumber = String(order?.order_number ?? "").replace(/\D/g, "");
  if (orderNumber && orderNumber === normalizedCandidate) return true;
  const legacyOrderNumber = String(order?.legacy_order?.order_number ?? "").replace(/\D/g, "");
  if (legacyOrderNumber && legacyOrderNumber === normalizedCandidate) return true;
  const name = String(order?.name || "");
  if (!name) return false;
  if (new RegExp(`#\\s*${normalizedCandidate}(?:\\b|\\D)`, "i").test(name)) return true;
  const nameDigits = name.replace(/\D/g, "");
  return Boolean(nameDigits) && nameDigits === normalizedCandidate;
}

function buildTrackingKey(order: ShopifyOrder) {
  return (
    (order?.id ? String(order.id) : null) ||
    (order?.order_number ? String(order.order_number) : null) ||
    (order?.name ? String(order.name) : null)
  );
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeIso(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString();
}

function decodeByteaToText(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    if (!value.startsWith("\\x")) return value;
    const hex = value.slice(2);
    if (!hex) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
    }
    return new TextDecoder().decode(bytes);
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  return null;
}

function buildWebshipperApiBase(tenant: string): string | null {
  const raw = String(tenant || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!raw) return null;
  const withoutApiSuffix = raw.replace(/\.api\.webshipper\.io$/i, "");
  const host = withoutApiSuffix.endsWith(".webshipper.io")
    ? withoutApiSuffix.replace(/\.webshipper\.io$/i, ".api.webshipper.io")
    : `${withoutApiSuffix}.api.webshipper.io`;
  return `https://${host}/v2`;
}

function webshipperHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
  };
}

async function resolveWebshipperContext(options: {
  supabase: SupabaseClient | null;
  userId?: string | null;
  workspaceId?: string | null;
  tokenSecret?: string | null;
}): Promise<WebshipperContext | null> {
  const { supabase, userId, workspaceId, tokenSecret } = options;
  if (!supabase || !userId) return null;

  let integration:
    | {
        config?: Record<string, unknown> | null;
        credentials_enc?: unknown;
        is_active?: boolean | null;
      }
    | null = null;

  if (workspaceId) {
    const { data } = await supabase
      .from("integrations")
      .select("config,credentials_enc,is_active")
      .eq("provider", "webshipper")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .maybeSingle();
    integration = data;
  }

  if (!integration) {
    const { data } = await supabase
      .from("integrations")
      .select("config,credentials_enc,is_active")
      .eq("provider", "webshipper")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    integration = data;
  }

  if (!integration || integration.is_active !== true) return null;
  const tenant = asString(integration?.config?.tenant);
  if (!tenant) return null;
  const baseUrl = buildWebshipperApiBase(tenant);
  if (!baseUrl) return null;

  const encoded = decodeByteaToText(integration.credentials_enc);
  if (!encoded) return null;

  let token = "";
  try {
    token = await decryptShopifyToken(encoded, tokenSecret);
  } catch {
    token = encoded;
  }
  token = token.trim();
  if (!token) return null;

  return { baseUrl, token };
}

function parsePickupPoint(value: unknown): WebshipperTracking["pickup_point"] {
  const obj = asObject(value);
  if (!obj) return null;
  const name = asString(obj.name || obj.title || obj.pickup_point_name) || null;
  const address = asString(obj.address || obj.address1 || obj.street || obj.street_name) || null;
  const city = asString(obj.city || obj.town) || null;
  const postal_code = asString(obj.postal_code || obj.zip || obj.zip_code) || null;
  const country = asString(obj.country || obj.country_code) || null;
  if (!name && !address && !city && !postal_code && !country) return null;
  return { name, address, city, postal_code, country };
}

function parseTrackingEvent(value: unknown): NonNullable<WebshipperTracking["events"]>[number] | null {
  const obj = asObject(value);
  if (!obj) return null;
  const attrs = asObject(obj.attributes) || obj;
  const code = asString(attrs.code || attrs.event_code || attrs.status_code || attrs.status) || null;
  const description =
    asString(attrs.description || attrs.label || attrs.status_text || attrs.message || attrs.title) ||
    null;
  const occurred_at =
    normalizeIso(
      attrs.occurred_at || attrs.created_at || attrs.updated_at || attrs.event_time || attrs.timestamp,
    ) || null;
  const location =
    asString(
      attrs.location ||
        attrs.city ||
        attrs.depot ||
        attrs.location_name ||
        attrs.hub ||
        attrs.terminal,
    ) || null;
  const pickup_point =
    parsePickupPoint(
      attrs.pickup_point || attrs.pickup || attrs.parcel_shop || attrs.service_point || attrs.drop_point,
    ) || null;
  if (!code && !description && !occurred_at && !location && !pickup_point) return null;
  return { code, description, occurred_at, location, pickup_point };
}

function collectTrackingEvents(record: any, included: unknown[]): NonNullable<WebshipperTracking["events"]> {
  const events: NonNullable<WebshipperTracking["events"]> = [];
  const attrs = asObject(record?.attributes) || asObject(record) || {};

  const localCandidates = [
    ...asArray((attrs as Record<string, unknown>)?.events),
    ...asArray((attrs as Record<string, unknown>)?.tracking_events),
    ...asArray((attrs as Record<string, unknown>)?.event_timeline),
    ...asArray((attrs as Record<string, unknown>)?.timeline),
    ...asArray((attrs as Record<string, unknown>)?.history),
    ...asArray((attrs as Record<string, unknown>)?.tracking_history),
  ];
  for (const candidate of localCandidates) {
    const parsed = parseTrackingEvent(candidate);
    if (parsed) events.push(parsed);
  }

  for (const resource of included) {
    const type = asString((resource as any)?.type).toLowerCase();
    if (!type) continue;
    if (!type.includes("event") && !type.includes("tracking")) continue;
    const parsed = parseTrackingEvent(resource);
    if (parsed) events.push(parsed);
  }

  const unique = new Map<string, NonNullable<WebshipperTracking["events"]>[number]>();
  for (const event of events) {
    const key = `${event.code || ""}|${event.description || ""}|${event.occurred_at || ""}|${
      event.location || ""
    }`;
    if (!unique.has(key)) unique.set(key, event);
  }
  return Array.from(unique.values()).sort((a, b) =>
    String(a.occurred_at || "").localeCompare(String(b.occurred_at || "")),
  );
}

function extractTrackingFromObject(value: any, included: unknown[] = []): WebshipperTracking | null {
  if (!value || typeof value !== "object") return null;
  const attrs = value?.attributes && typeof value.attributes === "object" ? value.attributes : value;
  const carrier =
    asString(attrs?.carrier_name) ||
    asString(attrs?.carrier) ||
    asString(attrs?.shipping_company) ||
    asString(attrs?.provider);
  const trackingNumber =
    asString(attrs?.tracking_number) ||
    asString(attrs?.tracking_no) ||
    asString(attrs?.tracking_code) ||
    asString(attrs?.tracking);
  const trackingUrl =
    asString(attrs?.tracking_url) ||
    asString(attrs?.tracking_link) ||
    asString(attrs?.track_trace_url) ||
    asString(attrs?.trackingUrl);
  const status = asString(attrs?.status_text) || asString(attrs?.status);
  const statusCode = asString(attrs?.status_code) || asString(attrs?.shipment_status) || "";
  const deliveredAt =
    normalizeIso(attrs?.delivered_at || attrs?.deliveredAt || attrs?.delivery_time) || null;
  const outForDeliveryAt =
    normalizeIso(
      attrs?.out_for_delivery_at || attrs?.outForDeliveryAt || attrs?.out_for_delivery_time,
    ) || null;
  const pickupReadyAt =
    normalizeIso(attrs?.pickup_ready_at || attrs?.pickupReadyAt || attrs?.ready_for_pickup_at) || null;
  const pickupPoint =
    parsePickupPoint(
      attrs?.pickup_point || attrs?.pickup || attrs?.parcel_shop || attrs?.service_point || attrs?.drop_point,
    ) || null;
  const events = collectTrackingEvents(value, included);
  const lastEvent = events.length ? events[events.length - 1] : null;

  if (
    !trackingNumber &&
    !trackingUrl &&
    !status &&
    !statusCode &&
    !deliveredAt &&
    !outForDeliveryAt &&
    !pickupReadyAt &&
    !events.length
  ) {
    return null;
  }
  return {
    source: "webshipper",
    status: status || null,
    carrier: carrier || null,
    tracking_number: trackingNumber || null,
    tracking_url: trackingUrl || null,
    status_code: statusCode || null,
    delivered_at: deliveredAt,
    out_for_delivery_at: outForDeliveryAt,
    pickup_ready_at: pickupReadyAt,
    pickup_point: pickupPoint,
    last_event: lastEvent
      ? {
          code: lastEvent.code || null,
          description: lastEvent.description || null,
          occurred_at: lastEvent.occurred_at || null,
          location: lastEvent.location || null,
        }
      : null,
    events,
  };
}

function collectOrderRefs(order: ShopifyOrder): string[] {
  const rawRefs = [
    asString(order?.name),
    order?.order_number != null ? String(order.order_number) : "",
    asString(order?.legacy_order?.order_number),
  ].filter(Boolean);
  const refs = new Set<string>();
  for (const raw of rawRefs) {
    const plain = raw.replace(/^#+/, "").trim();
    if (!plain) continue;
    refs.add(raw.trim());
    refs.add(plain);
    refs.add(`#${plain}`);
    refs.add(`##${plain}`);
  }
  return Array.from(refs);
}

async function fetchWebshipperTrackingForOrder(
  context: WebshipperContext,
  order: ShopifyOrder,
): Promise<WebshipperTracking | null> {
  const refs = collectOrderRefs(order);
  if (!refs.length) return null;

  for (const ref of refs) {
    const searchUrl = new URL(`${context.baseUrl}/orders`);
    searchUrl.searchParams.set("filter[visible_ref]", ref);
    const response = await fetch(searchUrl.toString(), {
      method: "GET",
      headers: webshipperHeaders(context.token),
    }).catch(() => null);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => null);
    const record = Array.isArray(payload?.data) ? payload.data[0] : null;
    const parsed = extractTrackingFromObject(record, asArray(payload?.included));
    if (parsed) return parsed;
  }

  return null;
}

async function attachWebshipperTracking(options: {
  supabase: SupabaseClient | null;
  userId?: string | null;
  workspaceId?: string | null;
  tokenSecret?: string | null;
  orders: ShopifyOrder[];
}) {
  const { supabase, userId, workspaceId, tokenSecret, orders } = options;
  if (!orders.length) return;
  const context = await resolveWebshipperContext({
    supabase,
    userId,
    workspaceId,
    tokenSecret,
  });
  if (!context) return;

  const maxLookups = Math.min(orders.length, 8);
  await Promise.all(
    orders.slice(0, maxLookups).map(async (order) => {
      try {
        const tracking = await fetchWebshipperTrackingForOrder(context, order);
        if (tracking) {
          order.webshipper_tracking = tracking;
        }
      } catch {
        // Best effort: fail silently and keep Shopify-only context.
      }
    }),
  );
}

function extractNextPageInfo(linkHeader: string): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    if (part.includes('rel="next"')) {
      const match = part.match(/<([^>]+)>/);
      if (!match?.[1]) continue;
      try {
        const url = new URL(match[1]);
        return url.searchParams.get("page_info");
      } catch {
        continue;
      }
    }
  }
  return null;
}

// Samler et kort resume af op til 5 ordrer til prompts
export function buildOrderSummary(orders: ShopifyOrder[]): string {
  if (!orders?.length) {
    return "Ingen relaterede ordrer fundet. Afsenderens e-mailadresse gav ingen match i Shopify — der er ingen ordredata at slå op. Spørg kunden direkte om ordrenummer eller kvittering/købsbevis. Lov IKKE at gennemgå ordredetaljer internt, da der ikke eksisterer nogen.\n";
  }
  let summary = `Kunden har ${orders.length} relevante ordre(r):\n`;
  for (const order of orders.slice(0, 5)) {
    const friendlyId =
      order?.order_number ?? order?.name ?? (order?.id ? String(order.id) : "ukendt");
    const status = order?.fulfillment_status ?? order?.financial_status ?? "ukendt";
    const total = order?.total_price ?? order?.current_total_price ?? "ukendt";
    const orderDate = formatShopifyTimestamp(order?.processed_at || order?.created_at);
    summary += `- Ordre ${friendlyId} (id:${order?.id ?? "ukendt"}) — status: ${status} — total: ${total}${orderDate ? ` — bestilt: ${orderDate}` : ""}\n`;
    if (order?.shipping_address) {
      summary += `  Adresse: ${[
        order.shipping_address?.name,
        order.shipping_address?.address1,
        order.shipping_address?.address2,
        order.shipping_address?.zip,
        order.shipping_address?.city,
        order.shipping_address?.country,
      ]
        .filter(Boolean)
        .join(", ")}\n`;
    }
    if (Array.isArray(order?.line_items) && order.line_items.length) {
      const lines = order.line_items
        .slice(0, 2)
        .map((item: any) => {
          const qty = typeof item?.quantity === "number" ? item.quantity : 1;
          const title = item?.title ?? item?.name ?? "Vare";
          const lineId =
            item?.admin_graphql_api_id ??
            (item?.id ? `gid://shopify/LineItem/${item.id}` : null);
          const variantId =
            item?.variant_admin_graphql_api_id ??
            (item?.variant_id ? `gid://shopify/ProductVariant/${item.variant_id}` : null);
          const refs = [
            lineId ? `line_item_id=${lineId}` : null,
            variantId ? `variant_id=${variantId}` : null,
          ]
            .filter(Boolean)
            .join(", ");
          return refs ? `${qty}× ${title} [${refs}]` : `${qty}× ${title}`;
        })
        .filter(Boolean);
      if (lines.length) {
        const extra = order.line_items.length > lines.length ? ` (+${order.line_items.length - lines.length} flere)` : "";
        summary += `  Varer: ${lines.join(", ")}${extra}\n`;
      }
    }
    const fulfilText = formatFulfillmentStatus(order);
    if (fulfilText) {
      summary += `  Levering: ${fulfilText}\n`;
    }
    const trackingText = formatTrackingStatus(order);
    if (trackingText) {
      summary += `  Tracking: ${trackingText}\n`;
    }
  }
  return summary;
}

function formatTrackingStatus(order: ShopifyOrder): string {
  const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
  const numbers = new Set<string>();
  const urls = new Set<string>();
  let carrier = "";

  for (const fulfillment of fulfillments) {
    const oneNumber = asString(fulfillment?.tracking_number);
    if (oneNumber) numbers.add(oneNumber);
    const manyNumbers = Array.isArray(fulfillment?.tracking_numbers) ? fulfillment.tracking_numbers : [];
    for (const value of manyNumbers) {
      const parsed = asString(value);
      if (parsed) numbers.add(parsed);
    }
    const oneUrl = asString(fulfillment?.tracking_url);
    if (oneUrl) urls.add(oneUrl);
    const manyUrls = Array.isArray(fulfillment?.tracking_urls) ? fulfillment.tracking_urls : [];
    for (const value of manyUrls) {
      const parsed = asString(value);
      if (parsed) urls.add(parsed);
    }
    if (!carrier) {
      carrier = asString(fulfillment?.tracking_company) || asString(fulfillment?.shipment_status);
    }
  }

  if (!numbers.size && !urls.size && order?.webshipper_tracking) {
    const webshipper = order.webshipper_tracking as WebshipperTracking;
    const wsNumber = asString(webshipper?.tracking_number);
    const wsUrl = asString(webshipper?.tracking_url);
    const wsCarrier = asString(webshipper?.carrier);
    const wsStatus = asString(webshipper?.status);
    if (wsNumber) numbers.add(wsNumber);
    if (wsUrl) urls.add(wsUrl);
    if (!carrier) carrier = wsCarrier;
    const textParts = [
      carrier || "ukendt carrier",
      wsNumber || "",
      wsStatus ? `(status: ${wsStatus})` : "",
      wsUrl ? `- ${wsUrl}` : "",
    ].filter(Boolean);
    return textParts.join(" ");
  }

  if (!numbers.size && !urls.size) return "";
  const textParts = [
    carrier || "shopify",
    numbers.size ? Array.from(numbers).join(", ") : "",
    urls.size ? `- ${Array.from(urls).join(" | ")}` : "",
  ].filter(Boolean);
  return textParts.join(" ");
}

function formatFulfillmentStatus(order: ShopifyOrder) {
  const status = String(order?.fulfillment_status ?? "").toLowerCase();
  const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
  const firstFulfillment = fulfillments[0];
  const timestamp = formatShopifyTimestamp(firstFulfillment?.updated_at || firstFulfillment?.created_at);
  const location = firstFulfillment?.destination?.city || firstFulfillment?.tracking_company;

  if (status === "fulfilled") {
    return `Markeret som leveret${timestamp ? ` (${timestamp})` : ""}${location ? ` – ${location}` : ""}`;
  }
  if (status === "in_transit" || status === "partial") {
    return `Undervejs${timestamp ? ` (senest opdateret ${timestamp})` : ""}`;
  }
  if (!status || status === "null" || status === "unfulfilled") {
    if (firstFulfillment?.status === "success") {
      return `Fulfillment succesfuld${timestamp ? ` (${timestamp})` : ""}`;
    }
    return "Ikke sendt endnu";
  }
  return status;
}

function formatShopifyTimestamp(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleString("da-DK", {
      timeZone: "Europe/Copenhagen",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return date.toISOString();
  }
}

// Finder relaterede ordrer ud fra email/subject og bygger kort over id'er
export async function resolveOrderContext(options: {
  supabase: SupabaseClient | null;
  userId?: string | null;
  workspaceId?: string | null;
  email?: string | null;
  subject?: string | null;
  tokenSecret?: string | null;
  apiVersion: string;
  fetcher?: ShopifyOrderFetcher | null;
  limit?: number;
}): Promise<{
  orders: ShopifyOrder[];
  matchedSubjectNumber: string | null;
  orderIdMap: Record<string, number>;
}> {
  const {
    supabase,
    userId,
    workspaceId,
    email,
    subject,
    tokenSecret,
    apiVersion,
    fetcher,
    limit = 50,
  } = options;

  const subjectNumber = extractSubjectNumber(subject);
  const lookupTrace: Array<Record<string, unknown>> = [];

  const fetchOrders = async (
    candidateEmail?: string | null,
    candidateOrderNumber?: string | null,
    label = "lookup",
  ) => {
    if (typeof fetcher === "function") {
      try {
        const result = await fetcher(candidateEmail);
        if (Array.isArray(result)) {
          const filtered = candidateOrderNumber
            ? result.filter((order) => matchesOrderNumber(order, candidateOrderNumber))
            : result;
          lookupTrace.push({
            label,
            source: "custom_fetcher",
            email: candidateEmail || null,
            order_number: candidateOrderNumber || null,
            orders_count: filtered.length,
          });
          return filtered;
        }
      } catch (err) {
        console.warn("shopify-shared: custom fetcher fejlede", err);
        lookupTrace.push({
          label,
          source: "custom_fetcher",
          email: candidateEmail || null,
          order_number: candidateOrderNumber || null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const fetched = await fetchShopifyOrders({
      supabase,
      userId,
      workspaceId,
      email: candidateEmail,
      orderNumber: candidateOrderNumber,
      tokenSecret,
      apiVersion,
      limit,
    });
    lookupTrace.push({
      label,
      source: "shopify_orders_api",
      email: candidateEmail || null,
      order_number: candidateOrderNumber || null,
      orders_count: fetched.length,
    });
    return fetched;
  };

  let orders = subjectNumber
    ? await fetchOrders(email, subjectNumber, "initial_email_and_subject_lookup")
    : await fetchOrders(email, null, "initial_email_lookup");
  let matchedSubjectNumber: string | null = null;

  const hasSubjectNumber = !!subjectNumber;
  const subjectMatchFound =
    hasSubjectNumber && orders.some((order) => matchesOrderNumber(order, subjectNumber!));

  if (hasSubjectNumber && !subjectMatchFound) {
    const directOrderMatches = await fetchOrders(null, subjectNumber, "subject_only_lookup");
    if (directOrderMatches.length) {
      orders = directOrderMatches;
    }
  }

  const subjectMatchFoundAfterDirectLookup =
    hasSubjectNumber && orders.some((order) => matchesOrderNumber(order, subjectNumber!));

  if (hasSubjectNumber && !subjectMatchFoundAfterDirectLookup) {
    const matched = await fetchAcrossPages({
      supabase,
      userId,
      workspaceId,
      tokenSecret,
      apiVersion,
      predicate: (order) => matchesOrderNumber(order, subjectNumber!),
      limit,
    });
    if (matched.length) {
      orders = matched;
    }
  }

  if (hasSubjectNumber && orders.some((order) => matchesOrderNumber(order, subjectNumber!))) {
    matchedSubjectNumber = subjectNumber!;
  }

  const hasEmail = !!email;
  const hasMatchedSubjectOrder =
    hasSubjectNumber && orders.some((order) => matchesOrderNumber(order, subjectNumber!));
  const emailMatchFound = hasEmail ? orders.some((order) => matchesOrderEmail(order, email)) : false;
  if (hasEmail && !emailMatchFound && !hasMatchedSubjectOrder) {
    orders = await fetchAcrossPages({
      supabase,
      userId,
      workspaceId,
      tokenSecret,
      apiVersion,
      predicate: (order) => matchesOrderEmail(order, email),
      limit,
    });
    lookupTrace.push({
      label: "email_pagination_fallback",
      source: "shopify_orders_api",
      email: email || null,
      order_number: null,
      orders_count: orders.length,
    });
  }

  console.log("shopify-shared: resolveOrderContext trace", {
    email: email || null,
    subject_number: subjectNumber || null,
    matched_subject_number: matchedSubjectNumber || null,
    final_orders_count: orders.length,
    lookup_trace: lookupTrace,
  });

  await attachWebshipperTracking({
    supabase,
    userId,
    workspaceId,
    tokenSecret,
    orders,
  });

  const orderIdMap: Record<string, number> = {};
  for (const order of orders) {
    const internalId = typeof order?.id === "number" ? order.id : Number(order?.id);
    if (!internalId || Number.isNaN(internalId)) continue;
    const keys = new Set<string>();
    if (order?.order_number) keys.add(String(order.order_number));
    if (order?.name) keys.add(String(order.name).replace("#", ""));
    if (order?.legacy_order?.order_number) keys.add(String(order.legacy_order.order_number));
    keys.add(String(internalId));
    for (const key of keys) {
      if (!orderIdMap[key]) {
        orderIdMap[key] = internalId;
      }
    }
  }

  return { orders, matchedSubjectNumber, orderIdMap };
}

function matchesOrderEmail(order: any, targetEmail: string): boolean {
  if (!targetEmail) return false;
  const lower = targetEmail.toLowerCase();
  return collectOrderEmails(order).some((email) => email === lower);
}

function collectOrderEmails(order: any): string[] {
  const emails = [
    order?.email,
    order?.customer?.email,
    order?.billing_address?.email,
    order?.shipping_address?.email,
  ]
    .filter(Boolean)
    .map((value: string) => value.toLowerCase());
  return Array.from(new Set(emails));
}

type FetchAcrossPagesOptions = {
  supabase: SupabaseClient | null;
  userId?: string | null;
  workspaceId?: string | null;
  tokenSecret?: string | null;
  apiVersion: string;
  predicate: (order: ShopifyOrder) => boolean;
  limit?: number;
  maxPages?: number;
};

// Itererer over flere Shopify-sider indtil predicate matcher eller siderne slipper op
async function fetchAcrossPages(options: FetchAcrossPagesOptions): Promise<ShopifyOrder[]> {
  const {
    supabase,
    userId,
    workspaceId,
    tokenSecret,
    apiVersion,
    predicate,
    limit = 250,
    maxPages = 40,
  } = options;
  let pageInfo: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const { orders, nextPageInfo } = await fetchShopifyOrdersPage({
      supabase,
      userId,
      workspaceId,
      tokenSecret,
      apiVersion,
      limit,
      pageInfo,
    });
    const matched = orders.filter(predicate);
    if (matched.length) {
      return matched;
    }
    if (!nextPageInfo) {
      break;
    }
    pageInfo = nextPageInfo;
  }
  return [];
}
