import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function isAdminLikeRole(value) {
  const role = String(value || "").toLowerCase();
  return role.includes("admin") || role.includes("owner");
}

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId) {
      return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
    }

    const { data: workspaceMembers, error: workspaceMembersError } = await serviceClient
      .from("workspace_members")
      .select("clerk_user_id, role, created_at")
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: true });
    if (workspaceMembersError) throw workspaceMembersError;

    const clerkIds = (workspaceMembers || [])
      .map((row) => String(row?.clerk_user_id || "").trim())
      .filter(Boolean);
    const { data: profileRows, error: profilesError } = clerkIds.length
      ? await serviceClient
          .from("profiles")
          .select("user_id, clerk_user_id, first_name, last_name, email, image_url, signature")
          .in("clerk_user_id", clerkIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;

    const profilesByClerkId = new Map(
      (profileRows || []).map((row) => [String(row?.clerk_user_id || "").trim(), row])
    );
    const members = (workspaceMembers || []).map((row) => {
      const clerkId = String(row?.clerk_user_id || "").trim();
      const profile = profilesByClerkId.get(clerkId);
      return {
        user_id: profile?.user_id ?? null,
        clerk_user_id: clerkId,
        first_name: profile?.first_name ?? "",
        last_name: profile?.last_name ?? "",
        email: profile?.email ?? "",
        image_url: profile?.image_url ?? "",
        signature: profile?.signature ?? "",
        workspace_role: row?.role || "member",
        joined_at: row?.created_at ?? null,
      };
    });

    const currentMember = (workspaceMembers || []).find(
      (row) => String(row?.clerk_user_id || "").trim() === clerkUserId
    );
    return NextResponse.json(
      {
        members,
        current_role: currentMember?.role || null,
        can_manage_members: isAdminLikeRole(currentMember?.role),
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
