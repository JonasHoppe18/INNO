export async function resolveAuthScope(
  serviceClient,
  { clerkUserId, orgId },
  { requireExplicitWorkspace = false } = {}
) {
  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  const supabaseUserId = profile?.user_id ?? null;
  let workspaceId = null;

  if (orgId) {
    const { data: workspace, error: workspaceError } = await serviceClient
      .from("workspaces")
      .select("id")
      .eq("clerk_org_id", orgId)
      .maybeSingle();
    if (workspaceError) throw new Error(workspaceError.message);
    workspaceId = workspace?.id ?? null;
  }

  if (!workspaceId) {
    let membershipQuery = serviceClient
      .from("workspace_members")
      .select("workspace_id")
      .eq("clerk_user_id", clerkUserId)
      .order("created_at", { ascending: false });

    if (requireExplicitWorkspace) {
      const { data: memberships, error: membershipsError } = await membershipQuery.limit(2);
      if (membershipsError) throw new Error(membershipsError.message);
      const rows = Array.isArray(memberships) ? memberships : [];
      if (rows.length > 1) {
        throw new Error("Ambiguous workspace scope. Select a workspace explicitly.");
      }
      workspaceId = rows[0]?.workspace_id ?? null;
    } else {
      const { data: membership, error: membershipError } = await membershipQuery
        .limit(1)
        .maybeSingle();
      if (membershipError) throw new Error(membershipError.message);
      workspaceId = membership?.workspace_id ?? null;
    }
  }

  return { supabaseUserId, workspaceId };
}

export function applyScope(query, scope, { workspaceColumn = "workspace_id", userColumn = "user_id" } = {}) {
  if (scope?.workspaceId && workspaceColumn) {
    return query.eq(workspaceColumn, scope.workspaceId);
  }
  if (scope?.supabaseUserId && userColumn) {
    return query.eq(userColumn, scope.supabaseUserId);
  }
  return query;
}

export async function listScopedShops(
  serviceClient,
  scope,
  {
    fields = "id, workspace_id, owner_user_id, platform, shop_domain, policy_refund, policy_shipping",
    platform = null,
  } = {}
) {
  let query = serviceClient
    .from("shops")
    .select(fields)
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false });
  if (platform) query = query.eq("platform", platform);
  query = applyScope(query, scope, {
    workspaceColumn: "workspace_id",
    userColumn: "owner_user_id",
  });
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function resolveScopedShop(
  serviceClient,
  scope,
  requestedShopId,
  {
    fields = "id, workspace_id, owner_user_id, platform, shop_domain, policy_refund, policy_shipping",
    platform = null,
    allowSingleScopedFallback = false,
    missingShopMessage = "shop_id is required.",
  } = {}
) {
  const targetShopId = String(requestedShopId || "").trim();
  if (targetShopId) {
    let query = serviceClient
      .from("shops")
      .select(fields)
      .eq("id", targetShopId)
      .is("uninstalled_at", null)
      .limit(1);
    if (platform) query = query.eq("platform", platform);
    query = applyScope(query, scope, {
      workspaceColumn: "workspace_id",
      userColumn: "owner_user_id",
    });
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error("Shop not found in your current scope.");
    return data;
  }

  if (!allowSingleScopedFallback) {
    throw new Error(missingShopMessage);
  }

  const shops = await listScopedShops(serviceClient, scope, { fields, platform });
  if (shops.length === 1) return shops[0];
  if (shops.length > 1) {
    throw new Error("shop_id is required when multiple shops are available.");
  }
  throw new Error("No active shop found in your current scope.");
}
