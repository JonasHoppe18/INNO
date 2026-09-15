import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseServerConfig } from "@/lib/server/supabase-server-config";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const { url: SUPABASE_URL, serviceKey: SERVICE_KEY } = resolveSupabaseServerConfig();

export function createCsatServiceClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

export async function requireCsatWorkspace() {
  const { auth } = await import("@clerk/nextjs/server");
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return { response: Response.json({ error: "You must be signed in." }, { status: 401 }) };
  const serviceClient = createCsatServiceClient();
  if (!serviceClient) {
    return { response: Response.json({ error: "Supabase service configuration is missing." }, { status: 500 }) };
  }
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  if (!scope.workspaceId) return { response: Response.json({ error: "Workspace scope not found." }, { status: 404 }) };
  return { clerkUserId, serviceClient, workspaceId: scope.workspaceId };
}

export function jsonError(error, fallback = "Could not complete the CSAT request.") {
  return Response.json({ error: error?.message || fallback }, { status: 400 });
}
