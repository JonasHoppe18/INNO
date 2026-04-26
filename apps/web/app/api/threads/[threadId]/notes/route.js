import crypto from "crypto";
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

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function parseMentionUserIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  value.forEach((entry) => {
    const normalized = String(entry || "").trim();
    if (isUuid(normalized)) seen.add(normalized);
  });
  return Array.from(seen);
}

function buildSnippet(value, maxLength = 240) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}...` : cleaned;
}

export async function POST(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const threadId = asString(params?.threadId);
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const bodyText = asString(payload?.body_text);
  if (!bodyText) {
    return NextResponse.json({ error: "body_text is required." }, { status: 400 });
  }
  const mentionUserIds = parseMentionUserIds(payload?.mention_user_ids);

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Auth scope not found." }, { status: 404 });
  }

  const threadQuery = applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, user_id, mailbox_id, provider, subject")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  const { data: thread, error: threadError } = await threadQuery;
  if (threadError) {
    return NextResponse.json({ error: threadError.message }, { status: 500 });
  }
  if (!thread?.id) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  let authorName = "Internal note";
  let authorEmail = null;
  if (scope?.supabaseUserId) {
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("user_id", scope.supabaseUserId)
      .maybeSingle();
    const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
    if (fullName) authorName = fullName;
    authorEmail = asString(profile?.email) || null;
  }

  const nowIso = new Date().toISOString();
  const snippet = buildSnippet(bodyText);
  const messageInsert = await serviceClient
    .from("mail_messages")
    .insert({
      user_id: scope?.supabaseUserId || thread.user_id,
      workspace_id: scope?.workspaceId ?? null,
      mailbox_id: thread.mailbox_id,
      thread_id: thread.id,
      provider: thread.provider,
      provider_message_id: `internal-note:${crypto.randomUUID()}`,
      subject: thread.subject || "Internal note",
      snippet,
      body_text: bodyText,
      body_html: null,
      clean_body_text: bodyText,
      clean_body_html: null,
      quoted_body_text: null,
      quoted_body_html: null,
      from_name: authorName,
      from_email: authorEmail,
      from_me: true,
      to_emails: [],
      cc_emails: [],
      bcc_emails: [],
      is_read: true,
      sent_at: nowIso,
      received_at: nowIso,
      is_draft: false,
      ai_draft_text: null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select(
      "id, user_id, mailbox_id, thread_id, provider_message_id, subject, snippet, body_text, body_html, clean_body_text, clean_body_html, quoted_body_text, quoted_body_html, from_name, from_email, extracted_customer_name, extracted_customer_email, extracted_customer_fields, sender_identity_source, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at, ai_draft_text"
    )
    .maybeSingle();

  if (messageInsert.error) {
    return NextResponse.json({ error: messageInsert.error.message }, { status: 500 });
  }

  const message = messageInsert.data || null;
  if (!message?.id) {
    return NextResponse.json({ error: "Could not save internal note." }, { status: 500 });
  }

  if (scope?.workspaceId && scope?.supabaseUserId && mentionUserIds.length) {
    try {
      const candidateIds = mentionUserIds.filter((id) => id !== scope.supabaseUserId);
      if (candidateIds.length) {
        const { data: workspaceMembers, error: workspaceMembersError } = await serviceClient
          .from("workspace_members")
          .select("clerk_user_id")
          .eq("workspace_id", scope.workspaceId);
        if (workspaceMembersError) throw workspaceMembersError;

        const workspaceClerkIds = Array.from(
          new Set(
            (workspaceMembers || [])
              .map((row) => String(row?.clerk_user_id || "").trim())
              .filter(Boolean)
          )
        );
        if (workspaceClerkIds.length) {
          const { data: mentionProfiles, error: mentionProfilesError } = await serviceClient
            .from("profiles")
            .select("user_id")
            .in("clerk_user_id", workspaceClerkIds)
            .in("user_id", candidateIds);
          if (mentionProfilesError) throw mentionProfilesError;

          const allowedRecipientIds = Array.from(
            new Set(
              (mentionProfiles || [])
                .map((row) => String(row?.user_id || "").trim())
                .filter(Boolean)
            )
          );

          if (allowedRecipientIds.length) {
            const title = `${authorName} mentioned you in an internal note`;
            const notificationRows = allowedRecipientIds.map((recipientUserId) => ({
              workspace_id: scope.workspaceId,
              recipient_user_id: recipientUserId,
              actor_user_id: scope.supabaseUserId,
              thread_id: thread.id,
              message_id: message.id,
              kind: "internal_note_mention",
              title,
              body: snippet || bodyText.slice(0, 240),
            }));

            const { error: notifyError } = await serviceClient
              .from("workspace_member_notifications")
              .upsert(notificationRows, {
                onConflict: "recipient_user_id,message_id,kind",
                ignoreDuplicates: true,
              });
            if (notifyError) throw notifyError;
          }
        }
      }
    } catch (error) {
      console.error("Internal note mention notification failed:", error);
    }
  }

  return NextResponse.json({ ok: true, message }, { status: 200 });
}
