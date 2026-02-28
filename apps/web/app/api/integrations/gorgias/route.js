import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_BASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

export async function DELETE() {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) {
    return NextResponse.json(
      { error: "You must be signed in to disconnect Gorgias." },
      { status: 401 }
    );
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase configuration is missing." },
      { status: 500 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Workspace scope lookup failed." },
      { status: 500 }
    );
  }

  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json(
      { error: "No workspace/user scope found." },
      { status: 400 }
    );
  }

  let deleteQuery = serviceClient
    .from("integrations")
    .delete()
    .eq("provider", "gorgias");
  deleteQuery = applyScope(deleteQuery, scope);
  const { data, error } = await deleteQuery.select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { success: true, removed: Array.isArray(data) ? data.length : 0 },
    { status: 200 }
  );
}
