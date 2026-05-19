import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";

const SUPABASE_BASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const ISSUE_TYPES = [
  "connectivity", "factory_reset", "audio", "battery", "firmware",
  "microphone", "pairing", "physical_damage", "return", "refund",
  "shipping", "tracking", "product_specs", "general",
];

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

export async function POST(request: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not resolve scope." }, { status: 500 });
  }

  const payload = await request.json().catch(() => null);
  const content = String(payload?.content || "").trim();
  const requestedShopId = String(payload?.shop_id || "").trim();

  if (!content || content.length < 20) {
    return NextResponse.json({ products: [], issue_types: [] });
  }

  // Fetch shop's product list so we suggest actual product names
  let productNames: string[] = [];
  try {
    const shop = await resolveScopedShop(serviceClient, scope, requestedShopId || undefined, {
      fields: "id, product_overview",
    }) as { id?: string; product_overview?: string } | null;
    if (shop?.product_overview) {
      productNames = shop.product_overview
        .split(/\r?\n/)
        .map((line: string) => line.replace(/^[-*\s]+/, "").trim().toLowerCase())
        .filter((line: string) => line.length >= 2 && line.length <= 60);
    }
  } catch {
    // Continue without product list
  }

  const productListText = productNames.length
    ? `Known products (use these exact names): ${productNames.slice(0, 20).join(", ")}`
    : "No known product list — infer product names from content if present.";

  const prompt = `You classify support knowledge chunks. Return JSON only.

${productListText}

Known issue_types: ${ISSUE_TYPES.join(", ")}

Content:
"${content.slice(0, 800)}"

Return:
{"products": ["exact-product-name-lowercase"], "issue_types": ["matching_issue_types"]}

Rules:
- products: only include products explicitly mentioned. Empty array if none.
- issue_types: include ALL types this chunk is relevant for (e.g. factory_reset is relevant for both connectivity AND audio issues).
- Return valid JSON only.`;

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 150,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      return NextResponse.json({ products: [], issue_types: [] });
    }

    const data = await resp.json();
    const raw = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    const products = Array.isArray(raw.products)
      ? raw.products.map((p: unknown) => String(p).toLowerCase().trim()).filter(Boolean)
      : [];
    const issueTypes = Array.isArray(raw.issue_types)
      ? raw.issue_types
          .map((t: unknown) => String(t).toLowerCase().trim())
          .filter((t: string) => ISSUE_TYPES.includes(t))
      : [];

    return NextResponse.json({ products, issue_types: issueTypes });
  } catch {
    return NextResponse.json({ products: [], issue_types: [] });
  }
}
