import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createStatelessServiceClient } from "@/lib/server/stateless-service-client";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { loadProductRadar } from "@/lib/server/product-radar-data";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

export async function GET(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const productId = new URL(request.url).searchParams.get("product") || null;
  if (productId && !/^\d+$/.test(productId)) {
    return NextResponse.json({ error: "Invalid product." }, { status: 400 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });
  }
  const serviceClient = createStatelessServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve user scope." }, { status: 401 });
  }

  try {
    const started = Date.now();
    const radar = await loadProductRadar(serviceClient, scope, { productId });
    return NextResponse.json(radar, { headers: { "Server-Timing": `radar;dur=${Date.now() - started}` } });
  } catch (err) {
    console.error("Product radar failed:", err);
    return NextResponse.json({ error: "Product radar could not be loaded." }, { status: 500 });
  }
}
