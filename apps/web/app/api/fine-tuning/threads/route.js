import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

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

export async function GET(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(parseInt(searchParams.get("limit") || "30", 10), 50);

  // Build query on mail_threads scoped to workspace or user
  let query = serviceClient
    .from("mail_threads")
    .select("id, subject, customer_email, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (scope?.workspaceId) {
    query = query.eq("workspace_id", scope.workspaceId);
  } else if (scope?.userId) {
    query = query.eq("user_id", scope.userId);
  } else {
    return NextResponse.json({ threads: [] });
  }

  // Filter by search term on subject or customer_email
  if (q) {
    query = query.or(`subject.ilike.%${q}%,customer_email.ilike.%${q}%`);
  }

  const { data: threads, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!threads?.length) {
    return NextResponse.json({ threads: [] });
  }

  // Fetch the latest INBOUND (customer) message for each thread
  const threadIds = threads.map((t) => t.id);
  const { data: messages } = await serviceClient
    .from("mail_messages")
    .select("thread_id, clean_body_text, body_text, body_html, created_at")
    .in("thread_id", threadIds)
    .eq("from_me", false)
    .eq("is_draft", false)
    .order("created_at", { ascending: false });

  // Helper: strip HTML tags from a string
  function stripHtml(html) {
    return (html || "").replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
  }

  // Build a map: threadId → latest inbound message text
  const latestMessageByThread = {};
  for (const msg of messages || []) {
    if (!latestMessageByThread[msg.thread_id]) {
      const text = (
        msg.clean_body_text ||
        msg.body_text ||
        stripHtml(msg.body_html) ||
        ""
      ).trim();
      if (text) latestMessageByThread[msg.thread_id] = text;
    }
  }

  const result = threads.map((t) => ({
    id: t.id,
    subject: t.subject || "(no subject)",
    customer_email: t.customer_email || "",
    status: t.status || "open",
    latest_message: latestMessageByThread[t.id] || "",
    created_at: t.created_at,
  }));

  return NextResponse.json({ threads: result });
}
