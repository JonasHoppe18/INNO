const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isAdminLikeRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized.includes("admin") || normalized.includes("owner");
}

export async function resolveEmailSignatureTargetUserId(
  serviceClient,
  scope,
  clerkUserId,
  requestedUserId
) {
  const fallback = scope?.supabaseUserId || null;
  const candidate = String(requestedUserId || "").trim();
  if (!candidate || !UUID_REGEX.test(candidate) || candidate === fallback) {
    return fallback;
  }
  if (!scope?.workspaceId || !clerkUserId) {
    const error = new Error("Workspace scope is required.");
    error.status = 400;
    throw error;
  }

  const { data: requesterMembership, error: requesterMembershipError } = await serviceClient
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", scope.workspaceId)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (requesterMembershipError) {
    throw new Error(requesterMembershipError.message);
  }
  if (!isAdminLikeRole(requesterMembership?.role)) {
    const error = new Error("Only admins can edit another member signature template.");
    error.status = 403;
    throw error;
  }

  const { data: targetProfile, error: targetProfileError } = await serviceClient
    .from("profiles")
    .select("user_id, clerk_user_id")
    .eq("user_id", candidate)
    .maybeSingle();
  if (targetProfileError) {
    throw new Error(targetProfileError.message);
  }
  if (!targetProfile?.user_id || !targetProfile?.clerk_user_id) {
    const error = new Error("Target member not found.");
    error.status = 404;
    throw error;
  }

  const { data: targetMembership, error: targetMembershipError } = await serviceClient
    .from("workspace_members")
    .select("clerk_user_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("clerk_user_id", targetProfile.clerk_user_id)
    .maybeSingle();
  if (targetMembershipError) {
    throw new Error(targetMembershipError.message);
  }
  if (!targetMembership?.clerk_user_id) {
    const error = new Error("Target member is not part of this workspace.");
    error.status = 404;
    throw error;
  }

  return targetProfile.user_id;
}
