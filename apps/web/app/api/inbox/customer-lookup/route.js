import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { getEffectiveSenderEmail } from "@/lib/inbox/sender";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import { resolveShopifyCredentialsWithDiagnostics } from "@/lib/server/shopify-credentials";

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
const SHOPIFY_PAGINATED_LIMIT = 250;
const SHOPIFY_MAX_PAGES = 40;
const SHOPIFY_API_VERSION = "2024-01";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function logCustomerLookup(serviceClient, { status = "info", detail = {} }) {
  try {
    await serviceClient.from("agent_logs").insert({
      draft_id: null,
      step_name: status === "error" ? "customer_lookup_failed" : "customer_lookup",
      step_detail: JSON.stringify(detail),
      status,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("customer-lookup: failed to write agent log", error);
  }
}

function preview(value, maxLength = 160) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
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

function normalizeLookupText(value) {
  if (!value) return "";
  return String(value || "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\b(?:re|fw|fwd)\s*:\s*/gi, " ")
    .replace(/\bnew customer message on\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toShopifyOrderName(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? `#${digits}` : "";
}

function extractNextPageInfo(linkHeader) {
  const raw = String(linkHeader || "");
  if (!raw) return null;
  const parts = raw.split(",");
  for (const part of parts) {
    if (!/rel="?next"?/i.test(part)) continue;
    const match = part.match(/<([^>]+)>/);
    if (!match?.[1]) continue;
    try {
      const url = new URL(match[1]);
      return url.searchParams.get("page_info");
    } catch {
      return null;
    }
  }
  return null;
}

function extractOrderNumber(subject) {
  if (!subject) return null;
  const text = normalizeLookupText(subject);
  const explicitMatch = text.match(
    /\b(?:ordre|ordrenummer|order)\s*(?:nr\.?|number|no\.?)?\s*#?\s*(\d{3,})\b/i
  );
  if (explicitMatch?.[1]) return explicitMatch[1];
  const compactMatch = text.match(/\b(?:order|ordre)\s*#(\d{3,})\b/i);
  if (compactMatch?.[1]) return compactMatch[1];
  const hashMatch = text.match(/#\s*(\d{3,})\b/);
  return hashMatch?.[1] || null;
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

async function loadPreviousTickets(serviceClient, scope, { customerEmail, currentThreadId = "" }) {
  const normalizedEmail = normalizeEmail(customerEmail);
  if (!normalizedEmail) return [];

  let query = serviceClient
    .from("mail_threads")
    .select("id, ticket_number, subject, status, last_message_at")
    .ilike("customer_email", normalizedEmail)
    .not("ticket_number", "is", null)
    .or("classification_key.is.null,classification_key.neq.notification")
    .order("last_message_at", { ascending: false, nullsLast: true })
    .limit(12);
  query = applyScope(query, scope);
  if (currentThreadId) {
    query = query.neq("id", currentThreadId);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("customer-lookup: failed to load previous tickets", error?.message || error);
    return [];
  }

  return (Array.isArray(data) ? data : []).map((row) => ({
    thread_id: String(row?.id || ""),
    ticket_number: Number.isFinite(Number(row?.ticket_number))
      ? Number(row.ticket_number)
      : null,
    subject: String(row?.subject || "").trim() || "Untitled ticket",
    status: String(row?.status || "").trim() || "open",
    last_message_at: row?.last_message_at || null,
  }));
}

function matchesOrderNumber(order, candidate) {
  if (!candidate) return false;
  const normalizedCandidate = String(candidate).replace(/\D/g, "");
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
  const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
  const sourceMessageId =
    typeof body?.sourceMessageId === "string" ? body.sourceMessageId.trim() : "";
  const forceRefresh = Boolean(body?.forceRefresh);
  const debug = Boolean(body?.debug);

  const derivedOrderNumber = inputOrder || extractOrderNumber(subject);
  const platform = "shopify";

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
  const workspaceId = scope?.workspaceId ?? null;

  if (!workspaceId && !supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve workspace scope." }, { status: 404 });
  }

  let effectiveInputEmail = inputEmail;
  if (!effectiveInputEmail && sourceMessageId) {
    let sourceMessageQuery = serviceClient
      .from("mail_messages")
      .select("id, from_email, extracted_customer_email")
      .eq("id", sourceMessageId)
      .limit(1);
    sourceMessageQuery = applyScope(sourceMessageQuery, scope);
    const { data: sourceMessage } = await sourceMessageQuery.maybeSingle();
    effectiveInputEmail = normalizeEmail(getEffectiveSenderEmail(sourceMessage));
  }

  if (!effectiveInputEmail && !derivedOrderNumber) {
    return NextResponse.json(
      { error: "Missing email or order number." },
      { status: 400 }
    );
  }

  const cacheKey = buildCacheKey({
    platform,
    email: effectiveInputEmail ?? "",
    orderNumber: derivedOrderNumber ?? "",
  });

  const scopedCacheKey = `${workspaceId ? `ws:${workspaceId}` : `u:${supabaseUserId}`}|${cacheKey}`;
  const threadScopedCacheKey = threadId ? `${scopedCacheKey}|thread:${threadId}` : scopedCacheKey;
  const logContext = {
    thread_id: threadId || null,
    source_message_id: sourceMessageId || null,
    input_email: effectiveInputEmail,
    input_order_number: inputOrder,
    derived_order_number: derivedOrderNumber,
    raw_subject: subject || null,
    normalized_subject: normalizeLookupText(subject) || null,
  };

  if (!forceRefresh && supabaseUserId) {
    const { data: cached, error: cacheError } = await serviceClient
      .from("customer_lookup_cache")
      .select("data, fetched_at, expires_at, source")
      .eq("user_id", supabaseUserId)
      .eq("cache_key", threadScopedCacheKey)
      .maybeSingle();
    if (cacheError) {
      await logCustomerLookup(serviceClient, {
        status: "error",
        detail: { ...logContext, stage: "cache_read_failed", error: cacheError.message },
      });
      return NextResponse.json({ error: cacheError.message }, { status: 500 });
    }
    if (cached?.expires_at && new Date(cached.expires_at) > new Date()) {
      await logCustomerLookup(serviceClient, {
        detail: {
          ...logContext,
          stage: "cache_hit",
          cached: true,
          expires_at: cached.expires_at,
        },
      });
      const cachedCustomerEmail =
        normalizeEmail(cached?.data?.customer?.email) ||
        normalizeEmail(cached?.data?.email) ||
        effectiveInputEmail;
      // Always refresh previous tickets from DB to avoid stale ticket numbers in cached payloads.
      const cachedPreviousTickets = await loadPreviousTickets(serviceClient, scope, {
        customerEmail: cachedCustomerEmail,
        currentThreadId: threadId,
      });
      return NextResponse.json(
        {
          ...(cached?.data || {}),
          previousTickets: cachedPreviousTickets,
          cached: true,
          fetchedAt: cached.fetched_at,
          expiresAt: cached.expires_at,
          source: cached.source || cached?.data?.source || platform,
        },
        { status: 200 }
      );
    }
  }

  let shopAccessToken = null;
  let shopCreds = null;
  try {
    shopCreds = await resolveShopifyCredentialsWithDiagnostics(serviceClient, scope, {
      reason: "customer_lookup",
      log: (message) => logCustomerLookup(serviceClient, {
        detail: { ...logContext, stage: "shop_credentials_debug", message },
      }),
    });
    shopAccessToken = shopCreds.access_token;
  } catch (error) {
    await logCustomerLookup(serviceClient, {
      status: "error",
      detail: {
        ...logContext,
        stage: "shop_credentials_failed",
        error: error instanceof Error ? error.message : "Could not resolve Shopify credentials.",
      },
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not decrypt Shopify token." },
      { status: 500 }
    );
  }
  const shopDomain = shopCreds.shop_domain;
  await logCustomerLookup(serviceClient, {
    detail: {
      ...logContext,
      stage: "shop_credentials_resolved",
      selected_row_id: shopCreds.shop_id,
      selected_shop_domain: shopCreds.shop_domain,
      selected_shopify_client_id: shopCreds.shopify_client_id,
      token_fingerprint: shopCreds.token_fingerprint,
      candidate_rows: shopCreds.candidates,
    },
  });
  const lookupAttempts = [];

  const fetchOrders = async (params, label = "lookup") => {
    const url = new URL(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json`);
    if (params?.page_info) {
      url.searchParams.set("page_info", String(params.page_info));
      url.searchParams.set("limit", String(SHOPIFY_PAGINATED_LIMIT));
    } else {
      url.searchParams.set("status", "any");
      url.searchParams.set("limit", String(SHOPIFY_LIMIT));
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value) url.searchParams.set(key, value);
      });
    }
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
    const orders = Array.isArray(json?.orders) ? json.orders : [];
    lookupAttempts.push({
      label,
      request_params: params,
      status_code: response.status,
      ok: response.ok,
      orders_count: orders.length,
      error: response.ok ? null : json?.error || text || "Shopify lookup failed.",
    });
    return { response, text, json };
  };

  const fetchAcrossPages = async (predicate, label = "pagination_fallback") => {
    let pageInfo = null;
    const matched = [];
    for (let page = 0; page < SHOPIFY_MAX_PAGES; page += 1) {
      const pageResult = await fetchOrders(
        pageInfo ? { page_info: pageInfo } : { limit: SHOPIFY_PAGINATED_LIMIT },
        `${label}:page_${page + 1}`
      );
      if (!pageResult.response.ok) break;
      const pageOrders = Array.isArray(pageResult.json?.orders) ? pageResult.json.orders : [];
      const pageMatches = pageOrders.filter(predicate);
      if (pageMatches.length) {
        matched.push(...pageMatches);
        break;
      }
      pageInfo = extractNextPageInfo(pageResult.response.headers.get("link"));
      if (!pageInfo) break;
    }
    return matched;
  };

  const primaryParams = {
    email: effectiveInputEmail || "",
    name: toShopifyOrderName(derivedOrderNumber),
  };
  const primaryResult = await fetchOrders(primaryParams, "primary_email_order_lookup");
  if (!primaryResult.response.ok) {
    const message =
      primaryResult.json?.error || primaryResult.text || "Shopify lookup failed.";
    await logCustomerLookup(serviceClient, {
      status: "error",
      detail: {
        ...logContext,
        stage: "primary_lookup_failed",
        request_params: primaryParams,
        status_code: primaryResult.response.status,
        error: message,
      },
    });
    return NextResponse.json({ error: message }, { status: primaryResult.response.status });
  }

  let payload = primaryResult.json || {};
  let rawOrders = Array.isArray(payload?.orders) ? payload.orders : [];
  const lookupDebug = payload?.debug || null;

  if (!rawOrders.length && effectiveInputEmail) {
    const emailVariants = buildEmailVariants(effectiveInputEmail);
    for (const candidateEmail of emailVariants) {
      if (candidateEmail === primaryParams.email) continue;
      const variantResult = await fetchOrders({
        email: candidateEmail,
        name: toShopifyOrderName(derivedOrderNumber),
      }, `email_variant_lookup:${candidateEmail}`);
      if (variantResult.response.ok) {
        payload = variantResult.json || payload;
        rawOrders = Array.isArray(payload?.orders) ? payload.orders : [];
        if (rawOrders.length) break;
      }
    }
  }

  if (!rawOrders.length && derivedOrderNumber && effectiveInputEmail) {
    const fallbackResult = await fetchOrders({ email: effectiveInputEmail }, "email_only_fallback");
    if (fallbackResult.response.ok) {
      payload = fallbackResult.json || {};
      rawOrders = Array.isArray(payload?.orders) ? payload.orders : [];
    }
  }

  if (!rawOrders.length && effectiveInputEmail && derivedOrderNumber) {
    const fallbackWithoutEmail = await fetchOrders(
      { name: toShopifyOrderName(derivedOrderNumber) },
      "name_only_fallback"
    );
    if (fallbackWithoutEmail.response.ok) {
      payload = fallbackWithoutEmail.json || payload;
      rawOrders = Array.isArray(payload?.orders) ? payload.orders : [];
    }
  }

  // Ekstra fallback: hvis ordrenummer-lookup fejler, hent uden filtre og match lokalt.
  if (!rawOrders.length && derivedOrderNumber) {
    const matchedByNumber = await fetchAcrossPages(
      (order) => matchesOrderNumber(order, derivedOrderNumber),
      "broad_unfiltered_fallback"
    );
    if (matchedByNumber.length) {
      rawOrders = matchedByNumber;
    }
  }

  const emailFilteredOrders = effectiveInputEmail
    ? rawOrders.filter((order) => matchesCustomerEmail(order, effectiveInputEmail))
    : rawOrders;
  const orderMatches = derivedOrderNumber
    ? rawOrders.filter((order) => matchesOrderNumber(order, derivedOrderNumber))
    : [];
  const orderMatchesWithEmail = effectiveInputEmail
    ? orderMatches.filter((order) => matchesCustomerEmail(order, effectiveInputEmail))
    : orderMatches;
  const ordersToUse = derivedOrderNumber
    ? orderMatchesWithEmail.length
      ? orderMatchesWithEmail
      : orderMatches
    : emailFilteredOrders;
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
  const customer = ordersToUse.length ? mapCustomer(ordersToUse, effectiveInputEmail) : null;
  const previousTickets = await loadPreviousTickets(serviceClient, scope, {
    customerEmail: customer?.email || effectiveInputEmail,
    currentThreadId: threadId,
  });

  const data = {
    customer,
    orders: mappedOrders,
    previousTickets,
    matchedOrderNumber: derivedOrderNumber,
    source: platform,
    shopDomain: finalShopDomain,
    ...(debug
      ? {
          debug: {
            lookup_attempts: lookupAttempts,
            filter_summary: {
              raw_orders_count: rawOrders.length,
              email_filtered_count: emailFilteredOrders.length,
              order_filtered_count: orderMatches.length,
              order_email_filtered_count: orderMatchesWithEmail.length,
              final_orders_count: ordersToUse.length,
            },
            shopify_debug: lookupDebug || null,
          },
        }
      : {}),
  };

  const ttlMinutes = ordersToUse.length ? DEFAULT_TTL_MINUTES : NEGATIVE_TTL_MINUTES;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  await logCustomerLookup(serviceClient, {
    detail: {
      ...logContext,
      stage: ordersToUse.length ? "lookup_succeeded" : "lookup_no_match",
      request_params: primaryParams,
      lookup_attempts: lookupAttempts,
      raw_orders_count: rawOrders.length,
      email_filtered_count: emailFilteredOrders.length,
      order_filtered_count: orderMatches.length,
      order_email_filtered_count: orderMatchesWithEmail.length,
      final_orders_count: ordersToUse.length,
      matched_order_ids: mappedOrders.map((order) => order?.id).filter(Boolean),
      customer_email: customer?.email || null,
      customer_name: customer?.name || null,
      subject_preview: preview(subject),
    },
  });

  if (supabaseUserId) {
    await serviceClient.from("customer_lookup_cache").upsert(
      {
        user_id: supabaseUserId,
        platform,
        cache_key: threadScopedCacheKey,
        email: effectiveInputEmail,
        order_number: derivedOrderNumber,
        data,
        source: platform,
        fetched_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id,cache_key" }
    );
  }

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
