/**
 * One-time / on-demand admin route to register the shop/update webhook for all
 * active Shopify shops. Safe to call multiple times — registerShopUpdateWebhook
 * is idempotent (finds & updates existing webhook if address changed).
 *
 * Protected by ADMIN_SECRET env var. Call with:
 *   POST /api/admin/register-webhooks
 *   Authorization: Bearer <ADMIN_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";
import { registerShopUpdateWebhook } from "@/lib/server/shopify-policy-sync";

const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(req: NextRequest) {
  // Guard with admin secret
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // Fetch all active Shopify shops
  const { data: shops, error } = await serviceClient
    .from("shops")
    .select("id, shop_domain, access_token_encrypted")
    .eq("platform", "shopify")
    .is("uninstalled_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ shop_domain: string; status: string; error?: string }> = [];

  for (const shop of shops || []) {
    if (!shop.access_token_encrypted || !shop.shop_domain) {
      results.push({ shop_domain: shop.shop_domain, status: "skipped", error: "missing token or domain" });
      continue;
    }

    try {
      const accessToken = decryptString(shop.access_token_encrypted);
      await registerShopUpdateWebhook(shop.shop_domain, accessToken);
      results.push({ shop_domain: shop.shop_domain, status: "ok" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ shop_domain: shop.shop_domain, status: "error", error: message });
    }
  }

  console.info(JSON.stringify({ event: "admin.register_webhooks", results }));

  return NextResponse.json({ ok: true, results });
}
