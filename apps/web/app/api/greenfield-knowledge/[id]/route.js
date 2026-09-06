import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/server/shopify-oauth";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { SupabaseKnowledgeStore } from "@/lib/greenfield-support";
import {
  buildMerchantKnowledgeSource,
  productIdsFromPayload,
  serializeGreenfieldKnowledge,
  validateKnowledgePayload,
} from "@/lib/server/greenfield-knowledge";

export const runtime = "nodejs";

const RECORD_FIELDS = "id,workspace_id,knowledge_type,authority,title,content,structured_data,source_kind,source_id,source_uri,source_label,content_hash,published_at,observed_at,expires_at,metadata,created_at,updated_at";

async function scopedRecord(id) {
  const authState = await auth();
  if (!authState?.userId) return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  const supabase = createServiceSupabase();
  const scope = await resolveAuthScope(supabase, {
    clerkUserId: authState.userId,
    orgId: authState.orgId,
    sessionClaims: authState.sessionClaims,
  });
  if (!scope?.workspaceId) return { error: NextResponse.json({ error: "A single active workspace is required." }, { status: 403 }) };
  const { data, error } = await supabase
    .from("greenfield_knowledge_records")
    .select(RECORD_FIELDS)
    .eq("workspace_id", scope.workspaceId)
    .eq("id", String(id || ""))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { error: NextResponse.json({ error: "Knowledge record not found." }, { status: 404 }) };
  return { authState, supabase, scope, record: data };
}

async function resolveProducts(supabase, scope, productIds) {
  if (!productIds.length) return { products: [] };
  if (productIds.some((id) => !/^\d+$/.test(id))) return { error: "Product selection is invalid." };
  const { data: shops, error: shopError } = await supabase
    .from("shops")
    .select("id,workspace_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("platform", "shopify")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(2);
  if (shopError) return { error: shopError.message };
  const shop = Array.isArray(shops) && shops.length === 1 ? shops[0] : null;
  if (!shop) return { error: "Specific product selection is unavailable without one connected Shopify store." };
  const { data, error } = await supabase
    .from("shop_products")
    .select("id,external_id,title,shop_ref_id")
    .eq("shop_ref_id", shop.id)
    .in("id", productIds.map(Number));
  if (error) return { error: error.message };
  const products = Array.isArray(data) ? data : [];
  if (products.length !== new Set(productIds).size) return { error: "One or more selected products are not available in the current workspace." };
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

export async function GET(_request, { params }) {
  try {
    const scoped = await scopedRecord(params?.id);
    if (scoped.error) return scoped.error;
    return NextResponse.json({ record: serializeGreenfieldKnowledge(scoped.record) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load greenfield knowledge." }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const scoped = await scopedRecord(params?.id);
    if (scoped.error) return scoped.error;
    const { supabase, scope, record } = scoped;
    if (String(record.source_kind || "").toLowerCase() !== "merchant_authored") {
      return NextResponse.json({ error: "Imported knowledge is read-only. Create a merchant-authored entry for corrections." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const validation = validateKnowledgePayload(body, { existing: record });
    if (!validation.valid) return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 400 });
    const productResult = await resolveProducts(supabase, scope, productIdsFromPayload(validation.value));
    if (productResult.error) return NextResponse.json({ error: productResult.error }, { status: 400 });
    const source = buildMerchantKnowledgeSource({ value: validation.value, existing: record, products: productResult.products });
    const stored = await new SupabaseKnowledgeStore(supabase).replaceSource(scope.workspaceId, String(record.source_id), source);
    const updated = await reloadRecord(supabase, scope, stored.id);
    return NextResponse.json({ record: serializeGreenfieldKnowledge(updated) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update greenfield knowledge." }, { status: 500 });
  }
}
