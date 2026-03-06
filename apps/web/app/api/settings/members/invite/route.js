import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
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

function asEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function asRole(value) {
  const normalized = String(value || "").trim();
  return normalized === "org:admin" ? "org:admin" : "org:member";
}

async function resolveTargetOrgId({ clerkUserId, orgId }) {
  if (orgId) return orgId;
  const serviceClient = createServiceClient();
  if (!serviceClient) return null;
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId: null });
  if (!scope?.workspaceId) return null;
  const { data } = await serviceClient
    .from("workspaces")
    .select("clerk_org_id")
    .eq("id", scope.workspaceId)
    .maybeSingle();
  return String(data?.clerk_org_id || "").trim() || null;
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const emailAddress = asEmail(body?.email);
  const role = asRole(body?.role);
  if (!emailAddress) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const targetOrgId = await resolveTargetOrgId({ clerkUserId, orgId });
  if (!targetOrgId) {
    return NextResponse.json(
      { error: "No active Clerk organization found for this workspace." },
      { status: 400 }
    );
  }

  try {
    const client = typeof clerkClient === "function" ? await clerkClient() : clerkClient;
    const organizationsApi = client?.organizations;
    if (!organizationsApi) {
      throw new Error("Clerk organizations API is unavailable.");
    }

    if (typeof organizationsApi.createOrganizationInvitation === "function") {
      await organizationsApi.createOrganizationInvitation({
        organizationId: targetOrgId,
        emailAddress,
        role,
        inviterUserId: clerkUserId,
      });
    } else if (typeof organizationsApi.createInvitation === "function") {
      await organizationsApi.createInvitation({
        organizationId: targetOrgId,
        emailAddress,
        role,
      });
    } else {
      throw new Error("Organization invite API is not available.");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error?.errors?.[0]?.longMessage ||
      error?.errors?.[0]?.message ||
      error?.message ||
      "Could not send invitation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
