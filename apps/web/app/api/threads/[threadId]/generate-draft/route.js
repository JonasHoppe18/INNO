import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import { getEffectiveSenderEmail, getEffectiveSenderName } from "@/lib/inbox/sender";

export const runtime = "nodejs";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const INTERNAL_AGENT_SECRET = process.env.INTERNAL_AGENT_SECRET || "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function stripHtml(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeSignature(value) {
  return String(value || "").trim();
}

function appendSignature(text, signature) {
  const base = String(text || "").trimEnd();
  const normalizedSignature = normalizeSignature(signature);
  if (!normalizedSignature) return base;
  if (base.endsWith(normalizedSignature)) return base;
  if (!base) return normalizedSignature;
  return `${base}\n\n${normalizedSignature}`;
}

async function loadUserSignature(serviceClient, supabaseUserId) {
  if (!supabaseUserId) return "";
  const { data: profile, error } = await serviceClient
    .from("profiles")
    .select("signature")
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (error) {
    console.warn("[threads/generate-draft] profile signature lookup failed", error.message);
    return "";
  }
  return normalizeSignature(profile?.signature);
}

async function ensureMailboxShopBinding(serviceClient, mailbox) {
  if (!mailbox?.id) return mailbox;
  if (mailbox?.shop_id) return mailbox;

  let shopsQuery = serviceClient
    .from("shops")
    .select("id")
    .is("uninstalled_at", null)
    .eq("platform", "shopify")
    .order("created_at", { ascending: false })
    .limit(2);
  shopsQuery = mailbox.workspace_id
    ? shopsQuery.eq("workspace_id", mailbox.workspace_id)
    : shopsQuery.eq("owner_user_id", mailbox.user_id);

  const { data: shopRows, error: shopsError } = await shopsQuery;
  if (shopsError) {
    throw new Error(shopsError.message);
  }
  const activeShops = Array.isArray(shopRows) ? shopRows : [];
  if (activeShops.length !== 1 || !activeShops[0]?.id) {
    return mailbox;
  }

  const reboundShopId = activeShops[0].id;
  const { error: repairError } = await serviceClient
    .from("mail_accounts")
    .update({
      shop_id: reboundShopId,
      status: mailbox.status === "disconnected" ? mailbox.status : "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", mailbox.id);
  if (repairError) {
    throw new Error(repairError.message);
  }

  return {
    ...mailbox,
    shop_id: reboundShopId,
    status: mailbox.status === "disconnected" ? mailbox.status : "active",
  };
}

export async function POST(_request, { params }) {
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Workspace scope lookup failed." },
      { status: 500 }
    );
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

  const { data: mailbox, error: mailboxError } = await applyScope(
    serviceClient
      .from("mail_accounts")
      .select("id, user_id, workspace_id, shop_id, status")
      .eq("id", thread.mailbox_id)
      .maybeSingle(),
    scope
  );
  if (mailboxError || !mailbox) {
    return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
  }
  const effectiveMailbox = await ensureMailboxShopBinding(serviceClient, mailbox);
  if (!effectiveMailbox.shop_id) {
    return NextResponse.json({ error: "This mailbox is not connected to a Shopify shop." }, { status: 400 });
  }

  const inboundQuery = applyScope(
    serviceClient
      .from("mail_messages")
      .select(
        "id, provider_message_id, subject, clean_body_text, body_text, body_html, from_email, from_name, extracted_customer_email, extracted_customer_name, created_at, received_at"
      )
      .eq("thread_id", threadId)
      .eq("from_me", false)
      .order("received_at", { ascending: false, nullsLast: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    scope
  );
  const { data: inboundMessage, error: inboundError } = await inboundQuery;
  if (inboundError || !inboundMessage) {
    return NextResponse.json({ error: "No inbound message found for this thread." }, { status: 404 });
  }

  const provider = String(thread.provider || "smtp").trim() || "smtp";
  const messageBody =
    String(inboundMessage.clean_body_text || "").trim() ||
    String(inboundMessage.body_text || "").trim() ||
    stripHtml(inboundMessage.body_html || "");
  const messageSubject = String(inboundMessage.subject || thread.subject || "").trim();
  const fromEmail = String(getEffectiveSenderEmail(inboundMessage) || "").trim();
  const fromName = String(getEffectiveSenderName(inboundMessage) || "").trim();
  const fromRaw = fromName && fromEmail ? `${fromName} <${fromEmail}>` : fromEmail || fromName;

  const endpoint = `${SUPABASE_URL}/functions/v1/generate-draft-unified`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(INTERNAL_AGENT_SECRET ? { "x-internal-secret": INTERNAL_AGENT_SECRET } : {}),
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      shop_id: effectiveMailbox.shop_id,
      provider,
      force_process: true,
      email_data: {
        messageId: inboundMessage.provider_message_id || null,
        threadId: provider === "smtp" ? thread.id : thread.provider_thread_id || thread.id,
        subject: messageSubject,
        from: fromRaw || null,
        fromEmail: fromEmail || null,
        body: messageBody,
        headers: [],
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: payload?.error || `Draft generation failed with status ${response.status}.` },
      { status: response.status }
    );
  }

  const userSignature = await loadUserSignature(serviceClient, scope.supabaseUserId);
  const { data: draft } = await applyScope(
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

  const aiDraftText =
    draft?.body_text ||
    draft?.body_html ||
    (String(payload?.reply || "").trim() ? String(payload.reply).trim() : "");

  return NextResponse.json(
    {
      ok: true,
      skipped: Boolean(payload?.skipped),
      reason: payload?.reason || null,
      explanation: payload?.explanation || null,
      signature: userSignature,
      draft: draft
        ? {
            id: draft.id,
            body_text: draft.body_text || "",
            rendered_body_text: appendSignature(draft.body_text || "", userSignature),
            body_html: draft.body_html || "",
            subject: draft.subject || "",
            updated_at: draft.updated_at,
          }
        : aiDraftText
        ? {
            id: null,
            body_text: aiDraftText,
            rendered_body_text: appendSignature(aiDraftText, userSignature),
            body_html: "",
            subject: messageSubject ? `Re: ${messageSubject}` : "Re:",
            updated_at: new Date().toISOString(),
          }
        : null,
    },
    { status: 200 }
  );
}
