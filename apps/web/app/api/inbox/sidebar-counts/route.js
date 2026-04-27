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

function extractInboxSlugFromTags(tags = []) {
  const list = Array.isArray(tags) ? tags : [];
  for (const rawTag of list) {
    const tag = String(rawTag || "").trim().toLowerCase();
    if (!tag.startsWith("inbox:")) continue;
    const slug = tag.slice("inbox:".length).trim();
    if (slug) return slug;
  }
  return "";
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
      .gt("unread_count", 0)
      .not("status", "in", "(Solved,solved,Resolved,resolved)"),
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

async function loadWorkspaceInboxSlugs(serviceClient, scope) {
  const { data, error } = await applyScope(
    serviceClient.from("workspace_inboxes").select("slug"),
    scope
  );
  if (error) {
    if (/relation .*workspace_inboxes.* does not exist/i.test(String(error?.message || ""))) {
      return [];
    }
    throw new Error(error.message);
  }
  return (Array.isArray(data) ? data : [])
    .map((row) => String(row?.slug || "").trim().toLowerCase())
    .filter(Boolean);
}

async function loadCustomInboxUnreadCounts(serviceClient, scope, mailboxIds, inboxSlugs) {
  if (!mailboxIds.length || !inboxSlugs.length) return {};
  const inboxTags = inboxSlugs.map((slug) => `inbox:${slug}`);
  const { data, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("tags, unread_count")
      .in("mailbox_id", mailboxIds)
      .gt("unread_count", 0)
      .overlaps("tags", inboxTags),
    scope
  );
  if (error) throw new Error(error.message);

  const counts = {};
  for (const slug of inboxSlugs) counts[slug] = 0;

  for (const row of Array.isArray(data) ? data : []) {
    const slug = extractInboxSlugFromTags(row?.tags || []);
    if (!counts.hasOwnProperty(slug)) continue;
    const unread = Number(row?.unread_count ?? 0);
    if (unread > 0) counts[slug] += unread;
  }

  return counts;
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
      return NextResponse.json(
        { assignedCount: 0, notificationsCount: 0, customInboxUnreadCounts: {} },
        { status: 200 }
      );
    }

    const [mailboxIds, inboxSlugs] = await Promise.all([
      loadMailboxIds(serviceClient, scope),
      loadWorkspaceInboxSlugs(serviceClient, scope),
    ]);

    const [assignedCount, mailNotificationsCount, mentionNotificationsCount, customInboxUnreadCounts] = await Promise.all([
      mailboxIds.length
        ? loadAssignedCount(serviceClient, scope, mailboxIds, scope.supabaseUserId)
        : 0,
      loadNotificationsCount(serviceClient, scope, mailboxIds),
      loadMentionNotificationsCount(serviceClient, scope),
      loadCustomInboxUnreadCounts(serviceClient, scope, mailboxIds, inboxSlugs),
    ]);
    const notificationsCount = mailNotificationsCount + mentionNotificationsCount;

    return NextResponse.json(
      { assignedCount, notificationsCount, customInboxUnreadCounts },
      { status: 200 }
    );
  } catch (error) {
    if (!isDynamicServerUsageError(error)) {
      console.error("Sidebar counts fallback:", error);
    }
    return NextResponse.json(
      { assignedCount: 0, notificationsCount: 0, customInboxUnreadCounts: {} },
      { status: 200 }
    );
  }
}
