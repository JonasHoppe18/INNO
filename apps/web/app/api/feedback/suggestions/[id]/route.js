import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { buildSuggestionReviewPatch } from "@/lib/server/feedback-suggestions";

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

export async function PATCH(request, { params }) {
  try {
    const { userId: clerkUserId, orgId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const suggestionId = params?.id;
    if (!suggestionId) {
      return NextResponse.json({ error: "Missing suggestion id" }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId) {
      return NextResponse.json({ error: "No workspace" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));

    // Load the row inside the workspace scope so cross-tenant ids 404.
    const { data: existing, error: loadError } = await serviceClient
      .from("feedback_suggestions")
      .select("id, status")
      .eq("id", suggestionId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (loadError) {
      return NextResponse.json({ error: loadError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const built = buildSuggestionReviewPatch({
      currentStatus: existing.status,
      nextStatus: body.status,
      reviewerUserId: clerkUserId,
      reviewNote: body.review_note ?? null,
    });
    if (!built.ok) {
      return NextResponse.json({ error: built.error }, { status: 400 });
    }

    const { data: updated, error: updateError } = await serviceClient
      .from("feedback_suggestions")
      .update(built.patch)
      .eq("id", suggestionId)
      .eq("workspace_id", scope.workspaceId)
      .select(
        "id, suggestion_type, root_cause, confidence, proposed_change_summary, status, reviewer_user_id, review_note, created_at, reviewed_at",
      )
      .single();
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ row: updated }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to update feedback suggestion." },
      { status: 500 },
    );
  }
}
