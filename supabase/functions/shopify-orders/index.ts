import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.2.0/index.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getShopCredentialsForUser } from "../_shared/shopify-credentials.ts";

const SHOPIFY_API_VERSION = "2024-07"; // Brug samme version hvert sted

const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CLERK_JWT_ISSUER = Deno.env.get("CLERK_JWT_ISSUER");

if (!PROJECT_URL) console.warn("PROJECT_URL mangler – shop data kan ikke hentes.");
if (!SERVICE_ROLE_KEY)
  console.warn("SERVICE_ROLE_KEY mangler – edge function kan ikke spørge Supabase.");
if (!CLERK_JWT_ISSUER)
  console.warn("CLERK_JWT_ISSUER mangler – Clerk sessioner kan ikke verificeres.");

const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

const ISSUERS = (CLERK_JWT_ISSUER || "")
  .split(",")
  .map((issuer) => issuer.trim())
  .filter(Boolean);

const JWKS_BY_ISSUER = new Map(
  ISSUERS.map((issuer) => [
    issuer,
    createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, "")}/.well-known/jwks.json`)),
  ]),
);

type ShopRecord = {
  shop_domain: string;
  access_token: string;
};

// Udtrækker Clerk bearer token fra Authorization-headeren
function readBearerToken(req: Request): string {
  // Afkoder Authorization-headeren fra Expo-appen
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw Object.assign(new Error("Manglende Clerk session token"), { status: 401 });
  }
  return match[1];
}

async function requireClerkUserId(req: Request): Promise<string> {
  if (!ISSUERS.length) {
    throw Object.assign(
      new Error("CLERK_JWT_ISSUER mangler – kan ikke verificere Clerk session."),
      { status: 500 },
    );
  }
  const token = readBearerToken(req);
  let payload: Record<string, unknown> | null = null;
  let lastError: unknown = null;
  for (const issuer of ISSUERS) {
    const jwks = JWKS_BY_ISSUER.get(issuer);
    if (!jwks) continue;
    try {
      const result = await jwtVerify(token, jwks, { issuer });
      payload = result.payload as Record<string, unknown>;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!payload) {
    throw Object.assign(
      new Error(
        lastError instanceof Error ? lastError.message : "Ugyldigt Clerk token.",
      ),
      { status: 401 },
    );
  }
  const sub = payload?.sub;
  if (!sub || typeof sub !== "string") {
    throw Object.assign(new Error("Ugyldigt Clerk token – subject mangler."), { status: 401 });
  }
  return sub;
}

// Map Clerk user id til Supabase user id via profiles-tabellen
async function resolveSupabaseUserId(clerkUserId: string): Promise<string> {
  if (!supabase) {
    throw Object.assign(new Error("Supabase klient ikke konfigureret."), { status: 500 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    throw Object.assign(
      new Error(`Kunne ikke slå Supabase-bruger op: ${error.message}`),
      { status: 500 },
    );
  }

  const supabaseUserId = data?.user_id;

  if (!supabaseUserId) {
    throw Object.assign(
      new Error("Ingen Supabase-bruger er tilknyttet denne Clerk-bruger."),
      { status: 404 },
    );
  }

  return supabaseUserId;
}

// Henter og dekrypterer Shopify credentials for brugeren
async function getShopForUser(clerkUserId: string): Promise<ShopRecord> {
  // Henter og dekrypterer butikken for nuværende bruger
  if (!supabase) {
    throw Object.assign(new Error("Supabase klient ikke konfigureret."), { status: 500 });
  }

  const supabaseUserId = await resolveSupabaseUserId(clerkUserId);
  try {
    return await getShopCredentialsForUser({
      supabase,
      userId: supabaseUserId,
    });
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
      status: 500,
    });
  }
}

async function fetchShopifyOrders(
  shop: ShopRecord,
  searchParams: URLSearchParams,
): Promise<{ payload: Record<string, unknown> }> {
  // Kalder Shopify REST API'et og returnerer JSON tilbage til appen
  const domain = shop.shop_domain.replace(/^https?:\/\//, "");
  const url = new URL(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json`);

  searchParams.forEach((value, key) => {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shop.access_token,
    },
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_err) {
    json = null;
  }

  if (!response.ok) {
    const message =
      (json as any)?.errors ??
      (json as any)?.error ??
      text ??
      `Shopify svarede med status ${response.status}.`;
    throw Object.assign(
      new Error(typeof message === "string" ? message : JSON.stringify(message)),
      { status: response.status },
    );
  }

  return {
    payload: {
    orders: (json as any)?.orders ?? [],
    raw: json,
    },
  };
}

function mapGraphqlOrder(order: any) {
  if (!order) return null;
  const gid = String(order?.id || "");
  const idMatch = gid.match(/Order\/(\d+)/);
  const numericId = idMatch?.[1] ? Number(idMatch[1]) : null;
  const lineItems = Array.isArray(order?.lineItems?.edges)
    ? order.lineItems.edges.map((edge: any) => edge?.node).filter(Boolean)
    : [];
  const fulfillments = Array.isArray(order?.fulfillments?.edges)
    ? order.fulfillments.edges.map((edge: any) => edge?.node).filter(Boolean)
    : [];
  const trackingInfo = fulfillments.flatMap((fulfillment: any) =>
    Array.isArray(fulfillment?.trackingInfo) ? fulfillment.trackingInfo : [],
  );
  return {
    id: numericId ?? null,
    order_number: order?.orderNumber ?? null,
    name: order?.name ?? null,
    financial_status: String(order?.financialStatus || "").toLowerCase(),
    fulfillment_status: String(order?.fulfillmentStatus || "").toLowerCase(),
    total_price: order?.currentTotalPriceSet?.shopMoney?.amount ?? null,
    current_total_price: order?.currentTotalPriceSet?.shopMoney?.amount ?? null,
    currency: order?.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
    created_at: order?.createdAt ?? null,
    email: order?.email ?? null,
    customer: {
      email: order?.customer?.email ?? null,
      first_name: order?.customer?.firstName ?? null,
      last_name: order?.customer?.lastName ?? null,
    },
    shipping_address: order?.shippingAddress
      ? {
          name: order.shippingAddress?.name ?? null,
          address1: order.shippingAddress?.address1 ?? null,
          address2: order.shippingAddress?.address2 ?? null,
          zip: order.shippingAddress?.zip ?? null,
          city: order.shippingAddress?.city ?? null,
          country: order.shippingAddress?.country ?? null,
          phone: order.shippingAddress?.phone ?? null,
          email: order.shippingAddress?.email ?? null,
        }
      : null,
    line_items: lineItems.map((item: any) => ({
      title: item?.title ?? null,
      name: item?.name ?? null,
      quantity: item?.quantity ?? 1,
      variant_title: item?.variantTitle ?? null,
    })),
    fulfillments: trackingInfo.length
      ? [
          {
            tracking_number: trackingInfo[0]?.number ?? null,
            tracking_numbers: trackingInfo.map((t: any) => t?.number).filter(Boolean),
            tracking_url: trackingInfo[0]?.url ?? null,
            tracking_urls: trackingInfo.map((t: any) => t?.url).filter(Boolean),
            tracking_company: trackingInfo[0]?.company ?? null,
          },
        ]
      : [],
  };
}

function extractNextPageInfo(linkHeader: string | null): string | null {
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

function matchesOrderNumber(order: any, candidate: string): boolean {
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

async function fetchOrdersPage(
  shop: ShopRecord,
  searchParams: URLSearchParams,
): Promise<{ orders: any[]; nextPageInfo: string | null }> {
  const domain = shop.shop_domain.replace(/^https?:\/\//, "");
  const url = new URL(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json`);
  searchParams.forEach((value, key) => {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shop.access_token,
    },
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const message =
      json?.errors ||
      json?.error ||
      text ||
      `Shopify svarede med status ${response.status}.`;
    throw Object.assign(new Error(String(message)), { status: response.status });
  }
  const nextPageInfo = extractNextPageInfo(response.headers.get("link"));
  return { orders: json?.orders ?? [], nextPageInfo };
}

async function fetchShopifyOrdersByNumberViaRest(
  shop: ShopRecord,
  orderNumber: string,
  email?: string | null,
): Promise<{ orders: any[]; raw: any }> {
  const limit = 250;
  let pageInfo: string | null = null;
  let lastOrders: any[] = [];
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("status", "any");
    if (pageInfo) {
      params.set("page_info", pageInfo);
    } else if (email) {
      params.set("email", email);
    }
    const { orders, nextPageInfo } = await fetchOrdersPage(shop, params);
    lastOrders = orders;
    const matches = orders.filter((order) => matchesOrderNumber(order, orderNumber));
    if (matches.length) {
      return { orders: matches, raw: orders };
    }
    if (!nextPageInfo) break;
    pageInfo = nextPageInfo;
  }
  return { orders: [], raw: lastOrders };
}

async function fetchShopifyOrdersByNumber(
  shop: ShopRecord,
  orderNumber: string,
  email?: string | null,
): Promise<{ orders: any[]; raw: any }> {
  const domain = shop.shop_domain.replace(/^https?:\/\//, "");
  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const trimmedEmail = email?.trim();
  const queries = [
    `name:#${orderNumber}`,
    `order_number:${orderNumber}`,
    `name:${orderNumber}`,
  ];
  if (trimmedEmail) {
    queries.unshift(
      `name:#${orderNumber} email:${trimmedEmail}`,
      `order_number:${orderNumber} email:${trimmedEmail}`,
      `name:${orderNumber} email:${trimmedEmail}`,
    );
  }
  const query = `
    query OrdersByNumber($query: String!) {
      orders(first: 5, query: $query) {
        edges {
          node {
            id
            name
            orderNumber
            financialStatus
            fulfillmentStatus
            createdAt
            email
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              firstName
              lastName
              email
            }
            shippingAddress {
              name
              address1
              address2
              zip
              city
              country
              phone
              email
            }
            lineItems(first: 10) {
              edges {
                node {
                  title
                  name
                  quantity
                  variantTitle
                }
              }
            }
            fulfillments(first: 5) {
              edges {
                node {
                  trackingInfo {
                    number
                    url
                    company
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  let lastPayload: any = null;
  for (const queryValue of queries) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shop.access_token,
      },
      body: JSON.stringify({
        query,
        variables: { query: queryValue },
      }),
    });
    const payload = await res.json().catch(() => ({}));
    lastPayload = payload;
    if (!res.ok || payload?.errors) {
      const message =
        payload?.errors?.[0]?.message ||
        payload?.error ||
        res.statusText ||
        `Shopify svarede med status ${res.status}.`;
      throw Object.assign(new Error(String(message)), { status: res.status });
    }
    const edges = payload?.data?.orders?.edges ?? [];
    const orders = edges.map((edge: any) => mapGraphqlOrder(edge?.node)).filter(Boolean);
    if (orders.length) {
      return { orders, raw: payload };
    }
  }
  return { orders: [], raw: lastPayload };
}

async function fetchShopifyOrdersByEmailGraphql(
  shop: ShopRecord,
  email: string,
  limit: number,
): Promise<{ orders: any[]; raw: any }> {
  const domain = shop.shop_domain.replace(/^https?:\/\//, "");
  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const query = `
    query OrdersByEmail($query: String!, $first: Int!) {
      orders(first: $first, query: $query, reverse: true) {
        edges {
          node {
            id
            name
            orderNumber
            financialStatus
            fulfillmentStatus
            createdAt
            email
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              firstName
              lastName
              email
            }
            shippingAddress {
              name
              address1
              address2
              zip
              city
              country
              phone
              email
            }
            lineItems(first: 10) {
              edges {
                node {
                  title
                  name
                  quantity
                  variantTitle
                }
              }
            }
            fulfillments(first: 5) {
              edges {
                node {
                  trackingInfo {
                    number
                    url
                    company
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shop.access_token,
    },
    body: JSON.stringify({
      query,
      variables: { query: `email:${email.trim()}`, first: Math.max(1, Math.min(limit, 50)) },
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.errors) {
    const message =
      payload?.errors?.[0]?.message ||
      payload?.error ||
      res.statusText ||
      `Shopify svarede med status ${res.status}.`;
    throw Object.assign(new Error(String(message)), { status: res.status });
  }
  const edges = payload?.data?.orders?.edges ?? [];
  const orders = edges.map((edge: any) => mapGraphqlOrder(edge?.node)).filter(Boolean);
  return { orders, raw: payload };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const userId = await requireClerkUserId(req);
    const shop = await getShopForUser(userId);

    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";
    const searchParams = new URLSearchParams();

    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20), 1), 250);
    searchParams.set("limit", String(limit));

    const status = url.searchParams.get("status");
    if (status) searchParams.set("status", status);

    const email = url.searchParams.get("email");
    if (email) searchParams.set("email", email);

    const orderNumber = url.searchParams.get("order_number");
    if (orderNumber) {
      const graphqlResult = await fetchShopifyOrdersByNumber(shop, orderNumber, email);
      if (graphqlResult.orders.length) {
        console.log("shopify-orders", {
          shop_domain: shop.shop_domain,
          order_number: orderNumber,
          source: "graphql",
          orders_count: graphqlResult.orders.length,
        });
        return Response.json({
          ...graphqlResult,
          ...(debug ? { debug: { shop_domain: shop.shop_domain } } : {}),
        });
      }
      const restResult = await fetchShopifyOrdersByNumberViaRest(
        shop,
        orderNumber,
        email ?? undefined,
      );
      if (restResult.orders.length) {
        console.log("shopify-orders", {
          shop_domain: shop.shop_domain,
          order_number: orderNumber,
          source: "rest_fallback",
          orders_count: restResult.orders.length,
        });
        return Response.json({
          ...restResult,
          ...(debug ? { debug: { shop_domain: shop.shop_domain } } : {}),
        });
      }
    }

    const createdAtMin = url.searchParams.get("created_at_min");
    if (createdAtMin) searchParams.set("created_at_min", createdAtMin);

    const createdAtMax = url.searchParams.get("created_at_max");
    if (createdAtMax) searchParams.set("created_at_max", createdAtMax);

    const result = await fetchShopifyOrders(shop, searchParams);
    const initialOrders = Array.isArray(result.payload?.orders) ? result.payload.orders : [];
    if (!initialOrders.length && email && !orderNumber) {
      const graphqlByEmail = await fetchShopifyOrdersByEmailGraphql(shop, email, limit);
      if (graphqlByEmail.orders.length) {
        console.log("shopify-orders", {
          shop_domain: shop.shop_domain,
          email,
          order_number: orderNumber,
          source: "graphql_email_fallback",
          orders_count: graphqlByEmail.orders.length,
        });
        return Response.json({
          orders: graphqlByEmail.orders,
          raw: graphqlByEmail.raw,
          ...(debug ? { debug: { shop_domain: shop.shop_domain } } : {}),
        });
      }
    }
    console.log("shopify-orders", {
      shop_domain: shop.shop_domain,
      email,
      order_number: orderNumber,
      orders_count: initialOrders.length,
    });
    return Response.json({
      ...result.payload,
      ...(debug ? { debug: { shop_domain: shop.shop_domain } } : {}),
    });
  } catch (error) {
    const status = (error as any)?.status ?? 500;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
});
