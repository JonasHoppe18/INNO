import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createStatelessServiceClient } from "@/lib/server/stateless-service-client";
import { resolveSupabaseServerConfig } from "@/lib/server/supabase-server-config";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

// Shared auth for the media routes: a signed-in member of a resolved workspace.
export async function resolveMediaContext() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return { response: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  }
  const config = resolveSupabaseServerConfig();
  const client = createStatelessServiceClient(config.url, config.serviceKey);
  if (!client) {
    return { response: NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 }) };
  }
  const scope = await resolveAuthScope(client, { clerkUserId, orgId });
  if (!scope?.workspaceId) {
    return { response: NextResponse.json({ error: "Workspace scope not found." }, { status: 404 }) };
  }
  return { client, scope, supabaseUrl: config.url };
}

export function mediaErrorResponse(error, fallback) {
  const status = Number(error?.status) || 500;
  return NextResponse.json({ error: error?.message || fallback }, { status });
}
