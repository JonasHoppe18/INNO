import { NextResponse } from "next/server";
import {
  createServiceSupabase,
  generateOauthState,
  getUserId,
  isValidShopDomain,
  normalizeShopDomain,
} from "@/lib/server/shopify-oauth";

const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI || "";
const DEFAULT_SCOPES = "read_orders,read_all_orders,read_customers,read_products";

function resolveScopes(rawScopes) {
  const normalized = String(rawScopes || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  const scopeSet = new Set(normalized.length ? normalized : DEFAULT_SCOPES.split(","));
  if (scopeSet.has("read_orders")) {
    scopeSet.add("read_all_orders");
  }

  return Array.from(scopeSet).join(",");
}

export async function POST(request) {
  try {
    if (!SHOPIFY_REDIRECT_URI) {
      return NextResponse.json(
        { error: "SHOPIFY_REDIRECT_URI is missing on the server." },
        { status: 500 }
      );
    }

    const supabase = createServiceSupabase();
    const ownerUserId = await getUserId(request, supabase);

    if (!ownerUserId) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const shopDomain = normalizeShopDomain(body?.shop_domain || "");

    if (!shopDomain || !isValidShopDomain(shopDomain)) {
      return NextResponse.json(
        {
          error:
            "shop_domain must match /^[a-zA-Z0-9][a-zA-Z0-9-]*\\.myshopify\\.com$/.",
        },
        { status: 400 }
      );
    }

    const { data: integration, error: fetchError } = await supabase
      .from("shops")
      .select("id, shopify_client_id, shopify_client_secret_encrypted")
      .eq("owner_user_id", ownerUserId)
      .eq("platform", "shopify")
      .eq("shop_domain", shopDomain)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!integration) {
      return NextResponse.json(
        { error: "No Shopify credentials saved for this shop." },
        { status: 404 }
      );
    }

    if (!integration.shopify_client_id || !integration.shopify_client_secret_encrypted) {
      return NextResponse.json(
        { error: "Missing client_id or client_secret. Save credentials first." },
        { status: 400 }
      );
    }

    const state = generateOauthState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("shops")
      .update({
        oauth_state: state,
        oauth_state_expires_at: expiresAt,
      })
      .eq("id", integration.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const authorizeUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", integration.shopify_client_id);
    authorizeUrl.searchParams.set("scope", resolveScopes(null));
    authorizeUrl.searchParams.set("redirect_uri", SHOPIFY_REDIRECT_URI);
    authorizeUrl.searchParams.set("state", state);

    return NextResponse.json({ authorizeUrl: authorizeUrl.toString() }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while starting Shopify OAuth.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
