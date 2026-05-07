import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function GET(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Service config missing" }, { status: 500 });
  }

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch {
    return NextResponse.json({ error: "Could not resolve scope" }, { status: 500 });
  }

  // Resolve thread to get provider_thread_id for key lookup
  let threadQuery = serviceClient
    .from("mail_threads")
    .select("id, provider_thread_id, workspace_id")
    .eq("id", threadId);
  threadQuery = applyScope(threadQuery, scope);
  const { data: thread } = await threadQuery.maybeSingle();

  const draftThreadKeys = [thread?.provider_thread_id, threadId].filter(Boolean);

  const { data: draft } = await serviceClient
    .from("drafts")
    .select("edit_classification, edit_delta_pct")
    .in("thread_id", draftThreadKeys)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    edit_classification: draft?.edit_classification ?? null,
    edit_delta_pct: draft?.edit_delta_pct ?? null,
  });
}
