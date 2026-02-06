import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

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

async function resolveSupabaseUserId(serviceClient, clerkUserId) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id ?? null;
}

export async function DELETE(_request, { params }) {
  const { userId } = await auth();
  if (!userId) {
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

  let supabaseUserId = null;
  try {
    supabaseUserId = await resolveSupabaseUserId(serviceClient, userId);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!supabaseUserId) {
    return NextResponse.json({ error: "Supabase user not found." }, { status: 404 });
  }

  const { data: thread, error: threadError } = await serviceClient
    .from("mail_threads")
    .select("id, user_id, provider, provider_thread_id")
    .eq("id", threadId)
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const draftThreadId = thread.provider_thread_id || thread.id;
  const provider = thread.provider || "smtp";

  const { data: messageRows } = await serviceClient
    .from("mail_messages")
    .select("id")
    .eq("thread_id", threadId)
    .eq("user_id", supabaseUserId);
  const messageIds = (messageRows || []).map((row) => row.id).filter(Boolean);

  if (messageIds.length) {
    await serviceClient
      .from("mail_attachments")
      .delete()
      .in("message_id", messageIds)
      .eq("user_id", supabaseUserId);
  }

  const { data: draftRows } = await serviceClient
    .from("drafts")
    .select("id")
    .eq("thread_id", draftThreadId)
    .eq("platform", provider);
  const draftIds = (draftRows || []).map((row) => row.id).filter(Boolean);

  if (draftIds.length) {
    await serviceClient
      .from("agent_logs")
      .delete()
      .in("draft_id", draftIds);
  }

  await serviceClient
    .from("drafts")
    .delete()
    .eq("thread_id", draftThreadId)
    .eq("platform", provider);

  await serviceClient
    .from("mail_messages")
    .delete()
    .eq("thread_id", threadId)
    .eq("user_id", supabaseUserId);

  await serviceClient
    .from("mail_threads")
    .delete()
    .eq("id", threadId)
    .eq("user_id", supabaseUserId);

  return NextResponse.json({ ok: true }, { status: 200 });
}
