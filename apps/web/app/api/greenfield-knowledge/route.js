import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/server/shopify-oauth";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import { SupabaseKnowledgeStore } from "@/lib/greenfield-support";
import {
  buildMerchantKnowledgeSource,
  productIdsFromPayload,
  serializeGreenfieldKnowledge,
  validateKnowledgePayload,
} from "@/lib/server/greenfield-knowledge";

export const runtime = "nodejs";

const RECORD_FIELDS = "id,workspace_id,knowledge_type,authority,title,content,structured_data,source_kind,source_id,source_uri,source_label,content_hash,published_at,observed_at,expires_at,metadata,created_at,updated_at";

async function scopedRequest() {
  const authState = await auth();
  if (!authState?.userId) return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  const supabase = createServiceSupabase();
  const scope = await resolveAuthScope(supabase, {
    clerkUserId: authState.userId,
    orgId: authState.orgId,
    sessionClaims: authState.sessionClaims,
  });
  if (!scope?.workspaceId) {
    return { error: NextResponse.json({ error: "A single active workspace is required." }, { status: 403 }) };
  }
  return { authState, supabase, scope };
}

async function resolveProducts(supabase, scope, productIds) {
  if (!productIds.length) return { products: [] };
  if (productIds.some((id) => !/^\d+$/.test(id))) {
    return { error: "Product selection is invalid." };
  }
  let shop;
  try {
    shop = await resolveScopedShop(supabase, scope, undefined, {
      fields: "id,workspace_id",
      platform: "shopify",
      allowSingleScopedFallback: true,
      missingShopMessage: "Specific product selection is unavailable without a connected Shopify store.",
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Specific product selection is unavailable." };
  }
  const numericIds = productIds.map((id) => Number(id));
  const { data, error } = await supabase
    .from("shop_products")
    .select("id,external_id,title,shop_ref_id")
    .eq("shop_ref_id", shop.id)
    .in("id", numericIds);
  if (error) return { error: error.message };
  const products = Array.isArray(data) ? data : [];
  if (products.length !== new Set(productIds).size) {
    return { error: "One or more selected products are not available in the current workspace." };
  }
  return { products };
}

async function reloadRecord(supabase, scope, id) {
  const { data, error } = await supabase
    .from("greenfield_knowledge_records")
    .select(RECORD_FIELDS)
    .eq("workspace_id", scope.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function GET(request) {
  try {
    const scoped = await scopedRequest();
    if (scoped.error) return scoped.error;
    const { supabase, scope } = scoped;
    const url = new URL(request.url);
    const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const type = String(url.searchParams.get("type") || "").trim().toLowerCase();
    const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
    const source = String(url.searchParams.get("source") || "").trim().toLowerCase();
    const { data, error } = await supabase
      .from("greenfield_knowledge_records")
      .select(RECORD_FIELDS)
      .eq("workspace_id", scope.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(300);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const records = (Array.isArray(data) ? data : [])
      .map(serializeGreenfieldKnowledge)
      .filter((record) => !query || `${record.title} ${record.content}`.toLowerCase().includes(query))
      .filter((record) => !type || record.type === type)
      .filter((record) => !status || record.status === status)
      .filter((record) => !source || record.source.label.toLowerCase() === source);
    return NextResponse.json({ records });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load greenfield knowledge." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const scoped = await scopedRequest();
    if (scoped.error) return scoped.error;
    const { supabase, scope } = scoped;
    const body = await request.json().catch(() => ({}));
    const validation = validateKnowledgePayload(body);
    if (!validation.valid) return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 400 });
    const productResult = await resolveProducts(supabase, scope, productIdsFromPayload(validation.value));
    if (productResult.error) return NextResponse.json({ error: productResult.error }, { status: 400 });
    const source = buildMerchantKnowledgeSource({ value: validation.value, products: productResult.products });
    const stored = await new SupabaseKnowledgeStore(supabase).ingest(scope.workspaceId, source);
    const record = await reloadRecord(supabase, scope, stored.id);
    return NextResponse.json({ record: serializeGreenfieldKnowledge(record) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save greenfield knowledge." }, { status: 500 });
  }
}
