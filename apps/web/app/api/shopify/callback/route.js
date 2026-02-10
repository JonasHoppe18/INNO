import { NextResponse } from "next/server";
import {
  createServiceSupabase,
  decryptString,
  encryptString,
  isValidShopDomain,
  normalizeShopDomain,
  verifyShopifyHmac,
} from "@/lib/server/shopify-oauth";

const APP_URL = process.env.APP_URL || "https://sona-ai.dk";

function buildRedirectUrl(shop, status) {
  const url = new URL("/integrations", APP_URL);
  url.searchParams.set("shop", shop);
  url.searchParams.set("shopify", status);
  return url;
}

export async function GET(request) {
  try {
    const params = request.nextUrl.searchParams;

    const shop = normalizeShopDomain(params.get("shop") || "");
    const code = String(params.get("code") || "").trim();
    const state = String(params.get("state") || "").trim();
    const hmac = String(params.get("hmac") || "").trim();
    const timestamp = String(params.get("timestamp") || "").trim();

    if (!shop || !code || !state || !hmac || !timestamp) {
      return NextResponse.json(
        { error: "Missing one or more required query parameters (shop, code, state, hmac, timestamp)." },
        { status: 400 }
      );
    }

    if (!isValidShopDomain(shop)) {
      return NextResponse.json(
        {
          error:
            "shop must match /^[a-zA-Z0-9][a-zA-Z0-9-]*\\.myshopify\\.com$/.",
        },
        { status: 400 }
      );
    }

    const supabase = createServiceSupabase();
    const { data: integration, error: lookupError } = await supabase
      .from("shops")
      .select(
        "id, shopify_client_id, shopify_client_secret_encrypted, oauth_state_expires_at, created_at"
      )
      .eq("platform", "shopify")
      .eq("shop_domain", shop)
      .eq("oauth_state", state)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 });
    }

    if (!integration) {
      return NextResponse.json({ error: "Invalid OAuth state." }, { status: 400 });
    }

    if (!integration.oauth_state_expires_at) {
      return NextResponse.json({ error: "OAuth state expired." }, { status: 400 });
    }

    const stateExpires = new Date(integration.oauth_state_expires_at).getTime();
    if (!Number.isFinite(stateExpires) || stateExpires <= Date.now()) {
      return NextResponse.json({ error: "OAuth state expired." }, { status: 400 });
    }

    if (!integration.shopify_client_id || !integration.shopify_client_secret_encrypted) {
      return NextResponse.json(
        { error: "Missing Shopify app credentials for this shop." },
        { status: 400 }
      );
    }

    const clientSecret = decryptString(integration.shopify_client_secret_encrypted);

    const validHmac = verifyShopifyHmac({
      searchParams: params,
      clientSecret,
      providedHmac: hmac,
    });

    if (!validHmac) {
      return NextResponse.json({ error: "Invalid Shopify HMAC signature." }, { status: 401 });
    }

    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: integration.shopify_client_id,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenPayload = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenPayload?.access_token) {
      const message =
        tokenPayload?.error_description ||
        tokenPayload?.error ||
        tokenPayload?.errors ||
        `Shopify token exchange failed with status ${tokenRes.status}.`;

      return NextResponse.json(
        { error: typeof message === "string" ? message : JSON.stringify(message) },
        { status: 400 }
      );
    }

    const encryptedAccessToken = encryptString(tokenPayload.access_token);

    const { error: updateError } = await supabase
      .from("shops")
      .update({
        access_token_encrypted: encryptedAccessToken,
        installed_at: new Date().toISOString(),
        uninstalled_at: null,
        oauth_state: null,
        oauth_state_expires_at: null,
      })
      .eq("id", integration.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.redirect(buildRedirectUrl(shop, "connected"), 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error during Shopify callback.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
