import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/server/shopify-oauth";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const authState = await auth();
    if (!authState?.userId) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const supabase = createServiceSupabase();
    const scope = await resolveAuthScope(supabase, {
      clerkUserId: authState.userId,
      orgId: authState.orgId,
      sessionClaims: authState.sessionClaims,
    });
    if (!scope?.workspaceId) return NextResponse.json({ products: [], available: false });
    let shop;
    try {
      shop = await resolveScopedShop(supabase, scope, undefined, {
        fields: "id,workspace_id",
        platform: "shopify",
        allowSingleScopedFallback: true,
      });
    } catch {
      return NextResponse.json({ products: [], available: false });
    }
    const query = String(new URL(request.url).searchParams.get("q") || "").trim();
    let productQuery = supabase
      .from("shop_products")
      .select("id,external_id,title,handle,shop_ref_id")
      .eq("shop_ref_id", shop.id)
      .order("title", { ascending: true })
      .limit(200);
    if (query) productQuery = productQuery.ilike("title", `%${query}%`);
    const { data, error } = await productQuery;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      available: true,
      products: (Array.isArray(data) ? data : []).map((product) => ({
        id: String(product.id),
        external_id: String(product.external_id || ""),
        title: String(product.title || ""),
        handle: String(product.handle || ""),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load products." }, { status: 500 });
  }
}
