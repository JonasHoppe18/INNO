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

async function loadMailboxIds(serviceClient, scope) {
  const query = applyScope(serviceClient.from("mail_accounts").select("id"), scope);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.id).filter(Boolean);
}

async function loadThreads(serviceClient, scope, mailboxIds) {
  const query = applyScope(
    serviceClient
    .from("mail_threads")
    .select(
      "id, user_id, mailbox_id, provider, provider_thread_id, subject, snippet, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, created_at, updated_at"
    )
    .in("mailbox_id", mailboxIds)
    .order("last_message_at", { ascending: false, nullsLast: true }),
    scope
  );
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function loadMessages(serviceClient, scope, mailboxIds) {
  let query = applyScope(
    serviceClient
    .from("mail_messages")
    .select(
      "id, mailbox_id, thread_id, subject, snippet, body_text, body_html, from_name, from_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at, ai_draft_text"
    )
    .in("mailbox_id", mailboxIds)
    .order("received_at", { ascending: false, nullsLast: true })
    .limit(200),
    scope
  );
  let { data, error } = await query;

  if (error && /ai_draft_text/i.test(error.message || "")) {
    const fallback = await applyScope(
      serviceClient
        .from("mail_messages")
        .select(
          "id, mailbox_id, thread_id, subject, snippet, body_text, body_html, from_name, from_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at"
        )
        .in("mailbox_id", mailboxIds)
        .order("received_at", { ascending: false, nullsLast: true })
        .limit(200),
      scope
    );
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function GET() {
  try {
    const { userId: clerkUserId, orgId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId && !scope.supabaseUserId) {
      return NextResponse.json({ threads: [], messages: [] }, { status: 200 });
    }

    const mailboxIds = await loadMailboxIds(serviceClient, scope);
    if (!mailboxIds.length) {
      return NextResponse.json({ threads: [], messages: [] }, { status: 200 });
    }

    const [threads, messages] = await Promise.all([
      loadThreads(serviceClient, scope, mailboxIds),
      loadMessages(serviceClient, scope, mailboxIds),
    ]);

    return NextResponse.json({ threads, messages }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load inbox live data." },
      { status: 500 }
    );
  }
}
