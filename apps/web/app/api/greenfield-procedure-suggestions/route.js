import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/server/shopify-oauth";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { isGreenfieldPlaygroundDevTarget, isGreenfieldPlaygroundEnabled } from "@/lib/server/greenfield-playground";
import {
  PROCEDURE_SUGGESTION_FIELDS,
  buildSuggestionUpdate,
  serializeProcedureSuggestion,
  validateProcedureSuggestionPayload,
} from "@/lib/server/greenfield-procedure-suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUGGESTION_STATUS_ORDER = Object.freeze({ suggested: 0, reviewed: 1, published: 2, dismissed: 3 });

async function scopedRequest() {
  if (!isGreenfieldPlaygroundDevTarget() || !isGreenfieldPlaygroundEnabled()) {
    return { error: NextResponse.json({ error: "Suggested procedures are available only in the Greenfield DEV environment." }, { status: 404 }) };
  }
  const authState = await auth();
  if (!authState?.userId) return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  const supabase = createServiceSupabase();
  const scope = await resolveAuthScope(supabase, {
    clerkUserId: authState.userId,
    orgId: authState.orgId,
    sessionClaims: authState.sessionClaims,
  });
  if (!scope?.workspaceId) return { error: NextResponse.json({ error: "A single active workspace is required." }, { status: 403 }) };
  return { supabase, scope };
}

export async function GET() {
  try {
    const scoped = await scopedRequest();
    if (scoped.error) return scoped.error;
    const { supabase, scope } = scoped;
    const { data, error } = await supabase
      .from("greenfield_procedure_suggestions")
      .select(PROCEDURE_SUGGESTION_FIELDS)
      .eq("workspace_id", scope.workspaceId)
      .order("updated_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const suggestions = (Array.isArray(data) ? data : [])
      .map(serializeProcedureSuggestion)
      .sort((left, right) => (SUGGESTION_STATUS_ORDER[left.status] ?? 99) - (SUGGESTION_STATUS_ORDER[right.status] ?? 99));
    return NextResponse.json({ suggestions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load suggested procedures." }, { status: 500 });
  }
}
