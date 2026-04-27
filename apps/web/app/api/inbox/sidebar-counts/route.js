import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";

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

function isMissingMentionTable(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("workspace_member_notifications") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

function isDynamicServerUsageError(error) {
  return String(error?.digest || "").toUpperCase() === "DYNAMIC_SERVER_USAGE";
}

async function loadMailboxIds(serviceClient, scope) {
  const query = applyScope(serviceClient.from("mail_accounts").select("id"), scope);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.id).filter(Boolean);
}

async function loadAssignedCount(serviceClient, scope, mailboxIds, supabaseUserId) {
  if (!supabaseUserId) return 0;
  const { count, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id", { count: "exact", head: true })
      .in("mailbox_id", mailboxIds)
      .eq("assignee_id", supabaseUserId)
      .not("status", "in", "(Solved,Resolved,resolved)"),
    scope
  );
  if (error) throw new Error(error.details || error.message || JSON.stringify(error));
  return count ?? 0;
}

async function loadNotificationsCount(serviceClient, scope, mailboxIds) {
  if (!mailboxIds.length) return 0;
  const { count, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id", { count: "exact", head: true })
      .in("mailbox_id", mailboxIds)
      .eq("classification_key", "notification")
      .gt("unread_count", 0),
    scope
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function loadMentionNotificationsCount(serviceClient, scope) {
  if (!scope?.supabaseUserId) return 0;
  const { count, error } = await applyScope(
    serviceClient
      .from("workspace_member_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", scope.supabaseUserId)
      .eq("is_read", false),
    scope,
    { workspaceColumn: "workspace_id", userColumn: null }
  );
  if (error) {
    if (isMissingMentionTable(error)) return 0;
    throw new Error(error.message);
  }
  return count ?? 0;
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
      return NextResponse.json({ assignedCount: 0, notificationsCount: 0 }, { status: 200 });
    }

    const mailboxIds = await loadMailboxIds(serviceClient, scope);

    const [assignedCount, mailNotificationsCount, mentionNotificationsCount] = await Promise.all([
      mailboxIds.length
        ? loadAssignedCount(serviceClient, scope, mailboxIds, scope.supabaseUserId)
        : 0,
      loadNotificationsCount(serviceClient, scope, mailboxIds),
      loadMentionNotificationsCount(serviceClient, scope),
    ]);
    const notificationsCount = mailNotificationsCount + mentionNotificationsCount;

    return NextResponse.json({ assignedCount, notificationsCount }, { status: 200 });
  } catch (error) {
    if (!isDynamicServerUsageError(error)) {
      console.error("Sidebar counts fallback:", error);
    }
    return NextResponse.json({ assignedCount: 0, notificationsCount: 0 }, { status: 200 });
  }
}
