import { auth } from "@clerk/nextjs/server";

function normalizedId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveClerkOrgId({ orgId, sessionClaims } = {}) {
  return (
    normalizedId(orgId) ||
    normalizedId(sessionClaims?.org_id) ||
    normalizedId(sessionClaims?.orgId) ||
    normalizedId(sessionClaims?.o?.id)
  );
}

export async function resolveAuthScope(
  serviceClient,
  { clerkUserId, orgId, sessionClaims = null },
  _options = {}
) {
  let supabaseUserId = null;
  let workspaceId = null;
  let activeOrgId = resolveClerkOrgId({ orgId, sessionClaims });

  // Older callers only pass auth().orgId. Clerk can expose the active
  // organization in the compact session claim instead, so recover it here to
  // keep every server route on the same workspace scope.
  if (!activeOrgId && clerkUserId && !sessionClaims) {
    try {
      const authState = await auth();
      if (authState?.userId === clerkUserId) {
        activeOrgId = resolveClerkOrgId(authState);
      }
    } catch (_error) {
      // Background jobs and unit tests may not have a request auth context.
    }
  }

  if (activeOrgId) {
    // profiles and workspaces are independent — run in parallel
    const [profileResult, workspaceResult] = await Promise.all([
      serviceClient
        .from("profiles")
        .select("user_id")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle(),
      serviceClient
        .from("workspaces")
        .select("id")
        .eq("clerk_org_id", activeOrgId)
        .maybeSingle(),
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (workspaceResult.error) throw new Error(workspaceResult.error.message);
    supabaseUserId = profileResult.data?.user_id ?? null;
    workspaceId = workspaceResult.data?.id ?? null;

    // A stale or mismatched Clerk org must never select another workspace as a
    // fallback. The active Clerk organization is the authoritative scope.
    if (workspaceId) {
      const { data: orgMembership, error: orgMembershipError } = await serviceClient
        .from("workspace_members")
        .select("workspace_id")
        .eq("workspace_id", workspaceId)
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();
      if (orgMembershipError) throw new Error(orgMembershipError.message);
      if (!orgMembership?.workspace_id) {
        throw new Error("Active workspace is not available to this account.");
      }
    }

    if (!workspaceId) {
      throw new Error("Active workspace is not available to this account.");
    }
  } else {
    // Without an active Clerk organization, resolve only an unambiguous
    // membership. Never silently choose the latest workspace.
    const membershipQuery = serviceClient
      .from("workspace_members")
      .select("workspace_id")
      .eq("clerk_user_id", clerkUserId)
      .order("created_at", { ascending: false })
      .limit(2);

    const [profileResult, membershipResult] = await Promise.all([
      serviceClient
        .from("profiles")
        .select("user_id")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle(),
      membershipQuery,
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (membershipResult.error) throw new Error(membershipResult.error.message);

    supabaseUserId = profileResult.data?.user_id ?? null;

    const rows = Array.isArray(membershipResult.data) ? membershipResult.data : [];
    if (rows.length > 1) {
      throw new Error("Ambiguous workspace scope. Select a workspace explicitly.");
    }
    workspaceId = rows[0]?.workspace_id ?? null;
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
