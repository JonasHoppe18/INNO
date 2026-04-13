/**
 * Shopify webhook handler
 *
 * Handles incoming webhooks from Shopify. Currently processes:
 *   - shop/update  → re-syncs policies (refund + shipping) into shops table + agent_knowledge
 *
 * Shopify sends:
 *   POST /api/webhooks/shopify
 *   X-Shopify-Topic: shop/update
 *   X-Shopify-Shop-Domain: example.myshopify.com
 *   X-Shopify-Hmac-SHA256: <base64 HMAC-SHA256 of raw body using SHOPIFY_CLIENT_SECRET>
 */

import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { credsFromShopRow, runPolicySyncForCreds } from "@/lib/server/shopify-policy-sync";

const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";
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

/**
 * Verify Shopify HMAC signature.
 * Shopify signs the raw request body with the app secret using HMAC-SHA256.
 */
function verifyShopifyHmac(rawBody: string, receivedHmac: string): boolean {
  if (!SHOPIFY_CLIENT_SECRET) return false;
  const computed = createHmac("sha256", SHOPIFY_CLIENT_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");
  return computed === receivedHmac;
}

export async function POST(req: NextRequest) {
  // Read raw body first — needed for HMAC verification
  const rawBody = await req.text();

  const topic = req.headers.get("x-shopify-topic") || "";
  const shopDomain = req.headers.get("x-shopify-shop-domain") || "";
  const receivedHmac = req.headers.get("x-shopify-hmac-sha256") || "";

  // --- HMAC verification ---
  if (!verifyShopifyHmac(rawBody, receivedHmac)) {
    console.warn(`[shopify-webhook] HMAC verification failed for ${shopDomain} topic=${topic}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Shopify expects a 200 within 5 seconds — acknowledge immediately
  // then process async if needed. For policy sync we're fast enough to do inline.

  if (topic !== "shop/update") {
    // Unknown topic — acknowledge so Shopify doesn't retry
    return NextResponse.json({ ok: true, topic, note: "ignored" });
  }

  if (!shopDomain) {
    return NextResponse.json({ error: "Missing shop domain" }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    console.error("[shopify-webhook] Supabase not configured");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // Look up shop by domain
  const { data: shopRow, error: shopError } = await serviceClient
    .from("shops")
    .select("id, shop_domain, access_token_encrypted, workspace_id, platform")
    .eq("shop_domain", shopDomain)
    .eq("platform", "shopify")
    .is("uninstalled_at", null)
    .maybeSingle();

  if (shopError || !shopRow) {
    console.warn(`[shopify-webhook] Shop not found: ${shopDomain}`, shopError?.message);
    // Still return 200 so Shopify doesn't keep retrying for unknown shops
    return NextResponse.json({ ok: true, note: "shop not found" });
  }

  if (!shopRow.access_token_encrypted) {
    console.warn(`[shopify-webhook] No access token for ${shopDomain}`);
    return NextResponse.json({ ok: true, note: "no token" });
  }

  try {
    const creds = credsFromShopRow(shopRow);
    const result = await runPolicySyncForCreds({ serviceClient, creds });

    console.info(JSON.stringify({
      event: "shopify.webhook.policy_synced",
      shop_domain: shopDomain,
      shop_id: shopRow.id,
      ...result,
    }));

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      event: "shopify.webhook.sync_error",
      shop_domain: shopDomain,
      shop_id: shopRow.id,
      error: message,
    }));
    // Return 200 anyway — if we return 5xx Shopify will retry endlessly
    return NextResponse.json({ ok: false, error: message });
  }
}
