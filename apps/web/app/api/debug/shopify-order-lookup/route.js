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
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeOrderNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits || "";
}

function toShopifyOrderName(value) {
  const digits = normalizeOrderNumber(value);
  return digits ? `#${digits}` : "";
}

function extractNextPageInfo(linkHeader) {
  const raw = String(linkHeader || "");
  if (!raw) return null;
  for (const part of raw.split(",")) {
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

function sampleOrders(orders) {
  return (Array.isArray(orders) ? orders : []).slice(0, 5).map((order) => ({
    id: order?.id ?? null,
    order_number: order?.order_number ?? null,
    name: order?.name ?? null,
    email: order?.email ?? order?.customer?.email ?? null,
    created_at: order?.created_at ?? null,
  }));
}

async function callShopifyAccessScopes({ shopDomain, accessToken }) {
  const url = new URL(`https://${shopDomain}/admin/oauth/access_scopes.json`);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      Accept: "application/json",
      "Content-Type": "application/json",
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
  const scopes = Array.isArray(json?.access_scopes)
    ? json.access_scopes.map((entry) => String(entry?.handle || "").trim()).filter(Boolean)
    : [];
  return {
    status: response.status,
    ok: response.ok,
    scopes,
    errors: json?.errors || null,
  };
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service client could not be created." }, { status: 500 });
  }

  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve workspace scope." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) ?? {};
  const email = String(body?.email || "").trim();
  const orderNumber = normalizeOrderNumber(body?.orderNumber);
  const orderName = toShopifyOrderName(orderNumber);

  let query = serviceClient
    .from("shops")
    .select("shop_domain, access_token_encrypted")
    .eq("platform", "shopify")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  query = applyScope(query, scope, { workspaceColumn: "workspace_id", userColumn: "owner_user_id" });
  const { data: shop, error: shopError } = await query.maybeSingle();
  if (shopError) {
    return NextResponse.json({ error: shopError.message }, { status: 500 });
  }
  if (!shop?.shop_domain || !shop?.access_token_encrypted) {
    return NextResponse.json({ error: "No connected Shopify store found for this workspace." }, { status: 400 });
  }

  const shopDomain = String(shop.shop_domain).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const accessToken = decryptString(shop.access_token_encrypted);

  const callShopifyOrders = async (params, label) => {
    const url = new URL(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json`);
    if (params?.page_info) {
      url.searchParams.set("page_info", String(params.page_info));
      url.searchParams.set("limit", String(params.limit || 250));
    } else {
      url.searchParams.set("status", "any");
      url.searchParams.set("limit", String(params.limit || 50));
      Object.entries(params || {}).forEach(([key, value]) => {
        if (!value || key === "limit") return;
        url.searchParams.set(key, String(value));
      });
    }
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        Accept: "application/json",
        "Content-Type": "application/json",
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
    return {
      label,
      status: response.status,
      ok: response.ok,
      params,
      orders_count: Array.isArray(json?.orders) ? json.orders.length : 0,
      sample_orders: sampleOrders(json?.orders || []),
      next_page_info: extractNextPageInfo(response.headers.get("link")),
      errors: json?.errors || null,
    };
  };

  const results = [];
  results.push(await callShopifyOrders({ email, name: orderName, limit: 10 }, "email_plus_name"));
  results.push(await callShopifyOrders({ email, limit: 10 }, "email_only"));
  results.push(await callShopifyOrders({ name: orderName, limit: 10 }, "name_only"));
  const unfiltered = await callShopifyOrders({ limit: 10 }, "unfiltered_page_1");
  results.push(unfiltered);
  if (unfiltered.next_page_info) {
    results.push(await callShopifyOrders({ page_info: unfiltered.next_page_info, limit: 10 }, "unfiltered_page_2"));
  }
  const scopeResult = await callShopifyAccessScopes({ shopDomain, accessToken });

  return NextResponse.json(
    {
      shopDomain,
      apiVersion: SHOPIFY_API_VERSION,
      query: {
        email: email || null,
        orderNumber: orderNumber || null,
        name: orderName || null,
      },
      accessScopes: scopeResult,
      results,
    },
    { status: 200 },
  );
}
