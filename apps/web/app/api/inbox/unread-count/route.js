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

async function loadMailboxIds(serviceClient, scope) {
  const query = applyScope(serviceClient.from("mail_accounts").select("id"), scope);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.id).filter(Boolean);
}

function hasCustomInboxTag(tags = []) {
  return (Array.isArray(tags) ? tags : []).some((tag) =>
    String(tag || "").trim().toLowerCase().startsWith("inbox:")
  );
}

async function loadUnreadCount(serviceClient, scope, mailboxIds) {
  const query = applyScope(
    serviceClient
      .from("mail_threads")
      .select("unread_count, tags")
      .in("mailbox_id", mailboxIds)
      .gt("unread_count", 0)
      // "All Tickets" excludes notification-classified and custom inbox threads.
      .or("classification_key.is.null,classification_key.neq.notification"),
    scope
  );
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  return rows.filter((row) => !hasCustomInboxTag(row?.tags)).length;
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
      return NextResponse.json({ unreadCount: 0 }, { status: 200 });
    }

    const mailboxIds = await loadMailboxIds(serviceClient, scope);
    if (!mailboxIds.length) {
      return NextResponse.json({ unreadCount: 0 }, { status: 200 });
    }

    const unreadCount = await loadUnreadCount(serviceClient, scope, mailboxIds);
    return NextResponse.json({ unreadCount }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load unread count." },
      { status: 500 }
    );
  }
}
