import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";
import { registerShopUpdateWebhook } from "@/lib/server/shopify-policy-sync";
import {
  COMMERCE_WEBHOOK_TOPICS,
  ensureShopifyWebhooks,
} from "@/lib/server/commerce/shopify-webhooks";
import { syncShopifyAnalyticsForShop } from "@/lib/server/commerce/shopify-analytics-sync";

const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";
const APP_URL = (process.env.APP_URL || "https://sona-ai.dk").replace(/\/$/, "");

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isAuthorized(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return Boolean(ADMIN_SECRET && token && token === ADMIN_SECRET);
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedDays = Number.parseInt(body?.days, 10) || 30;
  const days = Math.min(60, Math.max(1, requestedDays));
  const { data: shops, error } = await serviceClient
    .from("shops")
    .select("id, workspace_id, shop_domain, access_token_encrypted")
    .eq("platform", "shopify")
    .is("uninstalled_at", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const shop of shops || []) {
    if (!shop.access_token_encrypted || !shop.shop_domain) {
      results.push({ shop_domain: shop.shop_domain || null, status: "skipped", error: "Missing token or domain." });
      continue;
    }

    try {
      const accessToken = decryptString(shop.access_token_encrypted);
      await registerShopUpdateWebhook(shop.shop_domain, accessToken);
      await ensureShopifyWebhooks({
        domain: shop.shop_domain,
        accessToken,
        apiVersion: SHOPIFY_API_VERSION,
        appUrl: APP_URL,
        topics: COMMERCE_WEBHOOK_TOPICS,
      });
      const sync = await syncShopifyAnalyticsForShop({
        serviceClient,
        shop,
        accessToken,
        days,
        apiVersion: SHOPIFY_API_VERSION,
      });
      results.push({ shop_domain: shop.shop_domain, status: "ok", ...sync });
    } catch (error) {
      results.push({
        shop_domain: shop.shop_domain,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ ok: true, days, results });
}

