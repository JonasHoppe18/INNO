/**
 * @typedef {object} ResolveShopIdOptions
 * @property {string | null | undefined} [shopDomain]
 * @property {string | null | undefined} [ownerUserId]
 * @property {string | null | undefined} [workspaceId]
 */

function normalizeShopDomain(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return normalized || null;
}

async function fetchLatestShopIdByOwner(serviceClient, ownerUserId) {
  const { data, error } = await serviceClient
    .from("shops")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/**
 * Resolve canonical shop id (`public.shops.id`) for downstream relations such as `shop_products.shop_ref_id`.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} serviceClient
 * @param {ResolveShopIdOptions} options
 * @returns {Promise<string>}
 */
export async function resolveShopId(serviceClient, options = {}) {
  if (!serviceClient) throw new Error("Supabase service client is required.");

  const shopDomain = normalizeShopDomain(options.shopDomain);
  const ownerUserId = String(options.ownerUserId || "").trim() || null;
  const workspaceId = String(options.workspaceId || "").trim() || null;

  if (!shopDomain && !ownerUserId && !workspaceId) {
    throw new Error("resolveShopId requires shopDomain, ownerUserId, or workspaceId.");
  }

  if (shopDomain) {
    let query = serviceClient.from("shops").select("id").eq("shop_domain", shopDomain);
    if (ownerUserId) {
      query = query.eq("owner_user_id", ownerUserId);
    }
    const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.id) return data.id;
  }

  if (ownerUserId) {
    const shopId = await fetchLatestShopIdByOwner(serviceClient, ownerUserId);
    if (shopId) return shopId;
  }

  if (workspaceId) {
    const { data, error } = await serviceClient
      .from("shops")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data?.id) return data.id;

    if (error && error.code !== "42703") {
      throw new Error(error.message);
    }
  }

  throw new Error("No shop found for provided identifiers.");
}
