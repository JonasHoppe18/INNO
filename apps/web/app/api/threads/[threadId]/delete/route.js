import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

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

export async function DELETE(_request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Auth scope not found." }, { status: 404 });
  }

  const { data: thread, error: threadError } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, user_id, workspace_id, provider, provider_thread_id")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const draftThreadId = thread.provider_thread_id || thread.id;
  const provider = thread.provider || "smtp";

  const { data: messageRows } = await applyScope(
    serviceClient
      .from("mail_messages")
      .select("id")
      .eq("thread_id", threadId),
    scope
  );
  const messageIds = (messageRows || []).map((row) => row.id).filter(Boolean);

  if (messageIds.length) {
    await serviceClient.from("mail_attachments").delete().in("message_id", messageIds);
  }

  let draftQuery = serviceClient
    .from("drafts")
    .select("id")
    .eq("thread_id", draftThreadId)
    .eq("platform", provider);
  if (scope.workspaceId) {
    draftQuery = draftQuery.eq("workspace_id", scope.workspaceId);
  }
  const { data: draftRows } = await draftQuery;
  const draftIds = (draftRows || []).map((row) => row.id).filter(Boolean);

  if (draftIds.length) {
    await serviceClient
      .from("agent_logs")
      .delete()
      .in("draft_id", draftIds);
  }

  let draftDeleteQuery = serviceClient
    .from("drafts")
    .delete()
    .eq("thread_id", draftThreadId)
    .eq("platform", provider);
  if (scope.workspaceId) {
    draftDeleteQuery = draftDeleteQuery.eq("workspace_id", scope.workspaceId);
  }
  await draftDeleteQuery;

  await applyScope(
    serviceClient
      .from("mail_messages")
      .delete()
      .eq("thread_id", threadId),
    scope
  );

  await applyScope(
    serviceClient
      .from("mail_threads")
      .delete()
      .eq("id", threadId),
    scope
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}
