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

async function loadRelatedThreadIds(serviceClient, threadId, mailboxIds) {
  const { data: selectedThread, error: selectedThreadError } = await serviceClient
    .from("mail_threads")
    .select("id, provider_thread_id, mailbox_id")
    .eq("id", threadId)
    .in("mailbox_id", mailboxIds)
    .limit(1)
    .maybeSingle();

  if (selectedThreadError || !selectedThread?.id) return [threadId];

  const mailboxId = String(selectedThread.mailbox_id || "").trim();
  const providerThreadId = String(selectedThread.provider_thread_id || "").trim();

  if (!mailboxId) return [threadId];

  let siblingRows = [];
  if (providerThreadId) {
    const { data, error } = await serviceClient
      .from("mail_threads")
      .select("id")
      .eq("mailbox_id", mailboxId)
      .eq("provider_thread_id", providerThreadId)
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) siblingRows = data;
  }

  const ids = Array.from(
    new Set(
      (siblingRows || [])
        .map((row) => String(row?.id || "").trim())
        .filter(Boolean)
    )
  );
  if (!ids.length) return [threadId];
  return ids.includes(threadId) ? ids : [threadId, ...ids];
}

export async function GET(_request, context) {
  try {
    const threadId = String(context?.params?.threadId || "").trim();
    if (!threadId) {
      return NextResponse.json({ error: "Missing threadId" }, { status: 400 });
    }

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
      return NextResponse.json({ messages: [] }, { status: 200 });
    }

    const mailboxIds = await loadMailboxIds(serviceClient, scope);
    if (!mailboxIds.length) {
      return NextResponse.json({ messages: [] }, { status: 200 });
    }

    const relatedThreadIds = await loadRelatedThreadIds(serviceClient, threadId, mailboxIds);

    let request = serviceClient
      .from("mail_messages")
      .select(
        "id, user_id, mailbox_id, thread_id, provider_message_id, subject, snippet, body_text, body_html, clean_body_text, clean_body_html, quoted_body_text, quoted_body_html, from_name, from_email, extracted_customer_name, extracted_customer_email, extracted_customer_fields, sender_identity_source, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at, ai_draft_text"
      )
      .in("mailbox_id", mailboxIds)
      .order("received_at", { ascending: true, nullsLast: true });

    if (relatedThreadIds.length > 1) {
      request = request.in("thread_id", relatedThreadIds);
    } else {
      request = request.eq("thread_id", threadId);
    }

    let { data: rows, error } = await request;

    if (
      error &&
      /ai_draft_text|provider_message_id|body_html|clean_body_text|clean_body_html|quoted_body_text|quoted_body_html|extracted_customer_email|extracted_customer_fields|sender_identity_source/i.test(
        error.message || ""
      )
    ) {
      let leanRequest = serviceClient
        .from("mail_messages")
        .select(
          "id, user_id, mailbox_id, thread_id, subject, snippet, body_text, body_html, from_name, from_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at"
        )
        .in("mailbox_id", mailboxIds)
        .order("received_at", { ascending: true, nullsLast: true });
      if (relatedThreadIds.length > 1) {
        leanRequest = leanRequest.in("thread_id", relatedThreadIds);
      } else {
        leanRequest = leanRequest.eq("thread_id", threadId);
      }
      const lean = await leanRequest;
      rows = lean.data;
      error = lean.error;
    }

    if (error) throw new Error(error.message);
    return NextResponse.json({ messages: Array.isArray(rows) ? rows : [] }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load thread messages." },
      { status: 500 }
    );
  }
}
