import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  createServiceClient,
  processImportJobBatch,
  type KnowledgeImportJob,
} from "@/lib/server/knowledge-import";

export const runtime = "nodejs";
const IMPORT_WORKER_SECRET =
  process.env.IMPORT_HISTORY_WORKER_SECRET ||
  process.env.CRON_SECRET ||
  "";

function resolveAppBaseUrl(request: Request) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  if (!host) return "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const requestedJobId = typeof body?.job_id === "string" ? body.job_id.trim() : "";
  const chainRequested = body?.chain === true;
  const internalToken = String(request.headers.get("x-import-history-worker-secret") || "").trim();
  const internalAuthorized = Boolean(
    IMPORT_WORKER_SECRET &&
      internalToken &&
      internalToken === IMPORT_WORKER_SECRET
  );
  const maxBatches = internalAuthorized
    ? Math.max(1, Math.min(Number(body?.max_batches) || 3, 10))
    : Math.max(1, Math.min(Number(body?.max_batches) || 2, 5));

  let scope: { workspaceId: string | null; supabaseUserId: string | null } | null = null;
  if (!internalAuthorized) {
    const { userId: clerkUserId, orgId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    try {
      const serviceClientForScope = createServiceClient();
      if (!serviceClientForScope) {
        return NextResponse.json(
          { error: "Supabase service configuration is missing." },
          { status: 500 }
        );
      }
      scope = await resolveAuthScope(serviceClientForScope, { clerkUserId, orgId });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not resolve scope." },
        { status: 500 }
      );
    }
    if (!scope?.workspaceId && !scope?.supabaseUserId) {
      return NextResponse.json({ error: "No workspace/user scope found." }, { status: 400 });
    }
  } else if (!requestedJobId) {
    return NextResponse.json({ error: "job_id is required for internal worker calls." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  let query = serviceClient
    .from("knowledge_import_jobs")
    .select("*")
    .in("status", ["queued", "running"])
    .order("updated_at", { ascending: true })
    .limit(1);
  if (requestedJobId) {
    query = query.eq("id", requestedJobId);
  }
  if (scope) {
    query = applyScope(query, scope);
  }

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
    let integrationQuery = serviceClient
      .from("integrations")
      .select("id, config")
      .eq("provider", job.provider)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (scope) {
      integrationQuery = applyScope(integrationQuery, scope);
    } else if (job.workspace_id) {
      integrationQuery = integrationQuery.eq("workspace_id", job.workspace_id);
    } else if (job.user_id) {
      integrationQuery = integrationQuery.eq("user_id", job.user_id);
    }
    const { data: integration } = await integrationQuery.maybeSingle();
    if (integration?.id) {
      await serviceClient
        .from("integrations")
        .update({
          config: {
            ...(integration.config || {}),
            import_status: "failed",
            import_completed: false,
            import_error: message,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (internalAuthorized && chainRequested && job?.status === "running") {
    const baseUrl = resolveAppBaseUrl(request);
    if (baseUrl) {
      const workerUrl = `${baseUrl}/api/integrations/import-history/worker`;
      void fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-import-history-worker-secret": IMPORT_WORKER_SECRET,
        },
        body: JSON.stringify({
          job_id: job.id,
          max_batches: 3,
          chain: true,
        }),
      }).catch(() => null);
    }
  }

  return NextResponse.json({
    success: true,
    processed: processedBatches,
    imported,
    skipped,
    job,
  });
}
