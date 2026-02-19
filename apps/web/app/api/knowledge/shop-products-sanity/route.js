import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveShopId } from "@/lib/server/shops";

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

async function resolveSupabaseUserId(serviceClient, clerkUserId) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.user_id) throw new Error("Supabase user not found for this Clerk user.");
  return data.user_id;
}

export async function POST() {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service key missing" }, { status: 500 });
  }

  const serviceClient = createServiceClient();

  try {
    const supabaseUserId = await resolveSupabaseUserId(serviceClient, userId);
    const shopRefId = await resolveShopId(serviceClient, { ownerUserId: supabaseUserId });

    const externalId = `sanity-${Date.now()}`;
    const row = {
      shop_ref_id: shopRefId,
      external_id: externalId,
      platform: "shopify",
      title: "Sanity Product",
      description: "shop_ref_id regression sanity check",
      price: "0.00",
      embedding: null,
    };

    const { error: upsertError } = await serviceClient
      .from("shop_products")
      .upsert(row, { onConflict: "shop_ref_id,external_id,platform" });

    if (upsertError) {
      if (upsertError.code === "42P10") {
        throw new Error(
          `${upsertError.message}. Missing unique constraint for shop_products upsert. ` +
            "TODO SQL: create unique index if not exists shop_products_shop_ref_external_platform_idx " +
            "on public.shop_products(shop_ref_id, external_id, platform);",
        );
      }
      throw new Error(upsertError.message);
    }

    const { data: inserted, error: insertedError } = await serviceClient
      .from("shop_products")
      .select("id, shop_ref_id, shop_id, external_id, platform, title")
      .eq("shop_ref_id", shopRefId)
      .eq("external_id", externalId)
      .eq("platform", "shopify")
      .maybeSingle();

    if (insertedError) throw new Error(insertedError.message);
    if (!inserted) throw new Error("Sanity insert not found after upsert.");

    const { data: byShopRef, error: fetchError } = await serviceClient
      .from("shop_products")
      .select("id, shop_ref_id, external_id, platform, title")
      .eq("shop_ref_id", shopRefId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (fetchError) throw new Error(fetchError.message);

    const shopRefMatches = inserted.shop_ref_id === shopRefId;
    const legacyShopIdUnused = !inserted.shop_id;

    return NextResponse.json(
      {
        success: true,
        synced: 1,
        checks: {
          shopRefMatches,
          legacyShopIdUnused,
        },
        inserted,
        fetchedCount: Array.isArray(byShopRef) ? byShopRef.length : 0,
        fetched: Array.isArray(byShopRef) ? byShopRef : [],
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sanity check failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
