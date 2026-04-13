import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import { credsFromShopRow, runPolicySyncForCreds, SOURCE_PROVIDER } from "@/lib/server/shopify-policy-sync";
import { decryptString } from "@/lib/server/shopify-oauth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function fetchShopifyCredentials(serviceClient, scope, requestedShopId) {
  const data = await resolveScopedShop(serviceClient, scope, requestedShopId, {
    platform: "shopify",
    fields: "id, shop_domain, access_token_encrypted, platform, workspace_id",
    missingShopMessage: "shop_id is required for Shopify knowledge sync.",
  });
  if (!data?.id || !data?.shop_domain || !data?.access_token_encrypted) {
    throw new Error("Missing Shopify credentials.");
  }
  return {
    shop_id: data.id,
    workspace_id: data.workspace_id ?? null,
    platform: data.platform,
    shop_domain: data.shop_domain,
    access_token: decryptString(data.access_token_encrypted),
  };
}

async function fetchActiveShopIds(serviceClient, scope) {
  let query = serviceClient
    .from("shops")
    .select("id")
    .eq("platform", "shopify")
    .is("uninstalled_at", null);
  query = applyScope(query, scope, { workspaceColumn: "workspace_id", userColumn: "owner_user_id" });
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map((row) => row?.id).filter(Boolean);
}

async function countIndexedPolicies(serviceClient, shopIds) {
  if (!shopIds.length) return 0;
  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("source_id, metadata")
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER);
  if (error) throw new Error(error.message);
  const ids = new Set();
  for (const row of data || []) {
    const sourceId = String(row?.source_id || "").trim();
    if (sourceId) { ids.add(sourceId); continue; }
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const policyId = String(metadata?.policy_id || "").trim();
    if (policyId) ids.add(`shopify:policy:${policyId}`);
  }
  return ids.size;
}

async function fetchPoliciesPreview(serviceClient, shopIds, limit = 50) {
  if (!shopIds.length) return [];
  const normalizedLimit = Math.max(1, Math.min(limit, 200));
  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("source_id, metadata, created_at")
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER)
    .order("created_at", { ascending: false })
    .limit(normalizedLimit * 6);
  if (error) throw new Error(error.message);

  const bySource = new Map();
  for (const row of data || []) {
    const sourceId = String(row?.source_id || "").trim();
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const policyId = String(metadata?.policy_id || "").trim();
    const key = sourceId || (policyId ? `shopify:policy:${policyId}` : "");
    if (!key || bySource.has(key)) continue;
    bySource.set(key, {
      external_id: policyId || key.replace(/^shopify:policy:/, ""),
      title: String(metadata?.title || "Untitled policy"),
      handle: String(metadata?.handle || "").trim() || null,
      url: String(metadata?.url || "").trim() || null,
      updated_at: metadata?.page_updated_at || row?.created_at || null,
    });
    if (bySource.size >= normalizedLimit) break;
  }
  return Array.from(bySource.values());
}

export async function GET(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service key missing" }, { status: 500 });
  }
  const serviceClient = createServiceClient();
  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
    if (!scope?.workspaceId && !scope?.supabaseUserId) throw new Error("Could not resolve workspace/user scope.");
    const requestedShopId = String(request?.nextUrl?.searchParams?.get("shop_id") || "").trim();
    const shop = await fetchShopifyCredentials(serviceClient, scope, requestedShopId);
    const shopIds = [shop.shop_id];
    const count = await countIndexedPolicies(serviceClient, shopIds);
    const includePolicies = String(request?.nextUrl?.searchParams?.get("include_policies") || "") === "1";
    if (!includePolicies) return NextResponse.json({ success: true, count }, { status: 200 });
    const policies = await fetchPoliciesPreview(serviceClient, shopIds, 50);
    return NextResponse.json({ success: true, count, policies }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Count failed" },
      { status: 400 }
    );
  }
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service key missing" }, { status: 500 });
  }
  const serviceClient = createServiceClient();
  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
    if (!scope?.workspaceId && !scope?.supabaseUserId) throw new Error("Could not resolve workspace/user scope.");
    const body = await request.json().catch(() => ({}));
    const requestedShopId = String(body?.shop_id || "").trim();
    const shop = await fetchShopifyCredentials(serviceClient, scope, requestedShopId);
    if (shop.platform && shop.platform !== "shopify") throw new Error("Platform not supported yet");

    console.info(JSON.stringify({
      event: "knowledge.sync.start",
      provider: "shopify_policy",
      requested_shop_id: requestedShopId || null,
      resolved_shop_id: shop.shop_id,
      workspace_id: shop.workspace_id ?? null,
    }));

    const result = await runPolicySyncForCreds({ serviceClient, creds: shop });

    console.info(JSON.stringify({
      event: "knowledge.sync.wrote",
      provider: "shopify_policy",
      resolved_shop_id: shop.shop_id,
      workspace_id: shop.workspace_id ?? null,
      rows_written: Number(result?.updated_chunks ?? 0),
    }));

    return NextResponse.json({ success: true, platform: "shopify", ...result }, { status: 200 });
  } catch (error) {
    console.error(JSON.stringify({ event: "knowledge.sync.error", provider: "shopify_policy", error: error instanceof Error ? error.message : "Sync failed" }));
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 400 }
    );
  }
}
