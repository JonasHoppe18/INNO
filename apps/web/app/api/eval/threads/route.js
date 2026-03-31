import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

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

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const shopQuery = supabase
    .from("shops")
    .select("id")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (scope?.workspaceId) {
    shopQuery.eq("workspace_id", scope.workspaceId);
  } else if (scope?.userId) {
    shopQuery.eq("owner_user_id", scope.userId);
  }

  const { data: shop } = await shopQuery.maybeSingle();
  if (!shop?.id) {
    return NextResponse.json({ thread_ids: [] });
  }

  // Get latest threads that have at least one draft
  const { data: drafts } = await supabase
    .from("mail_messages")
    .select("thread_id")
    .eq("from_me", true)
    .eq("is_draft", true)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!drafts || drafts.length === 0) {
    return NextResponse.json({ thread_ids: [] });
  }

  // Deduplicate — keep latest per thread, max 10
  const seen = new Set();
  const threadIds = [];
  for (const row of drafts) {
    if (!seen.has(row.thread_id)) {
      seen.add(row.thread_id);
      threadIds.push(row.thread_id);
    }
    if (threadIds.length >= 10) break;
  }

  return NextResponse.json({ thread_ids: threadIds });
}
