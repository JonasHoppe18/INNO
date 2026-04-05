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

export function createInboxServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function loadMailboxes(serviceClient, scope) {
  const { data, error } = await applyScope(
    serviceClient
      .from("mail_accounts")
      .select("id, provider, provider_email")
      .order("created_at", { ascending: true }),
    scope
  );
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function loadMessages(serviceClient, scope, mailboxIds, { query, unreadOnly }) {
  let request = applyScope(
    serviceClient
      .from("mail_messages")
      .select(
        "id, user_id, mailbox_id, thread_id, provider_message_id, subject, snippet, body_text, from_name, from_email, extracted_customer_name, extracted_customer_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at, ai_draft_text"
      )
      .in("mailbox_id", mailboxIds)
      .order("received_at", { ascending: false, nullsLast: true })
      .limit(120),
    scope
  );

  if (unreadOnly) {
    request = request.eq("is_read", false);
  }

  if (query) {
    const escaped = query.replace(/%/g, "\\%").replace(/_/g, "\\_");
    request = request.or(
      `subject.ilike.%${escaped}%,snippet.ilike.%${escaped}%,from_name.ilike.%${escaped}%,from_email.ilike.%${escaped}%`
    );
  }

  let { data, error } = await request;
  if (
    error &&
    /ai_draft_text|provider_message_id|body_html|clean_body_text|clean_body_html|quoted_body_text|quoted_body_html|extracted_customer_email|extracted_customer_fields|sender_identity_source/i.test(
      error.message || ""
    )
  ) {
    let fallbackRequest = serviceClient
      .from("mail_messages")
      .select(
        "id, user_id, mailbox_id, thread_id, provider_message_id, subject, snippet, body_text, from_name, from_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at"
      )
      .in("mailbox_id", mailboxIds)
      .order("received_at", { ascending: false, nullsLast: true })
      .limit(120);
    fallbackRequest = applyScope(fallbackRequest, scope);

    if (unreadOnly) {
      fallbackRequest = fallbackRequest.eq("is_read", false);
    }

    if (query) {
      const escaped = query.replace(/%/g, "\\%").replace(/_/g, "\\_");
      fallbackRequest = fallbackRequest.or(
        `subject.ilike.%${escaped}%,snippet.ilike.%${escaped}%,from_name.ilike.%${escaped}%,from_email.ilike.%${escaped}%`
      );
    }

    const fallback = await fallbackRequest;
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function loadThreads(serviceClient, scope, mailboxIds) {
  const runQuery = (withCustomerFields = true) =>
    applyScope(
      serviceClient
        .from("mail_threads")
        .select(
          withCustomerFields
            ? "id, user_id, mailbox_id, provider, provider_thread_id, subject, snippet, customer_name, customer_email, customer_last_inbound_at, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, classification_key, classification_confidence, classification_reason, created_at, updated_at"
            : "id, user_id, mailbox_id, provider, provider_thread_id, subject, snippet, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, classification_key, classification_confidence, classification_reason, created_at, updated_at"
        )
        .in("mailbox_id", mailboxIds)
        .order("last_message_at", { ascending: false, nullsLast: true })
        .limit(150),
      scope
    );
  let { data, error } = await runQuery(true);
  if (
    error &&
    /customer_name|customer_email|customer_last_inbound_at/i.test(String(error.message || ""))
  ) {
    const fallback = await runQuery(false);
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function loadAttachments(serviceClient, scope, mailboxIds, messageIds) {
  if (!messageIds.length) return [];
  const { data, error } = await applyScope(
    serviceClient
      .from("mail_attachments")
      .select(
        "id, user_id, mailbox_id, message_id, provider, provider_attachment_id, filename, mime_type, size_bytes, storage_path, created_at"
      )
      .in("mailbox_id", mailboxIds)
      .in("message_id", messageIds),
    scope,
    { workspaceColumn: null, userColumn: "user_id" }
  );
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function loadWorkspaceMembers(serviceClient, scope) {
  if (!scope.workspaceId) return [];
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

  return (workspaceMembers || []).map((row) => {
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
}

export async function loadInboxData({
  clerkUserId,
  orgId,
  query = "",
  unreadOnly = false,
  includeMessages = true,
  includeAttachments = true,
  includeMembers = false,
}) {
  const serviceClient = createInboxServiceClient();
  const result = {
    mailboxes: [],
    threads: [],
    messages: [],
    attachments: [],
    members: [],
    scope: null,
  };

  if (!serviceClient) return result;

  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  result.scope = scope;
  if (!scope.workspaceId && !scope.supabaseUserId) return result;

  const mailboxes = await loadMailboxes(serviceClient, scope);
  result.mailboxes = mailboxes;
  const mailboxIds = mailboxes.map((mailbox) => mailbox.id).filter(Boolean);
  if (!mailboxIds.length) return result;

  const threads = await loadThreads(serviceClient, scope, mailboxIds);
  result.threads = threads;

  if (includeMessages) {
    const messages = await loadMessages(serviceClient, scope, mailboxIds, {
      query,
      unreadOnly,
    });
    result.messages = messages;

    if (includeAttachments) {
      const messageIds = messages.map((message) => message.id).filter(Boolean);
      result.attachments = await loadAttachments(serviceClient, scope, mailboxIds, messageIds);
    }
  }

  if (includeMembers) {
    result.members = await loadWorkspaceMembers(serviceClient, scope);
  }

  return result;
}
