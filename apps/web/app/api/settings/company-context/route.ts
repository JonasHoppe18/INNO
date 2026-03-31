import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
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
  if (!clerkUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase config missing" }, { status: 500 });

  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
  const shop = await resolveScopedShop(serviceClient, scope, undefined, {
    fields: "id, shop_name, brand_description, product_overview, support_identity, reply_greeting",
  }) as Record<string, unknown> | null;

  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  return NextResponse.json({
    shop_name: shop.shop_name ?? "",
    brand_description: shop.brand_description ?? "",
    product_overview: shop.product_overview ?? "",
    support_identity: shop.support_identity ?? "",
    reply_greeting: shop.reply_greeting ?? "",
  });
}

export async function PUT(request: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase config missing" }, { status: 500 });

  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
  const shop = await resolveScopedShop(serviceClient, scope, undefined, { fields: "id" }) as { id?: string } | null;
  if (!shop?.id) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const payload = await request.json().catch(() => ({}));

  const updates: Record<string, string | null> = {};
  if ("shop_name" in payload) updates.shop_name = String(payload.shop_name || "").trim() || null;
  if ("brand_description" in payload) updates.brand_description = String(payload.brand_description || "").trim() || null;
  if ("product_overview" in payload) updates.product_overview = String(payload.product_overview || "").trim() || null;
  if ("support_identity" in payload) updates.support_identity = String(payload.support_identity || "").trim() || null;
  if ("reply_greeting" in payload) updates.reply_greeting = String(payload.reply_greeting || "").trim() || null;

  const { error } = await serviceClient.from("shops").update(updates).eq("id", shop.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
