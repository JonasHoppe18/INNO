import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getShopCredentialsForUser } from "./shopify-credentials.ts";

export type ShopifyOrder = Record<string, any>;

type ShopifyOrderFetcher = (email?: string | null) => Promise<ShopifyOrder[] | null>;

type FetchOrdersOptions = {
  supabase: SupabaseClient | null;
  userId?: string | null;
  workspaceId?: string | null;
  email?: string | null;
  limit?: number;
  tokenSecret?: string | null;
  apiVersion: string;
  pageInfo?: string | null;
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
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("status", "any");
    if (pageInfo) {
      url.searchParams.set("page_info", pageInfo);
    } else if (email?.trim()) {
      url.searchParams.set("email", email.trim());
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
  const match =
    subject.match(/(?:ordre|order)?\s*#?\s*(\d{3,})/i) ?? subject.match(/(\d{3,})/);
  return match ? match[1] : null;
}

// Tjekker om en ordre indeholder kandidatnummeret i kendte id-felter
export function matchesOrderNumber(order: any, candidate: string): boolean {
  const values = [
    order?.name,
    order?.order_number,
    order?.id,
    order?.number,
    order?.legacy_order?.order_number,
  ];
  return values.some((value) => {
    if (!value && value !== 0) return false;
    const str = String(value);
    if (str.includes(candidate)) return true;
    const digits = str.replace(/\D/g, "");
    return digits ? digits.includes(candidate) : false;
  });
}

function buildTrackingKey(order: ShopifyOrder) {
  return (
    (order?.id ? String(order.id) : null) ||
    (order?.order_number ? String(order.order_number) : null) ||
    (order?.name ? String(order.name) : null)
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
    return "Ingen relaterede ordrer fundet.\n";
  }
  let summary = `Kunden har ${orders.length} relevante ordre(r):\n`;
  for (const order of orders.slice(0, 5)) {
    const friendlyId =
      order?.order_number ?? order?.name ?? (order?.id ? String(order.id) : "ukendt");
    const status = order?.fulfillment_status ?? order?.financial_status ?? "ukendt";
    const total = order?.total_price ?? order?.current_total_price ?? "ukendt";
    summary += `- Ordre ${friendlyId} (id:${order?.id ?? "ukendt"}) — status: ${status} — total: ${total}\n`;
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
  }
  return summary;
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

  const fetchOrders = async (candidateEmail?: string | null) => {
    if (typeof fetcher === "function") {
      try {
        const result = await fetcher(candidateEmail);
        if (Array.isArray(result)) {
          return result;
        }
      } catch (err) {
        console.warn("shopify-shared: custom fetcher fejlede", err);
      }
    }
    return await fetchShopifyOrders({
      supabase,
      userId,
      workspaceId,
      email: candidateEmail,
      tokenSecret,
      apiVersion,
      limit,
    });
  };

  let orders = await fetchOrders(email);
  let matchedSubjectNumber: string | null = null;

  const hasEmail = !!email;
  const emailMatchFound = hasEmail ? orders.some((order) => matchesOrderEmail(order, email)) : false;
  if (hasEmail && !emailMatchFound) {
    orders = await fetchAcrossPages({
      supabase,
      userId,
      workspaceId,
      tokenSecret,
      apiVersion,
      predicate: (order) => matchesOrderEmail(order, email),
      limit,
    });
  }

  const hasSubjectNumber = !!subjectNumber;
  const subjectMatchFound =
    hasSubjectNumber && orders.some((order) => matchesOrderNumber(order, subjectNumber!));

  if (hasSubjectNumber && !subjectMatchFound) {
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
