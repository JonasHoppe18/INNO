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
      "id, user_id, mailbox_id, thread_id, provider_message_id, subject, snippet, body_text, body_html, from_name, from_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at, ai_draft_text"
    )
    .maybeSingle();

  if (messageInsert.error) {
    return NextResponse.json({ error: messageInsert.error.message }, { status: 500 });
  }

  const message = messageInsert.data || null;
  if (!message?.id) {
    return NextResponse.json({ error: "Could not save internal note." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message }, { status: 200 });
}
