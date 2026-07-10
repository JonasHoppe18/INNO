import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

import { resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  SUGGESTION_STATUSES,
  SUGGESTION_TYPES,
  ROOT_CAUSES,
} from "@/lib/server/feedback-suggestions";

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

const MAX_LIMIT = 200;

export async function GET(request) {
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
    // feedback_suggestions has workspace_id NOT NULL — without a workspace
    // there is nothing scoped to show.
    if (!scope?.workspaceId) {
      return NextResponse.json({ rows: [], counts: {} }, { status: 200 });
    }

    const params = request.nextUrl.searchParams;
    const status = params.get("status") || "suggested";
    const suggestionType = params.get("suggestion_type");
    const rootCause = params.get("root_cause");
    const limit = Math.min(
      Math.max(Number(params.get("limit")) || 50, 1),
      MAX_LIMIT,
    );

    if (status !== "all" && !SUGGESTION_STATUSES.has(status)) {
      return NextResponse.json({ error: `invalid status: ${status}` }, { status: 400 });
    }
    if (suggestionType && !SUGGESTION_TYPES.has(suggestionType)) {
      return NextResponse.json(
        { error: `invalid suggestion_type: ${suggestionType}` },
        { status: 400 },
      );
    }
    if (rootCause && !ROOT_CAUSES.has(rootCause)) {
      return NextResponse.json(
        { error: `invalid root_cause: ${rootCause}` },
        { status: 400 },
      );
    }

    let query = serviceClient
      .from("feedback_suggestions")
      .select(
        "id, shop_id, workspace_id, generation_id, draft_id, thread_id, suggestion_type, root_cause, confidence, evidence_json, proposed_change_summary, status, reviewer_user_id, review_note, created_at, reviewed_at",
      )
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status !== "all") query = query.eq("status", status);
    if (suggestionType) query = query.eq("suggestion_type", suggestionType);
    if (rootCause) query = query.eq("root_cause", rootCause);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Status histogram for the review header (single scoped aggregate).
    const { data: countRows, error: countError } = await serviceClient
      .from("feedback_suggestions")
      .select("status")
      .eq("workspace_id", scope.workspaceId);
    const counts = {};
    if (!countError && Array.isArray(countRows)) {
      for (const row of countRows) {
        counts[row.status] = (counts[row.status] || 0) + 1;
      }
    }

    return NextResponse.json({ rows: data || [], counts }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to list feedback suggestions." },
      { status: 500 },
    );
  }
}
