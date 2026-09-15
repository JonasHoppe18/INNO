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

async function scopedSuggestion(id) {
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
  const { data, error } = await supabase
    .from("greenfield_procedure_suggestions")
    .select(PROCEDURE_SUGGESTION_FIELDS)
    .eq("workspace_id", scope.workspaceId)
    .eq("id", String(id || ""))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { error: NextResponse.json({ error: "Suggested procedure not found." }, { status: 404 }) };
  return { supabase, scope, suggestion: data };
}

export async function GET(_request, { params }) {
  try {
    const scoped = await scopedSuggestion(params?.id);
    if (scoped.error) return scoped.error;
    return NextResponse.json({ suggestion: serializeProcedureSuggestion(scoped.suggestion) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load suggested procedure." }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const scoped = await scopedSuggestion(params?.id);
    if (scoped.error) return scoped.error;
    const { supabase, scope, suggestion } = scoped;
    if (String(suggestion.status || "") === "published") {
      return NextResponse.json({ error: "Published suggestions are edited as normal Knowledge procedures." }, { status: 409 });
    }
    const body = await request.json().catch(() => ({}));
    const allowedKeys = new Set([
      "title",
      "trigger",
      "customer_phrasing_examples",
      "recommended_steps",
      "escalation_condition",
      "policy_dependencies",
      "action_permission_note",
      "status",
    ]);
    if (Object.keys(body || {}).some((key) => !allowedKeys.has(key))) {
      return NextResponse.json({ error: "Suggestion evidence and provenance are read-only." }, { status: 400 });
    }
    const validation = validateProcedureSuggestionPayload(body, { existing: suggestion });
    if (!validation.valid) return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 400 });
    const { data, error } = await supabase
      .from("greenfield_procedure_suggestions")
      .update(buildSuggestionUpdate(validation.value))
      .eq("workspace_id", scope.workspaceId)
      .eq("id", suggestion.id)
      .select(PROCEDURE_SUGGESTION_FIELDS)
      .single();
    if (error || !data) throw new Error(error?.message || "Could not save suggested procedure.");
    return NextResponse.json({ suggestion: serializeProcedureSuggestion(data) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save suggested procedure." }, { status: 500 });
  }
}
