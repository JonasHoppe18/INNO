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

const AUTO_CLOSE_THROTTLE_MS = 5 * 60 * 1000;
const autoCloseLastRun = new Map();

const DEFAULT_AUTO_CLOSE_DELAY_HOURS = 24 * 14;
const MIN_AUTO_CLOSE_DELAY_HOURS = 1;
const MAX_AUTO_CLOSE_DELAY_HOURS = 24 * 30;

function normalizeAutoCloseDelayHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUTO_CLOSE_DELAY_HOURS;
  const rounded = Math.round(parsed);
  return Math.max(
    MIN_AUTO_CLOSE_DELAY_HOURS,
    Math.min(MAX_AUTO_CLOSE_DELAY_HOURS, rounded)
  );
}

async function loadAutoCloseDelayHours(serviceClient, scope) {
  if (!scope?.workspaceId) return DEFAULT_AUTO_CLOSE_DELAY_HOURS;
  let query = await serviceClient
    .from("workspaces")
    .select("close_suggestion_delay_hours")
    .eq("id", scope.workspaceId)
    .maybeSingle();
  if (query.error?.code === "42703") {
    return DEFAULT_AUTO_CLOSE_DELAY_HOURS;
  }
  if (query.error) throw new Error(query.error.message);
  return normalizeAutoCloseDelayHours(query.data?.close_suggestion_delay_hours);
}

async function autoClosePendingThreads(serviceClient, scope, mailboxIds, autoCloseDelayHours) {
  if (!Array.isArray(mailboxIds) || mailboxIds.length === 0) return;
  const cutoffIso = new Date(
    Date.now() - normalizeAutoCloseDelayHours(autoCloseDelayHours) * 60 * 60 * 1000
  ).toISOString();
  const nowIso = new Date().toISOString();
  const query = applyScope(
    serviceClient
      .from("mail_threads")
      .update({ status: "solved", updated_at: nowIso })
      .eq("status", "pending")
      .eq("unread_count", 0)
      .in("mailbox_id", mailboxIds)
      .lt("last_message_at", cutoffIso),
    scope
  );
  const { error } = await query;
  if (error) throw new Error(error.message);
}

async function loadMailboxIds(serviceClient, scope) {
  const query = applyScope(serviceClient.from("mail_accounts").select("id"), scope);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.id).filter(Boolean);
}

async function loadThreads(serviceClient, scope, mailboxIds) {
  const runQuery = ({ withCustomerFields = true, withTicketNumber = true } = {}) =>
    applyScope(
      serviceClient
        .from("mail_threads")
        .select(
          withCustomerFields
            ? `id, user_id, mailbox_id, provider, provider_thread_id, ${
                withTicketNumber ? "ticket_number, " : ""
              }subject, snippet, customer_name, customer_email, customer_last_inbound_at, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, classification_key, classification_confidence, classification_reason, created_at, updated_at`
            : `id, user_id, mailbox_id, provider, provider_thread_id, ${
                withTicketNumber ? "ticket_number, " : ""
              }subject, snippet, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, classification_key, classification_confidence, classification_reason, created_at, updated_at`
        )
        .in("mailbox_id", mailboxIds)
        .order("last_message_at", { ascending: false, nullsLast: true })
        .limit(150),
      scope
    );
  let { data, error } = await runQuery({ withCustomerFields: true, withTicketNumber: true });
  if (
    error &&
    /customer_name|customer_email|customer_last_inbound_at|ticket_number/i.test(String(error.message || ""))
  ) {
    const fallbackWithoutCustomer = await runQuery({
      withCustomerFields: false,
      withTicketNumber: true,
    });
    data = fallbackWithoutCustomer.data;
    error = fallbackWithoutCustomer.error;
    if (error && /ticket_number/i.test(String(error.message || ""))) {
      const fallbackWithoutTicket = await runQuery({
        withCustomerFields: false,
        withTicketNumber: false,
      });
      data = fallbackWithoutTicket.data;
      error = fallbackWithoutTicket.error;
    }
  }
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function loadMessagesLite(serviceClient, scope, mailboxIds) {
  const query = applyScope(
    serviceClient
      .from("mail_messages")
      .select(
        "id, user_id, mailbox_id, thread_id, provider_message_id, subject, snippet, body_text, from_name, from_email, extracted_customer_name, extracted_customer_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at"
      )
      .in("mailbox_id", mailboxIds)
      .order("received_at", { ascending: false, nullsLast: true })
      .limit(120),
    scope
  );
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function GET() {
  try {
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
      return NextResponse.json({ threads: [], messages: [], attachments: [] }, { status: 200 });
    }

    const [mailboxIds, autoCloseDelayHours] = await Promise.all([
      loadMailboxIds(serviceClient, scope),
      loadAutoCloseDelayHours(serviceClient, scope).catch((error) => {
        console.error("api/inbox/live loadAutoCloseDelayHours failed:", error?.message || error);
        return DEFAULT_AUTO_CLOSE_DELAY_HOURS;
      }),
    ]);
    if (!mailboxIds.length) {
      return NextResponse.json({ threads: [], messages: [], attachments: [] }, { status: 200 });
    }

    const throttleKey = scope.workspaceId || scope.supabaseUserId;
    const lastRun = autoCloseLastRun.get(throttleKey) || 0;
    if (Date.now() - lastRun >= AUTO_CLOSE_THROTTLE_MS) {
      autoCloseLastRun.set(throttleKey, Date.now());
      await autoClosePendingThreads(serviceClient, scope, mailboxIds, autoCloseDelayHours).catch((error) => {
        console.error("api/inbox/live autoClosePendingThreads failed:", error?.message || error);
      });
    }

    const [threads, messages] = await Promise.all([
      loadThreads(serviceClient, scope, mailboxIds).catch((error) => {
        console.error("api/inbox/live loadThreads failed:", error?.message || error);
        return [];
      }),
      loadMessagesLite(serviceClient, scope, mailboxIds).catch((error) => {
        console.error("api/inbox/live loadMessagesLite failed:", error?.message || error);
        return [];
      }),
    ]);

    return NextResponse.json({ threads, messages, attachments: [] }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load inbox live data." },
      { status: 500 }
    );
  }
}
