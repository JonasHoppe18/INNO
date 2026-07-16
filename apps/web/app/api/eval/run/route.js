import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { listScopedShops, resolveAuthScope } from "@/lib/server/workspace-auth";
import { normalizeEvalItems } from "@/lib/server/eval-run-data";

export const runtime = "nodejs";
export const maxDuration = 300;

const EVAL_WORKER_SECRET =
  process.env.EVAL_RUN_WORKER_SECRET ||
  process.env.CRON_SECRET ||
  "";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function resolveAppBaseUrl(request) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  if (!host) return "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

export async function GET(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  let shops;
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err) {
    return NextResponse.json({ error: `Shop lookup failed: ${err.message}` }, { status: 500 });
  }

  const shop = shops[0];
  if (!shop?.id) {
    return NextResponse.json({ error: "No shop found for this account" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = String(searchParams.get("job_id") || "").trim();

  let query = supabase
    .from("eval_runs")
    .select("*")
    .eq("shop_id", shop.id)
    .order("created_at", { ascending: false })
    .limit(25);
  if (jobId) query = query.eq("id", jobId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ jobs: data ?? [] });
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const run_label = String(body?.run_label || "").trim();
  const model = String(body?.model || "").trim() || "gpt-4o-mini";
  const strong_model = String(body?.strong_model || "").trim() || "";
  const judge_model = String(body?.judge_model || "").trim() || "gpt-4o-mini";
  const disable_escalation = body?.disable_escalation === true;
  const pipeline = String(body?.pipeline || "v2").trim() || "v2";

  if (!run_label) {
    return NextResponse.json({ error: "run_label required" }, { status: 400 });
  }
  if (pipeline !== "v2") {
    return NextResponse.json(
      { error: "Only the v2 eval pipeline is supported." },
      { status: 400 },
    );
  }

  const { mode, items } = normalizeEvalItems(body || {});
  if (!mode || items.length === 0) {
    return NextResponse.json({
      error: "emails, thread_ids, or zendesk_tickets required",
    }, { status: 400 });
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

  let shops;
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err) {
    return NextResponse.json({ error: `Shop lookup failed: ${err.message}` }, { status: 500 });
  }

  const shop = shops[0];
  if (!shop?.id) {
    return NextResponse.json({ error: "No shop found for this account" }, { status: 400 });
  }

  // Ryd gamle results for dette label så gentagede kørsler ikke stakker op
  await supabase
    .from("eval_results")
    .delete()
    .eq("shop_id", shop.id)
    .eq("run_label", run_label);

  const payload = {
    items,
    options: {
      model,
      strong_model,
      judge_model,
      disable_escalation,
      pipeline,
    },
  };

  const { data: job, error } = await supabase
    .from("eval_runs")
    .insert({
      shop_id: shop.id,
      run_label,
      status: "queued",
      mode,
      model,
      strong_model,
      judge_model,
      pipeline_version: pipeline,
      total_items: items.length,
      processed_items: 0,
      error_count: 0,
      payload,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const baseUrl = resolveAppBaseUrl(request);
  if (baseUrl && EVAL_WORKER_SECRET) {
    const workerUrl = `${baseUrl}/api/eval/run/worker`;
    void fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-eval-worker-secret": EVAL_WORKER_SECRET,
      },
      body: JSON.stringify({
        job_id: job.id,
        max_batches: 10,
        batch_size: 10,
        chain: true,
      }),
    }).catch(() => null);
  }

  return NextResponse.json({
    job,
  });
}
