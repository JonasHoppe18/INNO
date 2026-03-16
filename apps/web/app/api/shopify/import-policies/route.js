
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";
import { applyScope, resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import { mapPoliciesFromShopify, summarizePolicies } from "@/lib/server/policy-summary";

const SUPABASE_BASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const SUPABASE_TEMPLATE =
  process.env.NEXT_PUBLIC_CLERK_SUPABASE_TEMPLATE?.trim() ||
  process.env.EXPO_PUBLIC_CLERK_SUPABASE_TEMPLATE?.trim() ||
  "supabase";

const SHOPIFY_API_VERSION = "2024-01";

function normalizeDomain(input = "") {
  const trimmed = input.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.includes(".")) return trimmed;
  // Hvis brugeren kun har angivet shop-navnet, tilføj standard Shopify-domænet.
  return `${trimmed}.myshopify.com`;
}

function createServiceSupabase() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

async function fetchShopCredentials(serviceClient, scope, requestedShopId) {
  if (!serviceClient || (!scope?.workspaceId && !scope?.supabaseUserId)) return null;
  const data = await resolveScopedShop(serviceClient, scope, requestedShopId, {
    platform: "shopify",
    fields: "shop_domain, access_token_encrypted",
    missingShopMessage: "shop_id is required for Shopify policy import.",
  });
  if (!data) return null;

  if (!data.access_token_encrypted) {
    return { shop_domain: data.shop_domain, access_token: null };
  }

  try {
    return {
      shop_domain: data.shop_domain,
      access_token: decryptString(data.access_token_encrypted),
    };
  } catch (decryptError) {
    throw new Error(
      `Could not decrypt Shopify token: ${
        decryptError instanceof Error ? decryptError.message : String(decryptError)
      }`
    );
  }
}

async function fetchShopRowService(serviceClient, scope, requestedShopId) {
  if (!serviceClient || (!scope?.workspaceId && !scope?.supabaseUserId)) return { data: null, error: null };
  try {
    const data = await resolveScopedShop(serviceClient, scope, requestedShopId, {
      platform: "shopify",
      fields:
        "id, shop_domain, policy_refund, policy_shipping, policy_terms, policy_privacy, policy_summary_json, policy_summary_version, policy_summary_updated_at, internal_tone",
      missingShopMessage: "shop_id is required for Shopify policy import.",
    });
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

async function getShopRecord({ token, requestedShopId }) {
  if (!token) return { data: null, error: "auth_missing" };
  if (!requestedShopId) {
    return { data: null, error: "shop_id_missing" };
  }

  if (!SUPABASE_BASE_URL || !SUPABASE_ANON_KEY) {
    return { data: null, error: "supabase_config_missing" };
  }

  const url = new URL("/rest/v1/shops", SUPABASE_BASE_URL);
  url.searchParams.set(
    "select",
    [
      "id",
      "shop_domain",
      "policy_refund",
      "policy_shipping",
      "policy_terms",
      "policy_privacy",
      "policy_summary_json",
      "policy_summary_version",
      "policy_summary_updated_at",
      "internal_tone",
    ].join(",")
  );
  url.searchParams.set("id", `eq.${requestedShopId}`);
  url.searchParams.set("platform", "eq.shopify");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message =
      payload?.message ||
      payload?.error ||
      payload?.hint ||
      `Could not fetch store (status ${response.status}).`;
    return { data: null, error: `${message}` };
  }

  const list = await response.json().catch(() => []);
  const record = Array.isArray(list) && list.length > 0 ? list[0] : null;
  if (!record) {
    return { data: null, error: "No Shopify store found. Connect in Integrations first." };
  }
  return { data: record, error: null };
}

export async function POST(request) {
  const { userId: clerkUserId, orgId, getToken } = auth();
  if (!clerkUserId) {
    return NextResponse.json(
      { error: "You must be signed in to fetch policies." },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const requestedShopId = String(body?.shop_id || "").trim();
  const bodyDomain = body?.shop_domain || body?.shopDomain || body?.domain || null;
  const bodyToken = body?.access_token || body?.accessToken || body?.token || null;

  const supabaseToken =
    (await getToken({ template: SUPABASE_TEMPLATE })) || (await getToken());

  let shop = null;
  let shopError = null;
  let decrypted = null;
  let scope = null;
  let serviceClient = null;

  // Forsøg at hente dekrypteret token via service role (samme som edge functions gør).
  if (SUPABASE_SERVICE_KEY) {
    try {
      serviceClient = createServiceSupabase();
      scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
      if (scope?.workspaceId || scope?.supabaseUserId) {
        decrypted = await fetchShopCredentials(serviceClient, scope, requestedShopId);
        if (!bodyDomain || !bodyToken) {
          const { data: shopRow } = await fetchShopRowService(serviceClient, scope, requestedShopId);
          if (shopRow) {
            shop = shopRow;
          }
        }
      }
    } catch (error) {
      console.warn("Dekryptering af Shopify token fejlede:", error);
    }
  }
  // Kun slå Supabase op hvis vi ikke fik domæne/token i requesten.
  if ((!bodyDomain || !bodyToken) && !shop) {
  const result = await getShopRecord({
    token: supabaseToken,
    requestedShopId,
  });
    shop = result.data;
    shopError = result.error;
  }

  if (shopError && !bodyDomain && !bodyToken) {
    const message =
      shopError === "auth_missing"
        ? "No access to Supabase token. Please sign in again."
        : shopError === "shop_id_missing"
        ? "shop_id is required for Shopify policy import."
        : shopError === "supabase_config_missing"
        ? "Supabase configuration is missing on the server."
        : shopError;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let domain = "";
  let domainSource = "";
  if (bodyDomain) {
    domain = normalizeDomain(bodyDomain);
    domainSource = "body";
  } else if (decrypted?.shop_domain) {
    domain = normalizeDomain(decrypted?.shop_domain || "");
    domainSource = "decrypted";
  } else if (shop?.shop_domain) {
    domain = normalizeDomain(shop?.shop_domain || "");
    domainSource = "shop_row";
  }

  let token = "";
  let tokenSource = "";
  if (bodyToken) {
    token = bodyToken;
    tokenSource = "body";
  } else if (decrypted?.access_token) {
    token = decrypted.access_token;
    tokenSource = "decrypted";
  }

  if (!domain || !token) {
    return NextResponse.json(
      {
        error:
          "Missing Shopify domain or access token. Connect Shopify first, or send shop_domain and access_token in the body.",
        debug: {
          domainSource,
          tokenSource,
          hasServiceKey: Boolean(SUPABASE_SERVICE_KEY),
          hasSupabaseToken: Boolean(supabaseToken),
        },
      },
      { status: 400 }
    );
  }

  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/policies.json`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error("Shopify fetch failed:", error);
    return NextResponse.json(
      {
        error: `Could not contact Shopify for ${domain}. Check domain/access token.`,
      },
      { status: 502 }
    );
  }

  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => null);
    return text ? { error: text } : {};
  });
  if (!response.ok) {
    const baseMessage =
      payload?.errors ||
      payload?.error ||
      payload?.error_description ||
      response.statusText ||
      `Shopify returned status ${response.status}.`;
    const scopeHint =
      response.status === 401 || response.status === 403
        ? " Check that the Admin API access token is correct and has scope `read_legal_policies`."
        : "";
    const message = `${baseMessage}${scopeHint}`;
    return NextResponse.json({ error: message }, { status: response.status });
  }

  const policies = Array.isArray(payload?.policies) ? payload.policies : [];
  const mapped = mapPoliciesFromShopify(policies);
  const summaryPayload = await summarizePolicies({
    refundPolicy: mapped.refund || "",
    shippingPolicy: mapped.shipping || "",
    termsPolicy: mapped.terms || "",
    privacyPolicy: mapped.privacy || "",
  });

  let persisted = false;
  if (serviceClient && (scope?.workspaceId || scope?.supabaseUserId) && shop?.id) {
    let updateQuery = serviceClient
      .from("shops")
      .update({
        policy_refund: mapped.refund || "",
        policy_shipping: mapped.shipping || "",
        policy_terms: mapped.terms || "",
        policy_privacy: mapped.privacy || "",
        policy_summary_json: summaryPayload.summary,
        policy_summary_version: summaryPayload.version,
        policy_summary_updated_at: summaryPayload.updated_at,
      })
      .eq("id", shop.id);
    updateQuery = applyScope(updateQuery, scope, { workspaceColumn: "workspace_id", userColumn: "owner_user_id" });
    const { error: persistError } = await updateQuery;
    if (!persistError) {
      persisted = true;
    } else {
      console.warn("shopify/import-policies: failed to persist policies", persistError.message);
    }
  }

  const meta = {
    policyCount: policies.length,
    policyTypes: mapped.found,
    persisted,
    policySummaryVersion: summaryPayload.version,
    policySummaryFallback: summaryPayload.used_fallback,
  };

  return NextResponse.json(
    {
      refund: mapped.refund,
      shipping: mapped.shipping,
      terms: mapped.terms,
      privacy: mapped.privacy,
      policy_summary: summaryPayload.summary,
      meta,
    },
    { status: 200 }
  );
}
