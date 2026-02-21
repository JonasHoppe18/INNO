import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const DEFAULT_TTL_MINUTES = Number(process.env.CUSTOMER_LOOKUP_TTL_MINUTES || 30);
const NEGATIVE_TTL_MINUTES = Number(process.env.CUSTOMER_LOOKUP_NEGATIVE_TTL_MINUTES || 5);
const SHOPIFY_LIMIT = 50;
const SHOPIFY_API_VERSION = "2024-01";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEmailForKey(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function normalizeOrderNumber(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  return digits || trimmed;
}

function extractOrderNumber(subject) {
  if (!subject) return null;
  const match =
    subject.match(/(?:ordre|order)?\s*#?\s*(\d{3,})/i) ?? subject.match(/(\d{3,})/);
  return match ? match[1] : null;
}

function buildCacheKey({ platform, email, orderNumber }) {
  const parts = [platform];
  const emailKey = normalizeEmailForKey(email);
  if (orderNumber) parts.push(`order:${orderNumber}`);
  if (emailKey) parts.push(`email:${emailKey}`);
  return parts.join("|");
}

function buildEmailVariants(email) {
  if (!email) return [];
  const variants = new Set([email.trim(), email.trim().toLowerCase()]);
  const [localPart, domain] = email.trim().split("@");
  if (localPart && domain) {
    variants.add(`${localPart.charAt(0).toUpperCase()}${localPart.slice(1)}@${domain}`);
  }
  return Array.from(variants).filter(Boolean);
}

function matchesOrderNumber(order, candidate) {
  if (!candidate) return false;
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

function matchesCustomerEmail(order, candidateEmail) {
  const normalizedCandidate = normalizeEmailForKey(candidateEmail);
  if (!normalizedCandidate) return false;
  const candidates = [
    order?.email,
    order?.customer?.email,
    order?.shipping_address?.email,
    order?.billing_address?.email,
  ]
    .map((value) => normalizeEmailForKey(value))
    .filter(Boolean);
  return candidates.includes(normalizedCandidate);
}

function mapOrder(order) {
  const shipping = order?.shipping_address || {};
  const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
  const fulfillmentWithTracking = fulfillments.find(
    (item) =>
      (Array.isArray(item?.tracking_numbers) && item.tracking_numbers.length) ||
      item?.tracking_number ||
      (Array.isArray(item?.tracking_urls) && item.tracking_urls.length) ||
      item?.tracking_url
  );
  const trackingNumber =
    (Array.isArray(fulfillmentWithTracking?.tracking_numbers) &&
      fulfillmentWithTracking.tracking_numbers[0]) ||
    fulfillmentWithTracking?.tracking_number ||
    null;
  const trackingUrl =
    (Array.isArray(fulfillmentWithTracking?.tracking_urls) &&
      fulfillmentWithTracking.tracking_urls[0]) ||
    fulfillmentWithTracking?.tracking_url ||
    null;
  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];
  const items = lineItems
    .map((item) => {
      if (!item) return null;
      const qty = typeof item?.quantity === "number" ? item.quantity : 1;
      const title = item?.title ?? item?.name ?? "Item";
      const variant = item?.variant_title || item?.variant_name || "";
      return `${qty}x ${title}${variant ? ` (${variant})` : ""}`;
    })
    .filter(Boolean);
  const financialStatus = String(order?.financial_status || "").toLowerCase();
  const fulfillmentStatus = String(order?.fulfillment_status || "").toLowerCase();
  return {
    id: order?.order_number ?? order?.name ?? order?.id ?? "Unknown",
    adminId: order?.id ?? null,
    status: order?.fulfillment_status ?? order?.financial_status ?? "unknown",
    financialStatus: financialStatus.includes("refund") ? "refunded" : "paid",
    fulfillmentStatus: fulfillmentStatus === "fulfilled" ? "fulfilled" : "unfulfilled",
    total: order?.current_total_price ?? order?.total_price ?? null,
    currency: order?.currency ?? order?.presentment_currency ?? null,
    placedAt: order?.created_at ?? null,
    items,
    shippingAddress: {
      name: shipping?.name ?? null,
      address1: shipping?.address1 ?? null,
      address2: shipping?.address2 ?? null,
      zip: shipping?.zip ?? null,
      city: shipping?.city ?? null,
      country: shipping?.country ?? null,
    },
    tracking: {
      company: fulfillmentWithTracking?.tracking_company || null,
      number: trackingNumber,
      url: trackingUrl,
    },
  };
}

function mapCustomer(orders, fallbackEmail) {
  const primary = orders[0] || {};
  const customer = primary?.customer || {};
  const shipping = primary?.shipping_address || {};
  const name =
    shipping?.name ||
    customer?.name ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
    null;
  return {
    name: name || fallbackEmail || "Unknown customer",
    email: primary?.email || customer?.email || fallbackEmail || null,
    phone: shipping?.phone || customer?.phone || null,
    tags: customer?.tags || null,
  };
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => ({}))) ?? {};
  const inputEmail = normalizeEmail(body?.email);
  const inputOrder = normalizeOrderNumber(body?.orderNumber);
  const subject = typeof body?.subject === "string" ? body.subject : "";
  const forceRefresh = Boolean(body?.forceRefresh);
  const debug = Boolean(body?.debug);

  const derivedOrderNumber = inputOrder || extractOrderNumber(subject);
  const platform = "shopify";

  if (!inputEmail && !derivedOrderNumber) {
    return NextResponse.json(
      { error: "Missing email or order number." },
      { status: 400 }
    );
  }

  const cacheKey = buildCacheKey({
    platform,
    email: inputEmail ?? "",
    orderNumber: derivedOrderNumber ?? "",
  });

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service client could not be created." },
      { status: 500 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const supabaseUserId = scope?.supabaseUserId ?? null;

  if (!supabaseUserId) {
    return NextResponse.json({ error: "Supabase user not found." }, { status: 404 });
  }

  const scopedCacheKey = `${scope?.workspaceId ? `ws:${scope.workspaceId}` : `u:${supabaseUserId}`}|${cacheKey}`;

  if (!forceRefresh) {
    const { data: cached, error: cacheError } = await serviceClient
      .from("customer_lookup_cache")
      .select("data, fetched_at, expires_at, source")
      .eq("user_id", supabaseUserId)
      .eq("cache_key", scopedCacheKey)
      .maybeSingle();
    if (cacheError) {
      return NextResponse.json({ error: cacheError.message }, { status: 500 });
    }
    if (cached?.expires_at && new Date(cached.expires_at) > new Date()) {
      return NextResponse.json(
        {
          ...(cached?.data || {}),
          cached: true,
          fetchedAt: cached.fetched_at,
          expiresAt: cached.expires_at,
          source: cached.source || cached?.data?.source || platform,
        },
        { status: 200 }
      );
    }
  }

  let shopQuery = serviceClient
    .from("shops")
    .select("shop_domain, access_token_encrypted")
    .eq("platform", "shopify")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  shopQuery = applyScope(shopQuery, scope, { workspaceColumn: "workspace_id", userColumn: "owner_user_id" });
  const { data: shopCreds, error: shopCredsError } = await shopQuery.maybeSingle();
  if (shopCredsError) {
    return NextResponse.json({ error: shopCredsError.message }, { status: 500 });
  }
  if (!shopCreds?.shop_domain || !shopCreds?.access_token_encrypted) {
    return NextResponse.json({ error: "No connected Shopify store found for this workspace." }, { status: 400 });
  }
  let shopAccessToken = null;
  try {
    shopAccessToken = decryptString(shopCreds.access_token_encrypted);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not decrypt Shopify token." },
      { status: 500 }
    );
  }
  const shopDomain = String(shopCreds.shop_domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");

  const fetchOrders = async (params) => {
    const url = new URL(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json`);
    url.searchParams.set("status", "any");
    url.searchParams.set("limit", String(SHOPIFY_LIMIT));
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": shopAccessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { response, text, json };
  };

  const primaryParams = {
    email: inputEmail || "",
    order_number: derivedOrderNumber || "",
  };
  const primaryResult = await fetchOrders(primaryParams);
  if (!primaryResult.response.ok) {
    const message =
      primaryResult.json?.error || primaryResult.text || "Shopify lookup failed.";
    return NextResponse.json({ error: message }, { status: primaryResult.response.status });
  }

  let payload = primaryResult.json || {};
  let rawOrders = Array.isArray(payload?.orders) ? payload.orders : [];
  const lookupDebug = payload?.debug || null;

  if (!rawOrders.length && inputEmail) {
    const emailVariants = buildEmailVariants(inputEmail);
    for (const candidateEmail of emailVariants) {
      if (candidateEmail === primaryParams.email) continue;
      const variantResult = await fetchOrders({
        email: candidateEmail,
        order_number: derivedOrderNumber || "",
      });
      if (variantResult.response.ok) {
        payload = variantResult.json || payload;
        rawOrders = Array.isArray(payload?.orders) ? payload.orders : [];
        if (rawOrders.length) break;
      }
    }
  }

  if (!rawOrders.length && derivedOrderNumber && inputEmail) {
    const fallbackResult = await fetchOrders({ email: inputEmail });
    if (fallbackResult.response.ok) {
      payload = fallbackResult.json || {};
      rawOrders = Array.isArray(payload?.orders) ? payload.orders : [];
    }
  }

  if (!rawOrders.length && inputEmail && derivedOrderNumber) {
    const fallbackWithoutEmail = await fetchOrders({ order_number: derivedOrderNumber });
    if (fallbackWithoutEmail.response.ok) {
      payload = fallbackWithoutEmail.json || payload;
      rawOrders = Array.isArray(payload?.orders) ? payload.orders : [];
    }
  }

  // Ekstra fallback: hvis ordrenummer-lookup fejler, hent uden filtre og match lokalt.
  if (!rawOrders.length && derivedOrderNumber) {
    const broadResult = await fetchOrders({});
    if (broadResult.response.ok) {
      const broadPayload = broadResult.json || {};
      const broadOrders = Array.isArray(broadPayload?.orders) ? broadPayload.orders : [];
      const matchedByNumber = broadOrders.filter((order) =>
        matchesOrderNumber(order, derivedOrderNumber)
      );
      if (matchedByNumber.length) {
        payload = broadPayload;
        rawOrders = matchedByNumber;
      }
    }
  }

  const emailFilteredOrders = inputEmail
    ? rawOrders.filter((order) => matchesCustomerEmail(order, inputEmail))
    : rawOrders;
  const orderFilteredOrders = derivedOrderNumber
    ? emailFilteredOrders.filter((order) => matchesOrderNumber(order, derivedOrderNumber))
    : emailFilteredOrders;
  const ordersToUse = orderFilteredOrders;
  const { data: shopRow } = await serviceClient
    .from("shops")
    .select("shop_domain")
    .eq("platform", "shopify")
    .is("uninstalled_at", null)
    .eq("shop_domain", shopDomain)
    .maybeSingle();
  const finalShopDomain = shopRow?.shop_domain
    ? String(shopRow.shop_domain).replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : shopDomain;

  const mappedOrders = ordersToUse.map((order) => {
    const mapped = mapOrder(order);
    if (finalShopDomain && mapped?.adminId) {
      mapped.adminUrl = `https://${finalShopDomain}/admin/orders/${mapped.adminId}`;
    }
    return mapped;
  });
  const customer = ordersToUse.length ? mapCustomer(ordersToUse, inputEmail) : null;

  const data = {
    customer,
    orders: mappedOrders,
    matchedOrderNumber: derivedOrderNumber,
    source: platform,
    shopDomain: finalShopDomain,
    ...(debug && lookupDebug ? { debug: lookupDebug } : {}),
  };

  const ttlMinutes = ordersToUse.length ? DEFAULT_TTL_MINUTES : NEGATIVE_TTL_MINUTES;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  await serviceClient.from("customer_lookup_cache").upsert(
    {
      user_id: supabaseUserId,
      platform,
      cache_key: scopedCacheKey,
      email: inputEmail,
      order_number: derivedOrderNumber,
      data,
      source: platform,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
    },
    { onConflict: "user_id,cache_key" }
  );

  return NextResponse.json(
    {
      ...data,
      cached: false,
      fetchedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      source: platform,
    },
    { status: 200 }
  );
}
