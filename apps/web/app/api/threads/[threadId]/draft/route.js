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

function buildSnippet(text, maxLength = 240) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}...` : cleaned;
}

export async function GET(_request, { params }) {
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

  const { data: draft, error } = await applyScope(
    serviceClient
      .from("mail_messages")
      .select("id, body_text, body_html, subject, updated_at")
      .eq("thread_id", threadId)
      .eq("from_me", true)
      .eq("is_draft", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    scope
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      draft: draft
        ? {
            id: draft.id,
            body_text: draft.body_text || "",
            body_html: draft.body_html || "",
            subject: draft.subject || "",
            updated_at: draft.updated_at,
          }
        : null,
    },
    { status: 200 }
  );
}

export async function POST(request, { params }) {
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

  const body = await request.json().catch(() => ({}));
  const bodyText = String(body?.body_text || "").trim();
  const bodyHtml = String(body?.body_html || "").trim();
  const subject = String(body?.subject || "").trim();
  if (!bodyText && !bodyHtml) {
    return NextResponse.json({ error: "Draft body is required." }, { status: 400 });
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
      .select("id, user_id, workspace_id, mailbox_id, provider, provider_thread_id, subject")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const nextSubject = subject || thread.subject || "Re:";
  const nextBodyText = bodyText || bodyHtml;
  const snippet = buildSnippet(nextBodyText);

  const { data: existingDraft } = await applyScope(
    serviceClient
      .from("mail_messages")
      .select("id")
      .eq("thread_id", threadId)
      .eq("from_me", true)
      .eq("is_draft", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    scope
  );

  let draftId = null;
  if (existingDraft?.id) {
    const { data, error } = await applyScope(
      serviceClient
        .from("mail_messages")
        .update({
          subject: nextSubject,
          snippet,
          body_text: nextBodyText,
          body_html: bodyHtml || null,
          ai_draft_text: nextBodyText,
          updated_at: nowIso,
        })
        .eq("id", existingDraft.id)
        .eq("thread_id", threadId)
        .select("id")
        .maybeSingle(),
      scope
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    draftId = data?.id || existingDraft.id;
  } else {
    const { data, error } = await serviceClient
      .from("mail_messages")
      .insert({
        user_id: scope.supabaseUserId,
        workspace_id: scope.workspaceId || null,
        mailbox_id: thread.mailbox_id,
        thread_id: threadId,
        provider: thread.provider || "smtp",
        provider_message_id: `draft-${threadId}-${Date.now()}`,
        subject: nextSubject,
        snippet,
        body_text: nextBodyText,
        body_html: bodyHtml || null,
        from_email: null,
        from_name: null,
        from_me: true,
        is_draft: true,
        is_read: true,
        sent_at: null,
        received_at: null,
        ai_draft_text: nextBodyText,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    draftId = data?.id || null;
  }

  await applyScope(
    serviceClient
      .from("mail_messages")
      .update({ ai_draft_text: nextBodyText, updated_at: nowIso })
      .eq("thread_id", threadId)
      .is("from_me", false),
    scope
  );

  // Best-effort tracking in drafts table (legacy analytics).
  {
    let supersedeQuery = serviceClient
      .from("drafts")
      .update({ status: "superseded" })
      .eq("thread_id", thread.provider_thread_id || threadId)
      .eq("platform", thread.provider || "smtp")
      .eq("status", "pending");
    supersedeQuery = scope.workspaceId
      ? supersedeQuery.eq("workspace_id", scope.workspaceId)
      : supersedeQuery;
    await supersedeQuery;
  }

  await serviceClient.from("drafts").insert({
    shop_id: null,
    customer_email: null,
    subject: nextSubject,
    status: "pending",
    platform: thread.provider || "smtp",
    draft_id: draftId ? String(draftId) : null,
    message_id: draftId ? String(draftId) : null,
    thread_id: thread.provider_thread_id || threadId,
    workspace_id: scope.workspaceId || null,
    created_at: nowIso,
  });

  return NextResponse.json({ ok: true, draft_id: draftId }, { status: 200 });
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

  const nowIso = new Date().toISOString();
  await applyScope(
    serviceClient
      .from("mail_messages")
      .delete()
      .eq("thread_id", threadId)
      .eq("from_me", true)
      .eq("is_draft", true),
    scope
  );

  await applyScope(
    serviceClient
      .from("mail_messages")
      .update({ ai_draft_text: null, updated_at: nowIso })
      .eq("thread_id", threadId)
      .is("from_me", false),
    scope
  );

  {
    let supersedeQuery = serviceClient
      .from("drafts")
      .update({ status: "superseded" })
      .eq("thread_id", thread.provider_thread_id || threadId)
      .eq("platform", thread.provider || "smtp")
      .eq("status", "pending");
    supersedeQuery = scope.workspaceId
      ? supersedeQuery.eq("workspace_id", scope.workspaceId)
      : supersedeQuery;
    await supersedeQuery;
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
