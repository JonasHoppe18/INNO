import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

async function needsOnboarding(serviceClient, authState) {
  if (!serviceClient) return false;
  try {
    const scope = await resolveAuthScope(serviceClient, authState);
    if (!scope.workspaceId && !scope.supabaseUserId) return false;
    // These are existence checks, not totals. Avoid counting every row.
    const [shops, mailboxes] = await Promise.all([
      applyScope(
        serviceClient.from("shops").select("id").is("uninstalled_at", null).limit(1),
        scope,
        { workspaceColumn: "workspace_id", userColumn: "owner_user_id" },
      ),
      applyScope(serviceClient.from("mail_accounts").select("id").limit(1), scope),
    ]);
    // A failed lookup cannot establish that the workspace needs onboarding.
    if (shops.error || mailboxes.error) return false;
    return !shops.data?.length && !mailboxes.data?.length;
  } catch (_error) {
    return false;
  }
}

export async function loadDashboardShellData(serviceClient, authState, loadUser) {
  const [onboarding, user] = await Promise.all([
    needsOnboarding(serviceClient, authState),
    Promise.resolve().then(loadUser).catch(() => null),
  ]);
  return { needsOnboarding: onboarding, user };
}
