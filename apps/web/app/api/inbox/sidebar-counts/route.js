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

async function loadMailboxIds(serviceClient, scope) {
  const query = applyScope(serviceClient.from("mail_accounts").select("id"), scope);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.id).filter(Boolean);
}

async function loadAssignedCount(serviceClient, scope, mailboxIds, supabaseUserId, clerkUserId) {
  const ids = [supabaseUserId, clerkUserId].filter(Boolean);
  if (!ids.length) return 0;
  const orFilter = ids.map((id) => `assignee_id.eq.${id}`).join(",");
  const { count, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id", { count: "exact", head: true })
      .in("mailbox_id", mailboxIds)
      .or(orFilter)
      .not("status", "in", '("Solved","Resolved","resolved")'),
    scope
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function loadNotificationsCount(serviceClient, scope, mailboxIds) {
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
    if (!mailboxIds.length) {
      return NextResponse.json({ assignedCount: 0, notificationsCount: 0 }, { status: 200 });
    }

    const [assignedCount, notificationsCount] = await Promise.all([
      loadAssignedCount(serviceClient, scope, mailboxIds, scope.supabaseUserId, clerkUserId),
      loadNotificationsCount(serviceClient, scope, mailboxIds),
    ]);

    return NextResponse.json({ assignedCount, notificationsCount }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load sidebar counts." },
      { status: 500 }
    );
  }
}
