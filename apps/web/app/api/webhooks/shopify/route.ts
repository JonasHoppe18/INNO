/**
 * Shopify webhook handler
 *
 * Handles incoming webhooks from Shopify. Currently processes:
 *   - shop/update       → re-syncs policies (refund + shipping) into shops table + agent_knowledge
 *   - products/create   → indexes the one product's knowledge chunks + shop_products row
 *   - products/update   → same as products/create (re-index)
 *   - products/delete   → removes the product's agent_knowledge chunks + shop_products row
 *   - orders/create     → stores an anonymous order fact for contact-rate analytics
 *   - orders/updated    → refreshes totals/status without storing customer data
 *   - refunds/create    → stores refund amount and product ids without free text
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
import { upsertProductKnowledge, embedText } from "@/lib/server/commerce/sync-one-product";
import { fetchPresentmentPrices, fetchShopCurrency } from "@/lib/server/commerce/shopify-presentment";
import { mapShopifyProductToNormalizedProduct, toShopProductRow } from "@/lib/server/commerce/normalize-product";
import { mapShopifyOrderFact, mapShopifyRefundFact } from "@/lib/server/commerce/shopify-analytics";

const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";
const PRODUCT_TOPICS = new Set(["products/create", "products/update", "products/delete"]);
const ORDER_TOPICS = new Set(["orders/create", "orders/updated"]);
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
    .select("id, shop_domain, access_token_encrypted, workspace_id, platform, public_storefront_domain")
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

  if (ORDER_TOPICS.has(topic)) {
    try {
      const payload = JSON.parse(rawBody);
      const orderFact = mapShopifyOrderFact(payload, {
        workspaceId: shopRow.workspace_id,
        shopId: shopRow.id,
      });
      if (!orderFact) return NextResponse.json({ ok: true, topic, note: "incomplete order fact" });

      const { error } = await serviceClient
        .from("commerce_orders")
        .upsert(orderFact, { onConflict: "shop_id,external_order_id" });
      if (error) throw error;
      return NextResponse.json({ ok: true, topic, order_id: orderFact.external_order_id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ event: "shopify.webhook.order_fact_error", topic, shop_domain: shopDomain, error: message }));
      return NextResponse.json({ ok: false, error: message });
    }
  }

  if (topic === "refunds/create") {
    try {
      const payload = JSON.parse(rawBody);
      const refundFact = mapShopifyRefundFact(payload, {
        workspaceId: shopRow.workspace_id,
        shopId: shopRow.id,
      });
      if (!refundFact) return NextResponse.json({ ok: true, topic, note: "incomplete refund fact" });

      const { data: refundRow, error: refundError } = await serviceClient
        .from("commerce_refunds")
        .upsert(refundFact.refund, { onConflict: "shop_id,external_refund_id" })
        .select("id")
        .single();
      if (refundError) throw refundError;

      const { error: deleteItemsError } = await serviceClient
        .from("commerce_refund_items")
        .delete()
        .eq("refund_id", refundRow.id);
      if (deleteItemsError) throw deleteItemsError;

      if (refundFact.items.length) {
        const { error: itemError } = await serviceClient
          .from("commerce_refund_items")
          .insert(refundFact.items.map((item) => ({ ...item, refund_id: refundRow.id })));
        if (itemError) throw itemError;
      }
      return NextResponse.json({ ok: true, topic, refund_id: refundFact.refund.external_refund_id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ event: "shopify.webhook.refund_fact_error", topic, shop_domain: shopDomain, error: message }));
      return NextResponse.json({ ok: false, error: message });
    }
  }

  if (PRODUCT_TOPICS.has(topic)) {
    try {
      const payload = JSON.parse(rawBody);
      const creds = credsFromShopRow(shopRow); // { shop_id, workspace_id, shop_domain, access_token }
      const productId = String(payload?.id ?? "").trim();
      if (!productId) return NextResponse.json({ ok: true, note: "no product id" });

      if (topic === "products/delete") {
        await serviceClient
          .from("agent_knowledge")
          .delete()
          .eq("shop_id", creds.shop_id)
          .eq("source_provider", "shopify_product")
          .eq("metadata->>product_id", productId);
        await serviceClient
          .from("shop_products")
          .delete()
          .eq("shop_ref_id", creds.shop_id)
          .eq("external_id", productId);
        return NextResponse.json({ ok: true, topic, product_id: productId, deleted: true });
      }

      // create/update: refetch presentment prices (webhook payload lacks them),
      // then upsert one product's knowledge + structured row.
      const domain = String(creds.shop_domain || shopDomain).replace(/^https?:\/\//, "");
      const currency = await fetchShopCurrency({
        domain,
        accessToken: creds.access_token,
        apiVersion: SHOPIFY_API_VERSION,
      });
      const presentmentPrices = await fetchPresentmentPrices({
        domain,
        accessToken: creds.access_token,
        productId,
        apiVersion: SHOPIFY_API_VERSION,
      });
      const normalized = mapShopifyProductToNormalizedProduct(payload, {
        currency,
        presentmentPrices,
        publicStorefrontDomain: shopRow.public_storefront_domain,
      });
      await upsertProductKnowledge({
        serviceClient,
        creds,
        product: payload,
        normalized,
        currency,
        embedText,
      });
      const row = toShopProductRow(normalized, {
        shopRefId: creds.shop_id,
        syncedAt: new Date().toISOString(),
      });
      const rowWithEmbedding = {
        ...row,
        embedding: await embedText(`Product: ${row.title}. Details: ${row.description || "No details."}`),
      };
      await serviceClient.from("shop_products").upsert(rowWithEmbedding, {
        onConflict: "shop_ref_id,external_id,platform",
      });
      return NextResponse.json({ ok: true, topic, product_id: productId, indexed: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({
        event: "shopify.webhook.product_error",
        topic,
        shop_domain: shopDomain,
        error: message,
      }));
      return NextResponse.json({ ok: false, error: message }); // still 200
    }
  }

  if (topic !== "shop/update") {
    // Unknown topic — acknowledge so Shopify doesn't retry
    return NextResponse.json({ ok: true, topic, note: "ignored" });
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
