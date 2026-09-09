import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { GreenfieldPlayground } from "@/components/agent/GreenfieldPlayground";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  isGreenfieldPlaygroundEnabled,
  isGreenfieldPlaygroundProduction,
  isInternalGreenfieldPlaygroundUser,
} from "@/lib/server/greenfield-playground";

function createServiceClient() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  return url && key ? createClient(url, key) : null;
}

export default async function PlaygroundPage() {
  if (!isGreenfieldPlaygroundEnabled()) notFound();
  const authState = await auth();
  const { userId } = authState;
  if (!userId) {
    redirect("/sign-in?redirect_url=/playground");
  }
  if (isGreenfieldPlaygroundProduction()) {
    try {
      const serviceClient = createServiceClient();
      if (!serviceClient) notFound();
      const scope = await resolveAuthScope(serviceClient, {
        clerkUserId: userId,
        orgId: authState.orgId,
        sessionClaims: authState.sessionClaims,
      });
      if (!scope?.workspaceId || !(await isInternalGreenfieldPlaygroundUser(serviceClient, {
        workspaceId: scope.workspaceId,
        clerkUserId: userId,
      }))) notFound();
    } catch {
      notFound();
    }
  }

  return (
    <DashboardPageShell className="flex min-h-0 flex-1 flex-col space-y-0 overflow-hidden">
      <GreenfieldPlayground />
    </DashboardPageShell>
  );
}
