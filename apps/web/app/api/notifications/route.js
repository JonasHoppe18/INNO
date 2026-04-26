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

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function parseUuidList(value) {
  const source = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      source
        .map((entry) => String(entry || "").trim())
        .filter((entry) => isUuid(entry))
    )
  );
}

async function loadMailboxIds(serviceClient, scope) {
  const query = applyScope(serviceClient.from("mail_accounts").select("id"), scope);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.id).filter(Boolean);
}

async function loadMailNotifications(serviceClient, scope, mailboxIds, limit = 10) {
  if (!mailboxIds.length) return [];
  const { data, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, subject, customer_email, updated_at, unread_count")
      .in("mailbox_id", mailboxIds)
      .eq("classification_key", "notification")
      .gt("unread_count", 0)
      .order("updated_at", { ascending: false })
      .limit(limit),
    scope
  );
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: `mail-thread:${row.id}`,
    thread_id: row.id,
    type: "mail_notification",
    mention_id: null,
    can_mark_read: false,
    title: String(row?.subject || "").trim() || "No subject",
    subtitle: String(row?.customer_email || "").trim() || "System notification",
    updated_at: row?.updated_at || null,
  }));
}

async function loadMentionNotifications(serviceClient, scope, limit = 10) {
  if (!scope?.supabaseUserId) return [];
  const { data, error } = await applyScope(
    serviceClient
      .from("workspace_member_notifications")
      .select("id, thread_id, title, body, created_at, kind")
      .eq("recipient_user_id", scope.supabaseUserId)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(limit),
    scope,
    { workspaceColumn: "workspace_id", userColumn: null }
  );
  if (error) {
    if (String(error?.code || "") === "42P01") return [];
    throw new Error(error.message);
  }
  return (data || []).map((row) => ({
    id: `mention:${row.id}`,
    thread_id: row?.thread_id || null,
    type: row?.kind || "internal_note_mention",
    mention_id: row?.id || null,
    can_mark_read: true,
    title: String(row?.title || "").trim() || "You were mentioned",
    subtitle: String(row?.body || "").trim() || "In an internal note",
    updated_at: row?.created_at || null,
  }));
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
      return NextResponse.json({ notifications: [] }, { status: 200 });
    }

    const mailboxIds = await loadMailboxIds(serviceClient, scope);
    const [mailNotifications, mentionNotifications] = await Promise.all([
      loadMailNotifications(serviceClient, scope, mailboxIds, 10),
      loadMentionNotifications(serviceClient, scope, 10),
    ]);

    const notifications = [...mailNotifications, ...mentionNotifications]
      .filter((row) => row?.updated_at)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 10);

    return NextResponse.json({ notifications }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load notifications." },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
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
    if (!scope.workspaceId || !scope.supabaseUserId) {
      return NextResponse.json({ marked: 0 }, { status: 200 });
    }

    let payload = null;
    try {
      payload = await request.json();
    } catch {
      payload = null;
    }
    const mentionIds = parseUuidList(payload?.mention_ids ?? payload?.mention_id);
    const threadIds = parseUuidList(payload?.thread_ids ?? payload?.thread_id);
    if (!mentionIds.length && !threadIds.length) {
      return NextResponse.json({ marked: 0 }, { status: 200 });
    }

    const nowIso = new Date().toISOString();
    let updateQuery = serviceClient
      .from("workspace_member_notifications")
      .update({ is_read: true, read_at: nowIso, updated_at: nowIso })
      .eq("recipient_user_id", scope.supabaseUserId)
      .eq("is_read", false);

    if (mentionIds.length) {
      updateQuery = updateQuery.in("id", mentionIds);
    } else {
      updateQuery = updateQuery.in("thread_id", threadIds);
    }

    const { data, error } = await applyScope(updateQuery.select("id"), scope, {
      workspaceColumn: "workspace_id",
      userColumn: null,
    });
    if (error) {
      if (String(error?.code || "") === "42P01") {
        return NextResponse.json({ marked: 0 }, { status: 200 });
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ marked: Array.isArray(data) ? data.length : 0 }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to mark notifications as read." },
      { status: 500 }
    );
  }
}
