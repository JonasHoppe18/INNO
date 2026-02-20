export async function resolveAuthScope(serviceClient, { clerkUserId, orgId }) {
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
    const { data: membership, error: membershipError } = await serviceClient
      .from("workspace_members")
      .select("workspace_id")
      .eq("clerk_user_id", clerkUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    workspaceId = membership?.workspace_id ?? null;
  }

  return { supabaseUserId, workspaceId };
}

export function applyScope(query, scope, { workspaceColumn = "workspace_id", userColumn = "user_id" } = {}) {
  if (scope?.workspaceId) {
    return query.eq(workspaceColumn, scope.workspaceId);
  }
  if (scope?.supabaseUserId && userColumn) {
    return query.eq(userColumn, scope.supabaseUserId);
  }
  return query;
}
