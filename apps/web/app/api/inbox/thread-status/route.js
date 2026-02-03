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

export async function PATCH(request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service client could not be created." },
      { status: 500 }
    );
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const threadId = body?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
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

  const payload = {};
  if (typeof body?.status === "string") {
    payload.status = body.status.trim().toLowerCase();
  }
  if (body?.priority !== undefined) {
    payload.priority = body.priority;
  }
  if (body?.assigneeId !== undefined) {
    payload.assignee_id = body.assigneeId;
  }
  if (typeof body?.isRead === "boolean") {
    payload.is_read = body.isRead;
  }
  if (typeof body?.unreadCount === "number") {
    payload.unread_count = body.unreadCount;
  }

  if (!Object.keys(payload).length) {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }

  const { data, error } = await serviceClient
    .from("mail_threads")
    .update(payload)
    .eq("id", threadId)
    .eq("user_id", supabaseUserId)
    .select("id, status, priority, assignee_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, thread: data }, { status: 200 });
}
