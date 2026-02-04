import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { InboxPageClient } from "@/components/inbox/InboxPageClient";

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

async function loadMailboxes(serviceClient, userId) {
  const { data, error } = await serviceClient
    .from("mail_accounts")
    .select("id, provider, provider_email")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function loadMessages(serviceClient, userId, mailboxIds, { query, unreadOnly }) {
  let request = serviceClient
    .from("mail_messages")
    .select(
      "id, mailbox_id, thread_id, subject, snippet, body_text, body_html, from_name, from_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at, ai_draft_text"
    )
    .eq("user_id", userId)
    .in("mailbox_id", mailboxIds)
    .order("received_at", { ascending: false, nullsLast: true })
    .limit(60);

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
  if (error && /ai_draft_text/i.test(error.message || "")) {
    const fallbackRequest = serviceClient
      .from("mail_messages")
      .select(
        "id, mailbox_id, thread_id, subject, snippet, body_text, body_html, from_name, from_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at"
      )
      .eq("user_id", userId)
      .in("mailbox_id", mailboxIds)
      .order("received_at", { ascending: false, nullsLast: true })
      .limit(60);

    if (unreadOnly) {
      fallbackRequest.eq("is_read", false);
    }

    if (query) {
      const escaped = query.replace(/%/g, "\\%").replace(/_/g, "\\_");
      fallbackRequest.or(
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

async function loadThreads(serviceClient, userId, mailboxIds) {
  const { data, error } = await serviceClient
    .from("mail_threads")
    .select(
      "id, user_id, mailbox_id, provider, provider_thread_id, subject, snippet, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, created_at, updated_at"
    )
    .eq("user_id", userId)
    .in("mailbox_id", mailboxIds)
    .order("last_message_at", { ascending: false, nullsLast: true });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

const NEWSLETTER_SUBJECT_PATTERNS = [
  /unsubscribe/i,
  /newsletter/i,
  /\bpromo\b/i,
  /\bpromotion\b/i,
  /\bmarketing\b/i,
  /\bdiscount\b/i,
  /\bsale\b/i,
  /\bdo not reply\b/i,
  /\bno-?reply\b/i,
  /\bemail preferences\b/i,
];

const NEWSLETTER_SENDER_PATTERNS = [
  /mailchimp/i,
  /sendgrid/i,
  /klaviyo/i,
  /campaign-?monitor/i,
  /constantcontact/i,
  /mailerlite/i,
  /mailgun/i,
  /sparkpost/i,
  /postmarkapp/i,
];

function shouldHideFromInbox(message) {
  const subject = message?.subject || "";
  const snippet = message?.snippet || "";
  const fromEmail = message?.from_email || "";
  const fromName = message?.from_name || "";
  const combined = `${subject}\n${snippet}\n${fromName}`.toLowerCase();

  if (NEWSLETTER_SUBJECT_PATTERNS.some((pattern) => pattern.test(combined))) {
    return true;
  }
  if (NEWSLETTER_SENDER_PATTERNS.some((pattern) => pattern.test(fromEmail))) {
    return true;
  }
  return false;
}

export default async function InboxPage({ searchParams }) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/inbox");
  }

  const serviceClient = createServiceClient();
  const query = typeof searchParams?.q === "string" ? searchParams.q.trim() : "";
  const unreadOnly = searchParams?.unread === "1";
  let mailboxes = [];
  let messages = [];
  let threads = [];

  if (serviceClient) {
    try {
      const supabaseUserId = await resolveSupabaseUserId(serviceClient, userId);
      if (supabaseUserId) {
        mailboxes = await loadMailboxes(serviceClient, supabaseUserId);
        const mailboxIds = mailboxes.map((mailbox) => mailbox.id);
        if (mailboxIds.length) {
          threads = await loadThreads(serviceClient, supabaseUserId, mailboxIds);
          messages = await loadMessages(serviceClient, supabaseUserId, mailboxIds, {
            query,
            unreadOnly,
          });
        }
      }
    } catch (error) {
      console.error("Inbox mail lookup failed:", error);
    }
  }

  if (!mailboxes.length) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-slate-900">Connect a mailbox</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            You need to connect a support inbox before Sona can fetch your emails.
          </p>
          <Button asChild className="mt-3 h-8 text-xs">
            <Link href="/mailboxes">Go to Mailboxes</Link>
          </Button>
        </div>
      </div>
    );
  }

  const visibleMessages = messages.filter((message) => !shouldHideFromInbox(message));

  return <InboxPageClient threads={threads} messages={visibleMessages} />;
}
