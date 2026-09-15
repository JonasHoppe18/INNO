import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/server/shopify-oauth";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { SupabaseKnowledgeStore } from "@/lib/greenfield-support";
import { isGreenfieldPlaygroundDevTarget, isGreenfieldPlaygroundEnabled } from "@/lib/server/greenfield-playground";
import {
  PROCEDURE_SUGGESTION_FIELDS,
  buildPublishedProcedure,
  serializeProcedureSuggestion,
  validateProcedureSuggestionPayload,
} from "@/lib/server/greenfield-procedure-suggestions";
import { serializeGreenfieldKnowledge } from "@/lib/server/greenfield-knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWLEDGE_RECORD_FIELDS = "id,workspace_id,knowledge_type,authority,title,content,structured_data,source_kind,source_id,source_uri,source_label,content_hash,published_at,observed_at,expires_at,metadata,source_uuid,source_version,source_content_hash,source_location,source_record_key,task_key,customer_aliases,created_at,updated_at";

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

async function reloadKnowledgeRecord(supabase, workspaceId, id) {
  const { data, error } = await supabase
    .from("greenfield_knowledge_records")
    .select(KNOWLEDGE_RECORD_FIELDS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function POST(_request, { params }) {
  try {
    const scoped = await scopedSuggestion(params?.id);
    if (scoped.error) return scoped.error;
    const { supabase, scope, suggestion } = scoped;
    if (suggestion.status === "dismissed") return NextResponse.json({ error: "Dismissed suggestions must be restored before publishing." }, { status: 409 });
    if (suggestion.status === "published" && suggestion.published_knowledge_record_id) {
      const record = await reloadKnowledgeRecord(supabase, scope.workspaceId, suggestion.published_knowledge_record_id);
      return NextResponse.json({ suggestion: serializeProcedureSuggestion(suggestion), record: record ? serializeGreenfieldKnowledge(record) : null, already_published: true });
    }
    const validation = validateProcedureSuggestionPayload({ status: "reviewed" }, { existing: suggestion });
    if (!validation.valid) return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 400 });
    const built = buildPublishedProcedure({ suggestion, value: validation.value });
    const stored = await new SupabaseKnowledgeStore(supabase).ingest(scope.workspaceId, built.source);
    const record = await reloadKnowledgeRecord(supabase, scope.workspaceId, stored.id);
    if (!record) throw new Error("Published procedure was not returned after saving.");
    const now = new Date().toISOString();
    const { data: updatedSuggestion, error: updateError } = await supabase
      .from("greenfield_procedure_suggestions")
      .update({
        status: "published",
        published_knowledge_record_id: record.id,
        reviewed_at: suggestion.reviewed_at || now,
        published_at: now,
        dismissed_at: null,
      })
      .eq("workspace_id", scope.workspaceId)
      .eq("id", suggestion.id)
      .select(PROCEDURE_SUGGESTION_FIELDS)
      .single();
    if (updateError || !updatedSuggestion) throw new Error(updateError?.message || "Could not mark the suggestion as published.");
    return NextResponse.json({ suggestion: serializeProcedureSuggestion(updatedSuggestion), record: serializeGreenfieldKnowledge(record) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not publish suggested procedure." }, { status: 500 });
  }
}
