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

function slugifyCategory(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9æøå\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function categoryLabelFromSlug(slug: string) {
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");
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

  let shops: { id: string }[];
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const shopIds = shops.map((s) => s.id).filter(Boolean);

  let categoryRows: any[] = [];
  try {
    let categoryQuery = (supabase as any)
      .from("knowledge_categories")
      .select("slug,label,icon,description,sort_order,created_at,workspace_id,shop_id")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (scope.workspaceId) {
      categoryQuery = categoryQuery.eq("workspace_id", scope.workspaceId);
    } else if (shopIds.length) {
      categoryQuery = categoryQuery.in("shop_id", shopIds);
    } else {
      categoryQuery = null;
    }
    if (categoryQuery) {
      const { data, error } = await categoryQuery;
      if (error) throw error;
      categoryRows = Array.isArray(data) ? data : [];
    }
  } catch (err: any) {
    const missingTable = String(err?.message || "").includes("knowledge_categories");
    if (!missingTable) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // Count manual_text snippets per category from metadata
  let rows: any[] = [];
  if (shopIds.length) {
    const { data } = await (supabase as any)
      .from("agent_knowledge")
      .select("metadata")
      .in("shop_id", shopIds)
      .eq("source_provider", "manual_text")
      .eq("chunk_index", 0);
    rows = Array.isArray(data) ? data : [];
  }

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
    label: categoryLabelFromSlug(slug),
    icon: "Tag",
    description: "",
    count: countsByCategory[slug] || 0,
    isDefault: false,
  }));

  const persistedCats = categoryRows
    .filter((row) => {
      const slug = String(row?.slug || "").trim();
      return slug && !DEFAULT_CATEGORIES.some((category) => category.slug === slug);
    })
    .map((row) => ({
      slug: String(row.slug),
      label: String(row.label || categoryLabelFromSlug(String(row.slug))),
      icon: String(row.icon || "Tag"),
      description: String(row.description || ""),
      count: countsByCategory[String(row.slug)] || 0,
      isDefault: false,
    }));

  const seen = new Set(defaultCats.map((category) => category.slug));
  const mergedCustomCats = [...persistedCats, ...customCats].filter((category) => {
    if (seen.has(category.slug)) return false;
    seen.add(category.slug);
    return true;
  });

  return NextResponse.json({ categories: [...defaultCats, ...mergedCustomCats] });
}

export async function POST(req: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const label = String(body?.label || "").trim();
  const requestedSlug = slugifyCategory(String(body?.slug || label));
  const slug = requestedSlug || slugifyCategory(label);
  if (!label || !slug) {
    return NextResponse.json({ error: "Category name is required" }, { status: 400 });
  }
  if (DEFAULT_CATEGORIES.some((category) => category.slug === slug)) {
    return NextResponse.json({ error: "That category already exists" }, { status: 409 });
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  let shops: { id: string; workspace_id?: string | null }[] = [];
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id, workspace_id" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const workspaceId = scope.workspaceId || shops.find((shop) => shop.workspace_id)?.workspace_id || null;
  const shopId = workspaceId ? null : shops[0]?.id || null;
  if (!workspaceId && !shopId) {
    return NextResponse.json({ error: "No workspace or shop found" }, { status: 403 });
  }

  const insertRow = {
    workspace_id: workspaceId,
    shop_id: shopId,
    slug,
    label,
    icon: String(body?.icon || "Tag").trim() || "Tag",
    description: String(body?.description || "").trim(),
  };

  const { data, error } = await (supabase as any)
    .from("knowledge_categories")
    .insert(insertRow)
    .select("slug,label,icon,description")
    .single();

  if (error) {
    const isDuplicate = String(error.code || "") === "23505" || /duplicate key/i.test(String(error.message || ""));
    if (!isDuplicate) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    let existingQuery = (supabase as any)
      .from("knowledge_categories")
      .select("slug,label,icon,description")
      .eq("slug", slug)
      .limit(1);
    existingQuery = workspaceId
      ? existingQuery.eq("workspace_id", workspaceId)
      : existingQuery.eq("shop_id", shopId);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (!existing?.slug) {
      return NextResponse.json({ error: "That category already exists" }, { status: 409 });
    }
    return NextResponse.json({
      category: {
        slug: String(existing.slug),
        label: String(existing.label || label),
        icon: String(existing.icon || "Tag"),
        description: String(existing.description || ""),
        count: 0,
        isDefault: false,
      },
    });
  }

  return NextResponse.json({
    category: {
      slug: String(data?.slug || slug),
      label: String(data?.label || label),
      icon: String(data?.icon || "Tag"),
      description: String(data?.description || ""),
      count: 0,
      isDefault: false,
    },
  });
}
