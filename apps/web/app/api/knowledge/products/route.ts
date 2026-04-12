import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const shop = await resolveScopedShop(supabase, scope, undefined, { fields: "id", allowSingleScopedFallback: true }) as { id?: string } | null;
  if (!shop?.id) {
    return NextResponse.json({ products: [] });
  }

  // Fetch products for shop, ordered by title
  const { data: products, error } = await supabase
    .from("shop_products")
    .select("id, external_id, title, price")
    .eq("shop_ref_id", shop.id)
    .order("title", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Count product-specific knowledge snippets per product
  const { data: knowledgeRows } = await (supabase as any)
    .from("agent_knowledge")
    .select("metadata")
    .eq("shop_id", shop.id)
    .eq("source_provider", "manual_text")
    .eq("metadata->>category" as any, "product-questions")
    .not("metadata->>product_id" as any, "is", null)
    .eq("metadata->>chunk_index" as any, "0");

  const countByProductId: Record<string, number> = {};
  for (const row of knowledgeRows || []) {
    const pid = (row.metadata as any)?.product_id as string | undefined;
    if (pid) countByProductId[pid] = (countByProductId[pid] || 0) + 1;
  }

  const result = (products || []).map((p) => ({
    id: p.id,
    external_id: String(p.external_id || ""),
    title: String(p.title || ""),
    price: p.price ? String(p.price) : null,
    snippet_count: countByProductId[String(p.external_id)] || 0,
  }));

  return NextResponse.json({ products: result, shop_id: shop.id });
}
