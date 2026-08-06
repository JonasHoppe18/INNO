import {
  mapShopifyOrderFact,
  mapShopifyRefundFact,
  mapShopifyReturnFact,
  shopifyGidToId,
} from "./shopify-analytics.js";

const DEFAULT_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";
const DEFAULT_DAYS = 30;
const MAX_DAYS = 60;
const PAGE_SIZE = 250;
const GRAPHQL_PAGE_SIZE = 100;

const ORDERS_WITH_RETURNS_QUERY = `
  query OrdersWithReturns($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: false) {
      edges {
        cursor
        node {
          id
          returns(first: 20) {
            edges {
              node {
                id
                name
                status
                createdAt
                returnLineItems(first: 50) {
                  edges {
                    node {
                      id
                      quantity
                      returnReason
                      returnReasonDefinition { handle name }
                    }
                  }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const RETURN_BY_ID_QUERY = `
  query ReturnForAnalytics($id: ID!) {
    return(id: $id) {
      id
      name
      status
      createdAt
      order { id }
      returnLineItems(first: 50) {
        edges {
          node {
            id
            quantity
            returnReason
            returnReasonDefinition { handle name }
          }
        }
      }
    }
  }
`;

function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function nextPageUrl(response) {
  const linkHeader = response.headers.get("link") || "";
  const nextLink = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /;\s*rel="next"/.test(part));
  const match = nextLink?.match(/^<([^>]+)>/);
  return match?.[1] || null;
}

async function fetchShopifyJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.errors || payload?.error || `Shopify returned ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return { payload: payload || {}, response };
}

async function fetchShopifyGraphql({ domain, accessToken, apiVersion, query, variables }) {
  const cleanDomain = normalizeDomain(domain);
  const response = await fetch(`https://${cleanDomain}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.errors || payload?.error || `Shopify GraphQL returned ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(payload.errors.map((error) => error?.message || String(error)).join("; "));
  }
  return payload?.data || {};
}

export async function fetchShopifyReturnById({ domain, accessToken, apiVersion = DEFAULT_API_VERSION, returnId }) {
  const data = await fetchShopifyGraphql({
    domain,
    accessToken,
    apiVersion,
    query: RETURN_BY_ID_QUERY,
    variables: { id: String(returnId || "").startsWith("gid://") ? returnId : `gid://shopify/Return/${returnId}` },
  });
  const returnPayload = data?.return;
  if (!returnPayload) return null;
  return {
    ...returnPayload,
    orderId: shopifyGidToId(returnPayload?.order?.id),
  };
}

async function fetchOrdersForQuery({ domain, accessToken, apiVersion, query }) {
  const orders = [];
  const cleanDomain = normalizeDomain(domain);
  let nextUrl = new URL(`https://${cleanDomain}/admin/api/${apiVersion}/orders.json`);
  nextUrl.searchParams.set("status", "any");
  nextUrl.searchParams.set("limit", String(PAGE_SIZE));
  nextUrl.searchParams.set("order", "created_at asc");
  for (const [key, value] of Object.entries(query)) {
    nextUrl.searchParams.set(key, value);
  }

  while (nextUrl) {
    const { payload, response } = await fetchShopifyJson(nextUrl.toString(), accessToken);
    if (Array.isArray(payload.orders)) orders.push(...payload.orders);
    const next = nextPageUrl(response);
    nextUrl = next ? new URL(next) : null;
  }

  return orders;
}

/**
 * Fetch orders created or updated in the selected window. The updated query is
 * intentional: a refund on an older order must still be imported even though
 * the order itself was created before the analytics period.
 */
export async function fetchShopifyAnalyticsOrders({
  domain,
  accessToken,
  apiVersion = DEFAULT_API_VERSION,
  since,
  until,
}) {
  const [createdOrders, updatedOrders] = await Promise.all([
    fetchOrdersForQuery({
      domain,
      accessToken,
      apiVersion,
      query: { created_at_min: since, created_at_max: until },
    }),
    fetchOrdersForQuery({
      domain,
      accessToken,
      apiVersion,
      query: { updated_at_min: since, updated_at_max: until },
    }),
  ]);

  const byId = new Map();
  for (const order of [...createdOrders, ...updatedOrders]) {
    const id = String(order?.id || "").trim();
    if (id) byId.set(id, order);
  }
  return [...byId.values()];
}

function isReturnsScopeError(error) {
  return /read_returns|read_marketplace_returns|access denied|forbidden|permission/i.test(String(error?.message || error));
}

async function fetchShopifyOrdersWithReturns({ domain, accessToken, apiVersion, query }) {
  const orders = [];
  let after = null;
  do {
    const data = await fetchShopifyGraphql({
      domain,
      accessToken,
      apiVersion,
      query: ORDERS_WITH_RETURNS_QUERY,
      variables: { first: GRAPHQL_PAGE_SIZE, after, query },
    });
    const connection = data?.orders;
    for (const edge of connection?.edges || []) {
      if (edge?.node) orders.push(edge.node);
    }
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);
  return orders;
}

/**
 * Shopify exposes return reasons through Admin GraphQL and the read_returns
 * scope. Missing scope is a valid state for older installations, so callers
 * receive an unavailable result rather than a failed analytics refresh.
 */
export async function fetchShopifyAnalyticsReturns({
  domain,
  accessToken,
  apiVersion = DEFAULT_API_VERSION,
  since,
  until,
}) {
  const sinceDate = new Date(since).toISOString().slice(0, 10);
  const queries = [`created_at:>=${sinceDate}`, `updated_at:>=${sinceDate}`];
  try {
    const orderLists = await Promise.all(queries.map((query) => fetchShopifyOrdersWithReturns({
      domain,
      accessToken,
      apiVersion,
      query,
    })));
    const byReturnId = new Map();
    for (const order of orderLists.flat()) {
      const externalOrderId = shopifyGidToId(order?.id);
      if (!externalOrderId) continue;
      for (const edge of order?.returns?.edges || []) {
        const returnPayload = edge?.node;
        const returnId = shopifyGidToId(returnPayload?.id);
        if (!returnId || !isWithinWindow(returnPayload?.createdAt, since, until)) continue;
        byReturnId.set(returnId, { ...returnPayload, orderId: externalOrderId });
      }
    }
    return { returns: [...byReturnId.values()], available: true, error: null };
  } catch (error) {
    if (isReturnsScopeError(error)) {
      return { returns: [], available: false, error: "Shopify read_returns access is not granted." };
    }
    // Return reporting is additive. A shop on an older API version, or one
    // with returns disabled, must not make order/refund analytics fail.
    return { returns: [], available: false, error: "Shopify returns data could not be fetched." };
  }
}

function refundPayloadsForOrder(order) {
  if (!Array.isArray(order?.refunds)) return [];
  return order.refunds.map((refund) => ({
    ...refund,
    order_id: refund?.order_id ?? order?.id,
  }));
}

function isWithinWindow(value, since, until) {
  const timestamp = new Date(value || "").getTime();
  return Number.isFinite(timestamp)
    && timestamp >= new Date(since).getTime()
    && timestamp < new Date(until).getTime();
}

/**
 * Import minimal Shopify commerce facts for one connected shop.
 * This is idempotent and safe to run repeatedly because both tables use the
 * Shopify IDs as their conflict keys.
 */
export async function syncShopifyAnalyticsForShop({
  serviceClient,
  shop,
  accessToken,
  days = DEFAULT_DAYS,
  apiVersion = DEFAULT_API_VERSION,
  now = new Date(),
}) {
  if (!serviceClient) throw new Error("Supabase service client is required.");
  if (!shop?.id || !shop?.workspace_id || !shop?.shop_domain) {
    throw new Error("Shop analytics scope is incomplete.");
  }
  if (!accessToken) throw new Error("Shopify access token is required.");

  const boundedDays = Math.min(MAX_DAYS, Math.max(1, Number.parseInt(days, 10) || DEFAULT_DAYS));
  const untilDate = new Date(now);
  const sinceDate = new Date(untilDate.getTime() - boundedDays * 24 * 60 * 60 * 1000);
  const since = sinceDate.toISOString();
  const until = untilDate.toISOString();
  const orders = await fetchShopifyAnalyticsOrders({
    domain: shop.shop_domain,
    accessToken,
    apiVersion,
    since,
    until,
  });

  let ordersUpserted = 0;
  let refundsUpserted = 0;
  let refundItemsUpserted = 0;
  let returnsUpserted = 0;
  let returnItemsUpserted = 0;
  const seenRefundIds = new Set();

  for (const order of orders) {
    const orderFact = mapShopifyOrderFact(order, {
      workspaceId: shop.workspace_id,
      shopId: shop.id,
    });

    if (orderFact) {
      const { error } = await serviceClient
        .from("commerce_orders")
        .upsert(orderFact, { onConflict: "shop_id,external_order_id" });
      if (error) throw new Error(`Could not save Shopify order ${orderFact.external_order_id}: ${error.message}`);
      if (isWithinWindow(orderFact.order_created_at, since, until)) ordersUpserted++;
    }

    for (const refundPayload of refundPayloadsForOrder(order)) {
      const refundId = String(refundPayload?.id || "").trim();
      if (!refundId || seenRefundIds.has(refundId)) continue;
      seenRefundIds.add(refundId);

      const refundFact = mapShopifyRefundFact(refundPayload, {
        workspaceId: shop.workspace_id,
        shopId: shop.id,
      });
      if (!refundFact) continue;

      const { data: refundRow, error: refundError } = await serviceClient
        .from("commerce_refunds")
        .upsert(refundFact.refund, { onConflict: "shop_id,external_refund_id" })
        .select("id")
        .single();
      if (refundError) throw new Error(`Could not save Shopify refund ${refundId}: ${refundError.message}`);
      refundsUpserted++;

      const { error: deleteItemsError } = await serviceClient
        .from("commerce_refund_items")
        .delete()
        .eq("refund_id", refundRow.id);
      if (deleteItemsError) throw new Error(`Could not refresh refund items ${refundId}: ${deleteItemsError.message}`);

      if (refundFact.items.length) {
        const { error: itemError } = await serviceClient
          .from("commerce_refund_items")
          .insert(refundFact.items.map((item) => ({ ...item, refund_id: refundRow.id })));
        if (itemError) throw new Error(`Could not save refund items ${refundId}: ${itemError.message}`);
        refundItemsUpserted += refundFact.items.length;
      }
    }
  }

  const returnSync = await fetchShopifyAnalyticsReturns({
    domain: shop.shop_domain,
    accessToken,
    apiVersion,
    since,
    until,
  });
  if (returnSync.available && returnSync.returns.length) {
    for (const payload of returnSync.returns) {
      const returnFact = mapShopifyReturnFact(payload, {
        workspaceId: shop.workspace_id,
        shopId: shop.id,
        externalOrderId: payload.orderId,
      });
      if (!returnFact) continue;
      const { data: returnRow, error: returnError } = await serviceClient
        .from("commerce_returns")
        .upsert(returnFact.return, { onConflict: "shop_id,external_return_id" })
        .select("id")
        .single();
      if (returnError) throw new Error(`Could not save Shopify return ${returnFact.return.external_return_id}: ${returnError.message}`);
      returnsUpserted++;

      const { error: deleteItemsError } = await serviceClient
        .from("commerce_return_items")
        .delete()
        .eq("return_id", returnRow.id);
      if (deleteItemsError) throw new Error(`Could not refresh Shopify return items ${returnFact.return.external_return_id}: ${deleteItemsError.message}`);

      if (returnFact.items.length) {
        const { error: itemError } = await serviceClient
          .from("commerce_return_items")
          .insert(returnFact.items.map((item) => ({ ...item, return_id: returnRow.id })));
        if (itemError) throw new Error(`Could not save Shopify return items ${returnFact.return.external_return_id}: ${itemError.message}`);
        returnItemsUpserted += returnFact.items.length;
      }
    }
  }

  return {
    window: { since, until, days: boundedDays },
    fetchedOrders: orders.length,
    ordersUpserted,
    refundsUpserted,
    refundItemsUpserted,
    returnsUpserted,
    returnItemsUpserted,
    returnsDataAvailable: returnSync.available,
    returnsDataError: returnSync.error,
  };
}
