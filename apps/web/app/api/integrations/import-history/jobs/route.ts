import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import { createServiceClient } from "@/lib/server/knowledge-import";

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

function kickImportWorkerInBackground(request: Request, jobId: string) {
  if (!IMPORT_WORKER_SECRET || !jobId) return;
  const baseUrl = resolveAppBaseUrl(request);
  if (!baseUrl) return;
  const workerUrl = `${baseUrl}/api/integrations/import-history/worker`;
  void fetch(workerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-import-history-worker-secret": IMPORT_WORKER_SECRET,
    },
    body: JSON.stringify({
      job_id: jobId,
      max_batches: 3,
      chain: true,
    }),
  }).catch(() => null);
}

async function resolveShopId(
  serviceClient: any,
  scope: { workspaceId: string | null; supabaseUserId: string | null },
  requestedShopId?: string
) {
  if (requestedShopId?.trim()) {
    let query = serviceClient
      .from("shops")
      .select("id")
      .eq("id", requestedShopId.trim())
      .limit(1);
    query = applyScope(query, scope, {
      workspaceColumn: "workspace_id",
      userColumn: "owner_user_id",
    });
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error("Shop not found in your scope.");
    return data.id as string;
  }

  let query = serviceClient
    .from("shops")
    .select("id")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  query = applyScope(query, scope, {
    workspaceColumn: "workspace_id",
    userColumn: "owner_user_id",
  });
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("No active shop found in scope.");
  return data.id as string;
}

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

  const body = await request.json().catch(() => ({}));
  const provider = String(body?.provider || "").trim().toLowerCase();
  const requestedShopId = typeof body?.shop_id === "string" ? body.shop_id : undefined;
  const maxTickets = Math.max(100, Math.min(Number(body?.max_tickets) || 1000, 5000));
  const batchSize = Math.max(10, Math.min(Number(body?.batch_size) || 50, 100));

  if (!["zendesk", "gorgias", "freshdesk"].includes(provider)) {
    return NextResponse.json(
      { error: "provider must be one of: zendesk, gorgias, freshdesk." },
      { status: 400 }
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

  let shopId: string;
  try {
    shopId = await resolveShopId(serviceClient, scope, requestedShopId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not resolve shop." },
      { status: 404 }
    );
  }

  let activeJobQuery = serviceClient
    .from("knowledge_import_jobs")
    .select("*")
    .eq("provider", provider)
    .eq("shop_id", shopId)
    .in("status", ["queued", "running"])
    .order("updated_at", { ascending: false })
    .limit(1);
  activeJobQuery = applyScope(activeJobQuery, scope);
  const { data: activeJob, error: activeJobError } = await activeJobQuery.maybeSingle();
  if (activeJobError) {
    return NextResponse.json({ error: activeJobError.message }, { status: 500 });
  }
  if (activeJob?.id) {
    kickImportWorkerInBackground(request, activeJob.id);
    return NextResponse.json({
      success: true,
      queued: false,
      job: activeJob,
    });
  }

  const payload = {
    provider,
    shop_id: shopId,
    workspace_id: scope.workspaceId,
    user_id: scope.supabaseUserId,
    status: "queued",
    cursor: {},
    max_tickets: maxTickets,
    batch_size: batchSize,
    imported_count: 0,
    skipped_count: 0,
    updated_at: new Date().toISOString(),
  };
  const { data: insertedJob, error: insertError } = await serviceClient
    .from("knowledge_import_jobs")
    .insert(payload)
    .select("*")
    .maybeSingle();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  if (insertedJob?.id) {
    kickImportWorkerInBackground(request, insertedJob.id);
  }

  return NextResponse.json({
    success: true,
    queued: true,
    job: insertedJob,
  });
}
