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

  const shop = await resolveScopedShop(supabase, scope, undefined, {
    fields: "id, policy_refund, policy_shipping",
    allowSingleScopedFallback: true,
  }) as { id?: string; policy_refund?: string; policy_shipping?: string } | null;

  return NextResponse.json({
    shop_id: shop?.id || null,
    policy_refund: shop?.policy_refund || null,
    policy_shipping: shop?.policy_shipping || null,
  });
}

export async function PUT(req: Request) {
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

  const shop = await resolveScopedShop(supabase, scope, undefined, {
    fields: "id",
    allowSingleScopedFallback: true,
  }) as { id?: string } | null;

  if (!shop?.id) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  const body = await req.json();
  const updates: Record<string, string> = {};
  if ("policy_refund" in body) updates.policy_refund = body.policy_refund;
  if ("policy_shipping" in body) updates.policy_shipping = body.policy_shipping;

  const { error } = await supabase.from("shops").update(updates).eq("id", shop.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
