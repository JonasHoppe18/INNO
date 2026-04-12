import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, listScopedShops } from "@/lib/server/workspace-auth";

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

const DEFAULT_CATEGORIES = [
  {
    slug: "product-questions",
    label: "Product Questions",
    icon: "Package",
    description: "Technical support, firmware, product usage",
  },
  {
    slug: "returns",
    label: "Returns & Refunds",
    icon: "RotateCcw",
    description: "Return procedures, refunds, exchanges",
  },
  {
    slug: "shipping",
    label: "Shipping & Delivery",
    icon: "Truck",
    description: "Delivery times, tracking, shipping costs",
  },
  {
    slug: "general",
    label: "General",
    icon: "MessageSquare",
    description: "Contact info, opening hours, other questions",
  },
];

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

  let shops: { id: string }[];
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const shopIds = shops.map((s) => s.id);
  if (!shopIds.length) {
    return NextResponse.json({ categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, count: 0 })) });
  }

  // Count manual_text snippets per category from metadata
  const { data: rows } = await (supabase as any)
    .from("agent_knowledge")
    .select("metadata")
    .in("shop_id", shopIds)
    .eq("source_provider", "manual_text")
    .eq("chunk_index", 0);

  const countsByCategory: Record<string, number> = {};
  const customCategories = new Set<string>();

  for (const row of rows || []) {
    const cat = (row.metadata as any)?.category as string | undefined;
    if (!cat) continue;
    countsByCategory[cat] = (countsByCategory[cat] || 0) + 1;
    const isDefault = DEFAULT_CATEGORIES.some((d) => d.slug === cat);
    if (!isDefault) customCategories.add(cat);
  }

  const defaultCats = DEFAULT_CATEGORIES.map((c) => ({
    ...c,
    count: countsByCategory[c.slug] || 0,
    isDefault: true,
  }));

  const customCats = Array.from(customCategories).map((slug) => ({
    slug,
    label: slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " "),
    icon: "Tag",
    description: "",
    count: countsByCategory[slug] || 0,
    isDefault: false,
  }));

  return NextResponse.json({ categories: [...defaultCats, ...customCats] });
}
