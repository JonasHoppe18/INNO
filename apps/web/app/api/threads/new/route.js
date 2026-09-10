import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

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
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORTED_PROVIDERS = new Set(["gmail", "outlook", "smtp"]);

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeEmailList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function isValidEmailAddress(value) {
  return EMAIL_PATTERN.test(String(value || "").trim());
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const mailboxId = String(body?.mailbox_id || "").trim();
  const toEmails = normalizeEmailList(body?.to_emails);
  const ccEmails = normalizeEmailList(body?.cc_emails);
  const bccEmails = normalizeEmailList(body?.bcc_emails);
  if (!mailboxId) {
    return NextResponse.json(
      { error: "mailbox_id is required." },
      { status: 400 },
    );
  }
  if (!toEmails.length) {
    return NextResponse.json(
      { error: "At least one recipient is required." },
      { status: 400 },
    );
  }
  const invalidRecipient = [...toEmails, ...ccEmails, ...bccEmails].find(
    (recipient) => !isValidEmailAddress(recipient),
  );
  if (invalidRecipient) {
    return NextResponse.json(
      { error: `Invalid recipient: ${invalidRecipient}` },
      { status: 400 },
    );
  }

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const supabaseUserId = scope?.supabaseUserId ?? null;
  if (!scope?.workspaceId && !supabaseUserId) {
    return NextResponse.json(
      { error: "Could not resolve user scope." },
      { status: 401 },
    );
  }

  let mailboxQuery = serviceClient
    .from("mail_accounts")
    .select("id, user_id, workspace_id, provider, provider_email, status")
    .eq("id", mailboxId);
  mailboxQuery = applyScope(mailboxQuery, scope);
  const { data: mailbox, error: mailboxError } =
    await mailboxQuery.maybeSingle();
  if (mailboxError) {
    return NextResponse.json(
      { error: "Could not load the selected mailbox." },
      { status: 500 },
    );
  }
  if (!mailbox) {
    return NextResponse.json(
      { error: "Selected mailbox is not available in this workspace." },
      { status: 404 },
    );
  }

  const provider = String(mailbox.provider || "").trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return NextResponse.json(
      { error: "Selected mailbox cannot send email." },
      { status: 400 },
    );
  }
  if (
    String(mailbox.status || "").trim().toLowerCase() === "disconnected" ||
    !String(mailbox.provider_email || "").trim()
  ) {
    return NextResponse.json(
      { error: "Selected mailbox is not connected." },
      { status: 400 },
    );
  }

  const subject = String(body?.subject || "New ticket").trim() || "New ticket";
  const { data: thread, error: threadError } = await serviceClient
    .from("mail_threads")
    .insert({
      user_id: mailbox.user_id,
      workspace_id: mailbox.workspace_id || scope.workspaceId || null,
      mailbox_id: mailbox.id,
      provider,
      subject,
      snippet: "",
      customer_email: toEmails[0],
      status: "new",
      priority: "normal",
      tags: [],
      unread_count: 0,
      is_read: true,
    })
    .select(
      "id, user_id, workspace_id, mailbox_id, provider, provider_thread_id, ticket_number, subject, snippet, customer_name, customer_email, customer_last_inbound_at, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, created_at, updated_at",
    )
    .single();
  if (threadError || !thread) {
    return NextResponse.json(
      { error: "Could not create the new ticket." },
      { status: 500 },
    );
  }

  return NextResponse.json({ thread }, { status: 201 });
}
