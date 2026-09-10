import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/server/shopify-oauth";
import { decryptString } from "@/lib/server/shopify-oauth";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import { SupabaseKnowledgeStore } from "@/lib/greenfield-support";
import { fetchShopifyKnowledge } from "@/lib/server/greenfield-shopify-source";

export const runtime = "nodejs";

const SHOP_FIELDS = "id,workspace_id,platform,shop_domain,public_storefront_domain,access_token_encrypted";

function lifecycleStatus(row) {
  const value = String(row?.metadata?.lifecycle_status || "published").trim().toLowerCase();
  return ["draft", "published", "unpublished", "archived"].includes(value) ? value : "published";
}

async function scopedShopRequest() {
  const authState = await auth();
  if (!authState?.userId) return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  const supabase = createServiceSupabase();
  const scope = await resolveAuthScope(supabase, {
    clerkUserId: authState.userId,
    orgId: authState.orgId,
    sessionClaims: authState.sessionClaims,
  });
  if (!scope?.workspaceId) return { error: NextResponse.json({ error: "A single active workspace is required." }, { status: 403 }) };
  try {
    const shop = await resolveScopedShop(supabase, scope, "", {
      fields: SHOP_FIELDS,
      platform: "shopify",
      allowSingleScopedFallback: true,
      missingShopMessage: "Connect one Shopify store before importing Shopify knowledge.",
    });
    if (!shop?.id || !shop.shop_domain || !shop.access_token_encrypted) {
      throw new Error("The connected Shopify store is missing credentials.");
    }
    return { supabase, scope, shop, credentials: {
      shopId: String(shop.id),
      shopDomain: String(shop.shop_domain),
      publicStorefrontDomain: String(shop.public_storefront_domain || ""),
      accessToken: decryptString(shop.access_token_encrypted),
    } };
  } catch (error) {
    return { supabase, scope, error: NextResponse.json({ error: error instanceof Error ? error.message : "No unambiguous Shopify store is available." }, { status: 409 }) };
  }
}

async function sourceSummary(supabase, workspaceId, sourceId) {
  const sourceResult = await supabase
    .from("greenfield_knowledge_sources")
    .select("id,title,source_version,status,source_label,updated_at,metadata")
    .eq("workspace_id", workspaceId)
    .eq("source_kind", "shopify")
    .eq("source_id", sourceId)
    .maybeSingle();
  if (sourceResult.error) throw new Error(sourceResult.error.message);
  if (!sourceResult.data) return null;

  const recordsResult = await supabase
    .from("greenfield_knowledge_records")
    .select("id,knowledge_type,metadata")
    .eq("workspace_id", workspaceId)
    .eq("source_uuid", sourceResult.data.id);
  if (recordsResult.error) throw new Error(recordsResult.error.message);
  const records = Array.isArray(recordsResult.data) ? recordsResult.data : [];
  const counts = records.reduce((result, row) => {
    const status = lifecycleStatus(row);
    result[status] = (result[status] || 0) + 1;
    result.total += 1;
    return result;
  }, { total: 0, draft: 0, published: 0, unpublished: 0, archived: 0 });
  return {
    title: String(sourceResult.data.title || "Shopify"),
    label: String(sourceResult.data.source_label || "Shopify"),
    version: Number(sourceResult.data.source_version || 1),
    status: String(sourceResult.data.status || "draft"),
    updated_at: sourceResult.data.updated_at || null,
    counts,
  };
}

export async function GET() {
  try {
    const scoped = await scopedShopRequest();
    if (scoped.error) {
      if (scoped.error.status === 409) return NextResponse.json({ connected: false, source: null });
      return scoped.error;
    }
    const source = await sourceSummary(scoped.supabase, scoped.scope.workspaceId, `shopify:${scoped.shop.id}`);
    return NextResponse.json({ connected: true, source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load Shopify knowledge source." }, { status: 500 });
  }
}

export async function POST() {
  try {
    const scoped = await scopedShopRequest();
    if (scoped.error) return scoped.error;
    const { supabase, scope, credentials } = scoped;
    const fetched = await fetchShopifyKnowledge(credentials);
    if (!fetched.source.candidates.length) {
      return NextResponse.json({
        connected: true,
        imported: false,
        fetched: { policies: fetched.policies.length, products: fetched.products.length },
        source: null,
        message: "Shopify returned no non-empty policy or product content. Existing knowledge was left unchanged.",
      });
    }
    const store = new SupabaseKnowledgeStore(supabase);
    const result = await store.ingestSource(scope.workspaceId, fetched.source);
    const source = await sourceSummary(supabase, scope.workspaceId, `shopify:${credentials.shopId}`);
    return NextResponse.json({
      connected: true,
      imported: true,
      fetched: { policies: fetched.policies.length, products: fetched.products.length },
      source,
      candidate_count: result.records.length,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not import Shopify knowledge." }, { status: 502 });
  }
}
