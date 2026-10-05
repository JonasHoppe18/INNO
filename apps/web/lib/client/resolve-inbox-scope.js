const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveClientInboxScope({ supabase, clerkUserId, orgId = null, fallbackUserId = null }) {
  const profileQuery = supabase.from("profiles").select("user_id").eq("clerk_user_id", clerkUserId).maybeSingle();
  const workspaceQuery = orgId
    ? supabase.from("workspace_members").select("workspace_id, workspaces!inner(clerk_org_id)")
        .eq("clerk_user_id", clerkUserId).eq("workspaces.clerk_org_id", orgId).maybeSingle()
    : supabase.from("workspace_members").select("workspace_id").eq("clerk_user_id", clerkUserId)
        .order("created_at", { ascending: false }).limit(2);
  const [profile, workspace] = await Promise.all([profileQuery, workspaceQuery]);
  if (profile.error) throw profile.error;
  if (workspace.error) throw workspace.error;
  const supabaseUserId = UUID.test(profile.data?.user_id || "") ? profile.data.user_id : fallbackUserId;
  if (orgId) {
    const workspaceId = workspace.data?.workspace_id;
    if (!workspaceId) throw Error("Active workspace is not available to this account.");
    return { supabaseUserId, workspaceId };
  }
  const rows = Array.isArray(workspace.data) ? workspace.data : [];
  if (rows.length > 1) throw Error("Select a workspace explicitly.");
  return { supabaseUserId, workspaceId: rows[0]?.workspace_id || null };
}
