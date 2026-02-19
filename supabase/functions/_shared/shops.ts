import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ResolveShopIdOptions = {
  shopDomain?: string | null;
  ownerUserId?: string | null;
  workspaceId?: string | null;
};

function normalizeShopDomain(value?: string | null): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return normalized || null;
}

async function fetchLatestShopIdByOwner(
  supabase: SupabaseClient | null,
  ownerUserId: string,
): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("shops")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data?.id ?? null;
}

export async function resolveShopId(
  supabase: SupabaseClient | null,
  options: ResolveShopIdOptions = {},
): Promise<string | null> {
  if (!supabase) return null;

  const shopDomain = normalizeShopDomain(options.shopDomain);
  const ownerUserId = String(options.ownerUserId ?? "").trim() || null;
  const workspaceId = String(options.workspaceId ?? "").trim() || null;

  if (!shopDomain && !ownerUserId && !workspaceId) {
    throw new Error("resolveShopId requires shopDomain, ownerUserId, or workspaceId.");
  }

  if (shopDomain) {
    let query = supabase.from("shops").select("id").eq("shop_domain", shopDomain);
    if (ownerUserId) {
      query = query.eq("owner_user_id", ownerUserId);
    }
    const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    if (data?.id) return data.id;
  }

  if (ownerUserId) {
    const shopId = await fetchLatestShopIdByOwner(supabase, ownerUserId);
    if (shopId) return shopId;
  }

  if (workspaceId) {
    const { data, error } = await supabase
      .from("shops")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data?.id) return data.id;
    if (error && (error as { code?: string }).code !== "42703") {
      throw new Error(error.message);
    }
  }

  return null;
}
