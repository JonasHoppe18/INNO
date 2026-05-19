import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

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

async function suggestTags(
  content: string,
  productNames: string[],
): Promise<{ products: string[]; issue_types: string[] }> {
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

  if (!resp.ok) return { products: [], issue_types: [] };

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

  return { products, issue_types: issueTypes };
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
  const requestedShopId = String(payload?.shop_id || "").trim();

  // Fetch shop + product list
  let shopId = "";
  let productNames: string[] = [];
  try {
    const shop = await resolveScopedShop(serviceClient, scope, requestedShopId || undefined, {
      fields: "id, product_overview",
      allowSingleScopedFallback: true,
    }) as { id?: string; product_overview?: string } | null;
    if (!shop?.id) {
      return NextResponse.json({ error: "Shop not found." }, { status: 404 });
    }
    shopId = shop.id;
    if (shop.product_overview) {
      productNames = shop.product_overview
        .split(/\r?\n/)
        .map((line: string) => line.replace(/^[-*\s]+/, "").trim().toLowerCase())
        .filter((line: string) => line.length >= 2 && line.length <= 60);
    }
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not resolve shop." }, { status: 500 });
  }

  // Fetch all taggable knowledge chunks for this shop
  const { data: rows, error: fetchError } = await serviceClient
    .from("agent_knowledge")
    .select("id, content, metadata")
    .eq("shop_id", shopId)
    .neq("source_type", "ticket")
    .neq("source_provider", "saved_reply")
    .not("content", "is", null);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const chunks = (rows ?? []) as Array<{ id: string | number; content: string; metadata: Record<string, unknown> | null }>;

  let tagged = 0;
  let skipped = 0;
  let errors = 0;

  for (const chunk of chunks) {
    const meta = chunk.metadata ?? {};
    const hasProducts = Array.isArray(meta.products) && (meta.products as string[]).length > 0;
    const hasIssueTypes = Array.isArray(meta.issue_types) && (meta.issue_types as string[]).length > 0;

    // Skip if already fully tagged
    if (hasProducts && hasIssueTypes) {
      skipped += 1;
      continue;
    }

    const content = String(chunk.content || "").trim();
    if (content.length < 20) {
      skipped += 1;
      continue;
    }

    try {
      const { products, issue_types } = await suggestTags(content, productNames);

      // Merge new tags with existing metadata — don't overwrite already-set tags
      const updatedMeta = {
        ...meta,
        products: hasProducts ? meta.products : products,
        issue_types: hasIssueTypes ? meta.issue_types : issue_types,
      };

      const { error: updateError } = await serviceClient
        .from("agent_knowledge")
        .update({ metadata: updatedMeta })
        .eq("id", chunk.id);

      if (updateError) throw new Error(updateError.message);
      tagged += 1;
    } catch {
      errors += 1;
    }
  }

  return NextResponse.json({
    success: true,
    total: chunks.length,
    tagged,
    skipped,
    errors,
  });
}
