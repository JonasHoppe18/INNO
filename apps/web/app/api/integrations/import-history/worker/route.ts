import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  createServiceClient,
  processImportJobBatch,
  type KnowledgeImportJob,
} from "@/lib/server/knowledge-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not resolve scope." },
      { status: 500 }
    );
  }
  if (!scope.workspaceId && !scope.supabaseUserId) {
    return NextResponse.json({ error: "No workspace/user scope found." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedJobId = typeof body?.job_id === "string" ? body.job_id.trim() : "";
  const maxBatches = Math.max(1, Math.min(Number(body?.max_batches) || 2, 5));

  let query = serviceClient
    .from("knowledge_import_jobs")
    .select("*")
    .in("status", ["queued", "running"])
    .order("updated_at", { ascending: true })
    .limit(1);
  if (requestedJobId) {
    query = query.eq("id", requestedJobId);
  }
  query = applyScope(query, scope);

  const { data: jobRow, error: jobError } = await query.maybeSingle();
  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }
  if (!jobRow?.id) {
    return NextResponse.json({ success: true, processed: 0, message: "No active import job." });
  }

  let job = jobRow as KnowledgeImportJob;
  if (job.status === "queued") {
    const { data: startedJob, error: startError } = await serviceClient
      .from("knowledge_import_jobs")
      .update({
        status: "running",
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", job.id)
      .select("*")
      .maybeSingle();
    if (startError) {
      return NextResponse.json({ error: startError.message }, { status: 500 });
    }
    job = startedJob as KnowledgeImportJob;
  }

  let processedBatches = 0;
  let imported = 0;
  let skipped = 0;
  try {
    for (let i = 0; i < maxBatches; i += 1) {
      const batchResult = await processImportJobBatch(serviceClient, job);
      processedBatches += 1;
      imported += batchResult.imported;
      skipped += batchResult.skipped;
      job = batchResult.job;
      if (batchResult.completed) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error.";
    await serviceClient
      .from("knowledge_import_jobs")
      .update({
        status: "failed",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    processed: processedBatches,
    imported,
    skipped,
    job,
  });
}
