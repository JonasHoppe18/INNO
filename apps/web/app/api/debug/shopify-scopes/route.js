import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

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

const ACCESS_SCOPES_QUERY = `
  query CurrentAppInstallationAccessScopes {
    currentAppInstallation {
      accessScopes {
        handle
        description
      }
    }
  }
`;

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function fetchShopifyCredentials(serviceClient, scope, requestedShopId) {
  const shop = await resolveScopedShop(serviceClient, scope, requestedShopId, {
    platform: "shopify",
    fields: "id, shop_domain, access_token_encrypted",
    missingShopMessage: "shop_id is required.",
  });
  if (!shop?.id || !shop?.shop_domain) {
    throw new Error("Shop not found in your current scope.");
  }
  if (!shop?.access_token_encrypted) {
    throw new Error("Missing Shopify access token for this shop.");
  }
  return {
    shop_id: shop.id,
    shop_domain: String(shop.shop_domain).replace(/^https?:\/\//i, "").replace(/\/+$/, ""),
    access_token: decryptString(shop.access_token_encrypted),
  };
}

async function fetchGrantedScopes({ shopDomain, accessToken }) {
  const response = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: ACCESS_SCOPES_QUERY }),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.errors?.[0]?.message ||
      payload?.errors ||
      payload?.error ||
      `Shopify Admin GraphQL returned ${response.status}`;
    throw new Error(message);
  }

  const graphqlErrors = Array.isArray(payload?.errors) ? payload.errors : [];
  if (graphqlErrors.length) {
    throw new Error(graphqlErrors.map((entry) => entry?.message || "Unknown GraphQL error").join("; "));
  }

  const scopes = Array.isArray(payload?.data?.currentAppInstallation?.accessScopes)
    ? payload.data.currentAppInstallation.accessScopes
        .map((entry) => ({
          handle: String(entry?.handle || "").trim(),
          description: String(entry?.description || "").trim() || null,
        }))
        .filter((entry) => entry.handle)
    : [];

  return {
    scopes,
    current_app_installation: payload?.data?.currentAppInstallation
      ? {
          accessScopesCount: scopes.length,
        }
      : null,
  };
}

export async function GET(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service client could not be created." }, { status: 500 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
    if (!scope?.workspaceId && !scope?.supabaseUserId) {
      return NextResponse.json({ error: "Could not resolve workspace scope." }, { status: 404 });
    }

    const requestedShopId = String(new URL(request.url).searchParams.get("shop_id") || "").trim();
    const shop = await fetchShopifyCredentials(serviceClient, scope, requestedShopId);
    const granted = await fetchGrantedScopes({
      shopDomain: shop.shop_domain,
      accessToken: shop.access_token,
    });
    const grantedScopeHandles = granted.scopes.map((entry) => entry.handle);

    return NextResponse.json(
      {
        shop_id: shop.shop_id,
        shop_domain: shop.shop_domain,
        has_read_all_orders: grantedScopeHandles.includes("read_all_orders"),
        granted_scopes: grantedScopeHandles,
        current_app_installation: granted.current_app_installation,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not inspect Shopify scopes.";
    const status =
      /shop_id is required|shop not found|missing shopify access token/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
