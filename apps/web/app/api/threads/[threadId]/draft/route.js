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

function buildSnippet(text, maxLength = 240) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}...` : cleaned;
}

export async function GET(_request, { params }) {
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

  const { data: draft, error } = await serviceClient
    .from("mail_messages")
    .select("id, body_text, body_html, subject, updated_at")
    .eq("thread_id", threadId)
    .eq("user_id", supabaseUserId)
    .eq("from_me", true)
    .eq("is_draft", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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

  const body = await request.json().catch(() => ({}));
  const bodyText = String(body?.body_text || "").trim();
  const bodyHtml = String(body?.body_html || "").trim();
  const subject = String(body?.subject || "").trim();
  if (!bodyText && !bodyHtml) {
    return NextResponse.json({ error: "Draft body is required." }, { status: 400 });
  }

  let supabaseUserId = null;
  try {
    supabaseUserId = await resolveSupabaseUserId(serviceClient, userId);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: thread, error: threadError } = await serviceClient
    .from("mail_threads")
    .select("id, user_id, mailbox_id, provider, provider_thread_id, subject")
    .eq("id", threadId)
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const nextSubject = subject || thread.subject || "Re:";
  const nextBodyText = bodyText || bodyHtml;
  const snippet = buildSnippet(nextBodyText);

  const { data: existingDraft } = await serviceClient
    .from("mail_messages")
    .select("id")
    .eq("thread_id", threadId)
    .eq("user_id", supabaseUserId)
    .eq("from_me", true)
    .eq("is_draft", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let draftId = null;
  if (existingDraft?.id) {
    const { data, error } = await serviceClient
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
      .eq("user_id", supabaseUserId)
      .select("id")
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    draftId = data?.id || existingDraft.id;
  } else {
    const { data, error } = await serviceClient
      .from("mail_messages")
      .insert({
        user_id: supabaseUserId,
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

  await serviceClient
    .from("mail_messages")
    .update({ ai_draft_text: nextBodyText, updated_at: nowIso })
    .eq("thread_id", threadId)
    .eq("user_id", supabaseUserId)
    .is("from_me", false);

  // Best-effort tracking in drafts table (legacy analytics).
  await serviceClient
    .from("drafts")
    .delete()
    .eq("thread_id", thread.provider_thread_id || threadId)
    .eq("platform", thread.provider || "smtp")
    .eq("status", "pending");

  await serviceClient.from("drafts").insert({
    shop_id: null,
    customer_email: null,
    subject: nextSubject,
    status: "pending",
    platform: thread.provider || "smtp",
    draft_id: draftId ? String(draftId) : null,
    message_id: draftId ? String(draftId) : null,
    thread_id: thread.provider_thread_id || threadId,
    created_at: nowIso,
  });

  return NextResponse.json({ ok: true, draft_id: draftId }, { status: 200 });
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

  const { data: thread, error: threadError } = await serviceClient
    .from("mail_threads")
    .select("id, user_id, provider, provider_thread_id")
    .eq("id", threadId)
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  await serviceClient
    .from("mail_messages")
    .delete()
    .eq("thread_id", threadId)
    .eq("user_id", supabaseUserId)
    .eq("from_me", true)
    .eq("is_draft", true);

  await serviceClient
    .from("mail_messages")
    .update({ ai_draft_text: null, updated_at: nowIso })
    .eq("thread_id", threadId)
    .eq("user_id", supabaseUserId)
    .is("from_me", false);

  await serviceClient
    .from("drafts")
    .delete()
    .eq("thread_id", thread.provider_thread_id || threadId)
    .eq("platform", thread.provider || "smtp")
    .eq("status", "pending");

  return NextResponse.json({ ok: true }, { status: 200 });
}
