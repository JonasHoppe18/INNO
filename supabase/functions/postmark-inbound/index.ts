// Deploy: supabase functions deploy postmark-inbound --no-verify
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SONA_WEBHOOK_SECRET
// SQL: create unique index if not exists uniq_mail_messages_provider_msg on public.mail_messages(provider, provider_message_id);
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
const WEBHOOK_SECRET = Deno.env.get("SONA_WEBHOOK_SECRET") ?? "";

const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

const INBOUND_DOMAIN = "inbound.sona-ai.dk";

type PostmarkHeader = { Name?: string; Value?: string };
type PostmarkAttachment = {
  Name?: string;
  ContentType?: string;
  ContentLength?: number;
  ContentID?: string | null;
};

type MailboxLookup = { mailbox_id: string; user_id: string; status?: string | null };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-sona-webhook-secret, Authorization",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function isAuthorized(req: Request) {
  if (!WEBHOOK_SECRET) return false;
  const headerSecret = req.headers.get("x-sona-webhook-secret") ?? "";
  if (headerSecret && headerSecret === WEBHOOK_SECRET) return true;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Basic ")) {
    try {
      const raw = atob(authHeader.slice("Basic ".length));
      const [, password] = raw.split(":");
      if (password && password === WEBHOOK_SECRET) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function normalizeEmailList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : ""))
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
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

function extractEmail(value: string): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim();
  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch ? emailMatch[0].trim() : value.trim();
}

function extractName(value: string): string | null {
  if (!value) return null;
  const name = value.replace(/<[^>]+>/g, "").replace(/\"/g, "").trim();
  return name || null;
}

function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/[<>]/g, "").trim() || null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function buildSnippet(text: string, maxLength = 240): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}…` : cleaned;
}

function findHeader(headers: PostmarkHeader[] | null, name: string): string | null {
  if (!headers) return null;
  const match = headers.find((h) => h?.Name?.toLowerCase() === name.toLowerCase());
  return match?.Value ?? null;
}

function getInboundRecipient(toList: string[]): string | null {
  for (const raw of toList) {
    const email = extractEmail(raw);
    if (email && email.toLowerCase().endsWith(`@${INBOUND_DOMAIN}`)) {
      return email;
    }
  }
  return null;
}

function collectRecipientCandidates(
  payload: Record<string, unknown>,
  headers: PostmarkHeader[],
): string[] {
  const candidates: string[] = [];
  candidates.push(...normalizeEmailList(payload?.To));
  candidates.push(...normalizeEmailList(payload?.OriginalRecipient));
  candidates.push(...normalizeEmailList(payload?.Recipient));

  const headerNames = [
    "Delivered-To",
    "X-Original-To",
    "X-Forwarded-To",
    "Envelope-To",
    "X-Envelope-To",
    "To",
  ];
  for (const name of headerNames) {
    const value = findHeader(headers, name);
    if (value) candidates.push(value);
  }
  return candidates.filter(Boolean);
}

function parseSlugFromAddress(address: string | null): string | null {
  if (!address) return null;
  const email = extractEmail(address);
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain || domain.toLowerCase() !== INBOUND_DOMAIN) return null;
  return local.trim().toLowerCase() || null;
}

async function lookupMailbox(slug: string): Promise<MailboxLookup | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("mail_accounts")
    .select("id, user_id, inbound_slug, status")
    .ilike("inbound_slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id || !data?.user_id) return null;
  return { mailbox_id: data.id, user_id: data.user_id, status: data.status };
}

async function logAgent(step: string, detail: Record<string, unknown>, status: string) {
  if (!supabase) return;
  await supabase.from("agent_logs").insert({
    draft_id: null,
    step_name: step,
    step_detail: JSON.stringify(detail),
    status,
    created_at: new Date().toISOString(),
  });
}

async function findThreadByReplyMessage(
  mailboxId: string,
  providerMessageId: string,
): Promise<string | null> {
  if (!supabase || !providerMessageId) return null;
  const { data } = await supabase
    .from("mail_messages")
    .select("thread_id")
    .eq("mailbox_id", mailboxId)
    .eq("provider", "smtp")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  return (data as any)?.thread_id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  if (!supabase) {
    return jsonResponse(500, { error: "Supabase client not configured" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  const rawMessageId = String(payload?.MessageID ?? payload?.MessageId ?? "").trim();
  const messageId = normalizeMessageId(rawMessageId);
  if (!messageId) {
    return jsonResponse(400, { error: "Missing MessageID" });
  }

  const subject = String(payload?.Subject ?? "").trim();
  const fromRaw = String(payload?.From ?? "").trim();
  const fromEmail = extractEmail(fromRaw);
  const fromName = extractName(fromRaw);

  const headers = Array.isArray(payload?.Headers)
    ? (payload.Headers as PostmarkHeader[])
    : [];

  const toList = normalizeEmailList(payload?.To);
  const ccList = normalizeEmailList(payload?.Cc);
  const bccList = normalizeEmailList(payload?.Bcc);
  const recipientCandidates = collectRecipientCandidates(payload, headers);
  const inboundRecipient = getInboundRecipient(recipientCandidates);
  const slug = parseSlugFromAddress(inboundRecipient);
  if (!slug) {
    await logAgent(
      "postmark_inbound_received",
      { messageId, subject, to: toList, candidates: recipientCandidates.slice(0, 8) },
      "error",
    );
    return jsonResponse(404, { error: "Inbound mailbox not found" });
  }

  let mailbox: MailboxLookup | null = null;
  try {
    mailbox = await lookupMailbox(slug);
  } catch (err) {
    await logAgent("postmark_inbound_received", { messageId, slug }, "error");
    return jsonResponse(500, { error: (err as Error).message });
  }

  if (!mailbox) {
    await logAgent("postmark_inbound_received", { messageId, slug }, "error");
    return jsonResponse(404, { error: "Mailbox lookup failed" });
  }

  const receivedAtRaw =
    (payload?.ReceivedAt as string | undefined) ??
    (payload?.Date as string | undefined) ??
    null;
  const receivedAt = receivedAtRaw ? new Date(receivedAtRaw).toISOString() : null;

  const htmlBody = String(payload?.HtmlBody ?? "").trim();
  const textBodyRaw = String(payload?.TextBody ?? "").trim();
  const textBody = textBodyRaw || (htmlBody ? stripHtml(htmlBody) : "");
  const snippet = buildSnippet(textBody);

  const inReplyTo = normalizeMessageId(findHeader(headers, "In-Reply-To"));
  const referencesRaw = findHeader(headers, "References");
  const referenceIds = [
    inReplyTo,
    ...(referencesRaw ? referencesRaw.split(/\s+/g) : []),
  ]
    .map((value) => normalizeMessageId(value))
    .filter(Boolean) as string[];

  const { data: existingMessage } = await supabase
    .from("mail_messages")
    .select("id, thread_id")
    .eq("provider", "smtp")
    .eq("provider_message_id", messageId)
    .maybeSingle();
  if (existingMessage?.id) {
    return jsonResponse(200, {
      ok: true,
      thread_id: existingMessage.thread_id,
      message_id: existingMessage.id,
      duplicate: true,
    });
  }

  let threadId: string | null = null;
  for (const ref of referenceIds) {
    if (!ref) continue;
    const match = await findThreadByReplyMessage(mailbox.mailbox_id, ref);
    if (match) {
      threadId = match;
      break;
    }
  }

  let createdNewThread = false;
  if (!threadId) {
    const { data: threadInsert, error: threadError } = await supabase
      .from("mail_threads")
      .insert({
        user_id: mailbox.user_id,
        mailbox_id: mailbox.mailbox_id,
        provider: "smtp",
        provider_thread_id: null,
        subject,
        snippet,
        last_message_at: receivedAt,
        unread_count: 1,
        is_read: false,
        status: "new",
        priority: "normal",
        tags: [],
        updated_at: new Date().toISOString(),
      })
      .select("id, subject, unread_count")
      .maybeSingle();
    if (threadError) {
      await logAgent(
        "postmark_inbound_received",
        { messageId, slug, error: threadError.message },
        "error",
      );
      return jsonResponse(500, { error: threadError.message });
    }
    threadId = (threadInsert as any)?.id ?? null;
    createdNewThread = true;
  }

  if (!threadId) {
    await logAgent("postmark_inbound_received", { messageId, slug }, "error");
    return jsonResponse(500, { error: "Thread creation failed" });
  }

  const { data: messageInsert, error: messageError } = await supabase
    .from("mail_messages")
    .insert({
      user_id: mailbox.user_id,
      mailbox_id: mailbox.mailbox_id,
      thread_id: threadId,
      provider: "smtp",
      provider_message_id: messageId,
      subject,
      snippet,
      body_text: textBody,
      body_html: htmlBody,
      from_name: fromName,
      from_email: fromEmail,
      to_emails: toList,
      cc_emails: ccList,
      bcc_emails: bccList,
      is_read: false,
      received_at: receivedAt,
      sent_at: receivedAt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (messageError) {
    await logAgent(
      "postmark_inbound_received",
      { messageId, slug, error: messageError.message },
      "error",
    );
    return jsonResponse(500, { error: messageError.message });
  }

  const messageDbId = (messageInsert as any)?.id ?? null;
  const { data: existingThread } = await supabase
    .from("mail_threads")
    .select("subject, unread_count")
    .eq("id", threadId)
    .maybeSingle();
  const currentUnread = Number(existingThread?.unread_count ?? 0);
  const nextUnreadCount = createdNewThread ? 1 : Math.max(0, currentUnread + 1);
  await supabase
    .from("mail_threads")
    .update({
      last_message_at: receivedAt,
      snippet,
      subject: existingThread?.subject ? existingThread.subject : subject,
      unread_count: nextUnreadCount,
      is_read: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId);

  if (messageDbId) {
    const attachments = Array.isArray(payload?.Attachments)
      ? (payload.Attachments as PostmarkAttachment[])
      : [];
    if (attachments.length) {
      const rows = attachments.map((att) => ({
        user_id: mailbox!.user_id,
        mailbox_id: mailbox!.mailbox_id,
        message_id: messageDbId,
        provider: "smtp",
        provider_attachment_id: att?.ContentID ?? null,
        filename: att?.Name ?? null,
        mime_type: att?.ContentType ?? null,
        size_bytes: att?.ContentLength ?? null,
        storage_path: null,
        created_at: new Date().toISOString(),
      }));
      await supabase.from("mail_attachments").insert(rows);
    }
  }

  await logAgent(
    "postmark_inbound_received",
    { messageId, slug, subject, from: fromRaw, to: toList },
    "success",
  );

  return jsonResponse(200, {
    ok: true,
    thread_id: threadId,
    message_id: messageDbId,
  });
});
