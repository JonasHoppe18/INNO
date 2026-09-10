import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/server/shopify-oauth";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { SupabaseKnowledgeStore, splitMarkdownKnowledgeSource } from "@/lib/greenfield-support";
import { serializeGreenfieldKnowledge } from "@/lib/server/greenfield-knowledge";

export const runtime = "nodejs";

const RECORD_FIELDS = "id,workspace_id,knowledge_type,authority,title,content,structured_data,source_kind,source_id,source_uri,source_label,content_hash,published_at,observed_at,expires_at,metadata,source_uuid,source_version,source_content_hash,source_location,source_record_key,task_key,customer_aliases,created_at,updated_at";

async function scopedRequest() {
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

export async function POST(request) {
  try {
    const scoped = await scopedRequest();
    if (scoped.error) return scoped.error;
    const { supabase, scope } = scoped;
    const body = await request.json().catch(() => ({}));
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    const knowledgeType = String(body.knowledge_type || "procedure").trim().toLowerCase();
    const authority = String(body.authority || (knowledgeType === "policy" ? "authoritative" : "reference")).trim().toLowerCase();
    if (!title || !content) return NextResponse.json({ error: "Title and source content are required." }, { status: 400 });
    if (!["policy", "product", "brand", "procedural"].includes(knowledgeType)) return NextResponse.json({ error: "Choose a supported source knowledge type." }, { status: 400 });
    const sourceKind = String(body.source_kind || "document").trim().toLowerCase();
    const sourceId = String(body.source_id || `document:${crypto.randomUUID()}`).trim();
    const candidates = splitMarkdownKnowledgeSource({ title, content, knowledgeType, authority });
    if (!candidates.length) return NextResponse.json({ error: "The source did not contain any reviewable sections." }, { status: 400 });
    const result = await new SupabaseKnowledgeStore(supabase).ingestSource(scope.workspaceId, {
      sourceKind,
      sourceId,
      title,
      content,
      sourceUri: String(body.source_uri || "").trim() || null,
      sourceLabel: String(body.source_label || "").trim() || "Document upload",
      candidates,
    });
    const { data, error } = await supabase
      .from("greenfield_knowledge_records")
      .select(RECORD_FIELDS)
      .eq("workspace_id", scope.workspaceId)
      .eq("source_uuid", result.sourceId)
      .order("source_record_key");
    if (error) throw new Error(error.message);
    return NextResponse.json({
      source: { id: result.sourceId, version: result.sourceVersion, candidate_count: result.records.length },
      records: (Array.isArray(data) ? data : []).map(serializeGreenfieldKnowledge),
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not ingest knowledge source." }, { status: 500 });
  }
}
