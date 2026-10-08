// What the current user may do with one row of the members table.
export function memberRowPermissions(member, { canManageRoles, currentClerkUserId, currentIsOwner }) {
  const rawRole = String(member?.workspace_role || "").toLowerCase();
  const isOwner = rawRole.includes("owner");
  const memberUserId = String(member?.org_user_id || member?.clerk_user_id || "").trim();
  const isSelf = Boolean(memberUserId) && memberUserId === String(currentClerkUserId || "").trim();
  const canEditRole =
    Boolean(canManageRoles) &&
    Boolean(memberUserId) &&
    !isOwner &&
    !isSelf &&
    (Boolean(currentIsOwner) || !rawRole.includes("admin"));
  const canEditSignature = Boolean(member?.user_id) && (isSelf || Boolean(canManageRoles));
  return {
    rawRole,
    isOwner,
    memberUserId,
    isSelf,
    canEditRole,
    canEditSignature,
    canRemoveMember: canEditRole,
    isInvited: String(member?.status || "") === "invited",
  };
}
