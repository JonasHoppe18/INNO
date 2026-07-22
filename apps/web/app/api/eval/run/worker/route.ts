// deno-lint-ignore-file
// @ts-nocheck: Supabase/Next typings are noisy for this server-only worker.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { listScopedShops, resolveAuthScope } from "@/lib/server/workspace-auth";
import { evalSourceThreadId } from "@/lib/server/eval-run-data";
import {
  draftForJudge,
  generateDraftV2,
  judgeWithOpenAI,
} from "@/lib/server/eval-runner";

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

function resolveAppBaseUrl(request: Request) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  if (!host) return "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

function normalizeJobItems(job: Record<string, unknown>) {
  const payload = (job?.payload ?? {}) as Record<string, unknown>;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items;
}

async function scoreEmail({
  evalRunId,
  sourceItemKey,
  shopId,
  runLabel,
  model,
  judgeModel,
  supabase,
  ticket,
  v2Options,
}: {
  evalRunId: string;
  sourceItemKey: string;
  shopId: string;
  runLabel: string;
  model: string;
  judgeModel: string;
  supabase: ReturnType<typeof createClient>;
  ticket: { subject?: string; body?: string };
  v2Options: { writerModel: string; strongModel?: string; disableEscalation: boolean };
}) {
  const ticketBody = String(ticket?.body || "").trim();
  const ticketSubject = String(ticket?.subject || "").trim() || null;
  if (!ticketBody) return;

  const { draft, actions, confidence, sources, routingHint, latencyMs } =
    await generateDraftV2(shopId, ticketSubject, ticketBody, v2Options);

  const scores = await judgeWithOpenAI(
    ticketBody,
    draftForJudge(draft, actions),
    null,
    judgeModel,
  );

  const { error: insertError } = await supabase
    .from("eval_results")
    .upsert({
      eval_run_id: evalRunId,
      source_item_key: sourceItemKey,
      shop_id: shopId,
      thread_id: null,
      run_label: runLabel,
      model,
      pipeline_version: "v2",
      ticket_subject: ticketSubject,
      ticket_body: ticketBody.slice(0, 2000),
      draft_content: draft.slice(0, 2000),
      proposed_actions: actions.length > 0 ? actions : null,
      verifier_confidence: confidence,
      sources: sources.length > 0 ? sources : null,
      routing_hint: routingHint,
      latency_ms: latencyMs,
      correctness: scores.correctness,
      completeness: scores.completeness,
      tone: scores.tone,
      actionability: scores.actionability,
      overall: scores.overall,
      overall_10: scores.overall_10,
      send_ready: scores.send_ready,
      primary_gap: scores.primary_gap,
      missing_for_10: scores.missing_for_10,
      likely_root_cause: scores.likely_root_cause,
      reasoning: scores.reasoning,
    }, {
      onConflict: "eval_run_id,source_item_key",
      ignoreDuplicates: true,
    });

  if (insertError) throw new Error(`eval_results insert failed: ${insertError.message}`);
}

async function scoreZendesk({
  evalRunId,
  sourceItemKey,
  shopId,
  runLabel,
  model,
  judgeModel,
  supabase,
  ticket,
  v2Options,
}: {
  evalRunId: string;
  sourceItemKey: string;
  shopId: string;
  runLabel: string;
  model: string;
  judgeModel: string;
  supabase: ReturnType<typeof createClient>;
  ticket: Record<string, unknown>;
  v2Options: { writerModel: string; strongModel?: string; disableEscalation: boolean };
}) {
  const ticketBody = String(ticket?.customer_body || ticket?.body || "").trim();
  const ticketSubject = String(ticket?.subject || "").trim() || null;
  const humanReply = String(ticket?.human_reply || "").trim() || null;
  const conversationHistory = String(ticket?.conversation_history || "").trim() || null;
  const sourceThreadId = evalSourceThreadId(ticket);
  const zendeskId = String(ticket?.external_ticket_id || ticket?.id || "");
  if (!ticketBody) return;

  const { draft, actions, confidence, sources, routingHint, latencyMs } =
    await generateDraftV2(shopId, ticketSubject, ticketBody, {
      ...v2Options,
      conversationHistory,
      sourceThreadId,
    });

  const judgeBody = conversationHistory
    ? `[Previous conversation:\n${conversationHistory}\n]\n\n${ticketBody}`
    : ticketBody;

  const anchorClass = String(
    (ticket as Record<string, unknown>)?.anchor_class || "comparable",
  );
  // Non-comparable anchors (human reply is a completed action confirmation) are
  // judged standalone, not against the human reply, and excluded from headline
  // aggregates downstream.
  const judgeHuman = anchorClass === "non_comparable_anchor" ? null : humanReply;

  const scores = await judgeWithOpenAI(
    judgeBody,
    draftForJudge(draft, actions),
    judgeHuman,
    judgeModel,
    anchorClass,
  );

  const { error: insertError } = await supabase
    .from("eval_results")
    .upsert({
      eval_run_id: evalRunId,
      source_item_key: sourceItemKey,
      shop_id: shopId,
      thread_id: null,
      run_label: runLabel,
      model,
      pipeline_version: "v2",
      ticket_subject: ticketSubject,
      ticket_body: ticketBody.slice(0, 2000),
      draft_content: draft.slice(0, 2000),
      proposed_actions: actions.length > 0 ? actions : null,
      verifier_confidence: confidence,
      sources: sources.length > 0 ? sources : null,
      routing_hint: routingHint,
      latency_ms: latencyMs,
      human_reply: humanReply ? humanReply.slice(0, 2000) : null,
      zendesk_ticket_id: zendeskId || null,
      anchor_class: anchorClass,
      excluded_from_aggregate: anchorClass === "non_comparable_anchor",
      judge_flags: scores.judge_flags ?? null,
      correctness: scores.correctness,
      completeness: scores.completeness,
      tone: scores.tone,
      actionability: scores.actionability,
      overall: scores.overall,
      overall_10: scores.overall_10,
      send_ready: scores.send_ready,
      primary_gap: scores.primary_gap,
      missing_for_10: scores.missing_for_10,
      likely_root_cause: scores.likely_root_cause,
      reasoning: scores.reasoning,
    }, {
      onConflict: "eval_run_id,source_item_key",
      ignoreDuplicates: true,
    });

  if (insertError) throw new Error(`eval_results insert failed: ${insertError.message}`);
}

async function scoreThread({
  evalRunId,
  sourceItemKey,
  shopId,
  runLabel,
  model,
  judgeModel,
  supabase,
  threadId,
}: {
  evalRunId: string;
  sourceItemKey: string;
  shopId: string;
  runLabel: string;
  model: string;
  judgeModel: string;
  supabase: ReturnType<typeof createClient>;
  threadId: string;
}) {
  const { data: draftMsg } = await supabase
    .from("mail_messages")
    .select("body, subject")
    .eq("thread_id", threadId)
    .eq("from_me", true)
    .eq("is_draft", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!draftMsg?.body) {
    throw new Error("No draft found");
  }

  const { data: customerMsg } = await supabase
    .from("mail_messages")
    .select("body, subject")
    .eq("thread_id", threadId)
    .eq("from_me", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!customerMsg?.body) {
    throw new Error("No customer message");
  }

  const scores = await judgeWithOpenAI(
    customerMsg.body,
    draftMsg.body,
    null,
    judgeModel,
  );

  const { error: insertError } = await supabase
    .from("eval_results")
    .upsert({
      eval_run_id: evalRunId,
      source_item_key: sourceItemKey,
      shop_id: shopId,
      thread_id: threadId,
      run_label: runLabel,
      model,
      ticket_subject: customerMsg.subject || draftMsg.subject || null,
      ticket_body: customerMsg.body.slice(0, 2000),
      draft_content: draftMsg.body.slice(0, 2000),
      correctness: scores.correctness,
      completeness: scores.completeness,
      tone: scores.tone,
      actionability: scores.actionability,
      overall: scores.overall,
      overall_10: scores.overall_10,
      send_ready: scores.send_ready,
      primary_gap: scores.primary_gap,
      missing_for_10: scores.missing_for_10,
      likely_root_cause: scores.likely_root_cause,
      reasoning: scores.reasoning,
    }, {
      onConflict: "eval_run_id,source_item_key",
      ignoreDuplicates: true,
    });

  if (insertError) throw new Error(`eval_results insert failed: ${insertError.message}`);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const requestedJobId = typeof body?.job_id === "string" ? body.job_id.trim() : "";
  const chainRequested = body?.chain === true;

  const internalToken = String(request.headers.get("x-eval-worker-secret") || "").trim();
  const internalAuthorized = Boolean(
    EVAL_WORKER_SECRET &&
      internalToken &&
      internalToken === EVAL_WORKER_SECRET
  );

  const maxBatches = internalAuthorized
    ? Math.max(1, Math.min(Number(body?.max_batches) || 3, 10))
    : Math.max(1, Math.min(Number(body?.max_batches) || 2, 5));
  const batchSize = internalAuthorized
    ? Math.max(1, Math.min(Number(body?.batch_size) || 10, 20))
    : Math.max(1, Math.min(Number(body?.batch_size) || 6, 10));

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
  } else if (!requestedJobId) {
    return NextResponse.json({ error: "job_id is required for internal worker calls." }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  let query = supabase
    .from("eval_runs")
    .select("*")
    .in("status", ["queued", "running"])
    .order("updated_at", { ascending: true })
    .limit(1);

  if (requestedJobId) {
    query = query.eq("id", requestedJobId);
  }

  if (scope) {
    let shops: Array<{ id: string }> = [];
    try {
      shops = await listScopedShops(supabase, scope, { fields: "id" });
    } catch {
      shops = [];
    }
    const shopIds = shops.map((shop) => shop.id).filter(Boolean);
    if (shopIds.length > 0) {
      query = query.in("shop_id", shopIds);
    }
  }

  const { data: jobRow, error: jobError } = await query.maybeSingle();
  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }
  if (!jobRow?.id) {
    return NextResponse.json({ success: true, processed: 0, message: "No active eval job." });
  }

  let job = jobRow as Record<string, unknown>;
  if (job.status === "queued") {
    const { data: startedJob, error: startError } = await supabase
      .from("eval_runs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", job.id)
      .select("*")
      .maybeSingle();

    if (startError) {
      return NextResponse.json({ error: startError.message }, { status: 500 });
    }
    job = startedJob as Record<string, unknown>;
  }

  const items = normalizeJobItems(job);
  const totalItems = Number(job.total_items || items.length || 0);
  const processedItems = Number(job.processed_items || 0);
  const mode = String(job.mode || "");
  const runLabel = String(job.run_label || "");
  const model = String(job.model || "gpt-4o-mini");
  const judgeModel = String(job.judge_model || "gpt-4o-mini");
  const pipeline = String(job.pipeline_version || "v2").trim() || "v2";
  if (pipeline !== "v2") {
    await supabase
      .from("eval_runs")
      .update({
        status: "failed",
        last_error: `Unsupported eval pipeline '${pipeline}'. Only v2 is supported.`,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json(
      { error: `Unsupported eval pipeline '${pipeline}'. Only v2 is supported.` },
      { status: 400 },
    );
  }
  const payload = typeof job.payload === "object" && job.payload !== null ? job.payload : {};
  const payloadOptions =
    typeof payload.options === "object" && payload.options !== null ? payload.options : {};
  const v2Options = {
    writerModel: model,
    strongModel: String(job.strong_model || "").trim() || undefined,
    disableEscalation: payloadOptions.disable_escalation === true,
  };

  const shopId = String(job.shop_id || "");
  if (!shopId) {
    return NextResponse.json({ error: "Job missing shop_id" }, { status: 500 });
  }

  const slice = items.slice(processedItems, processedItems + batchSize);
  if (slice.length === 0) {
    const { data: finishedJob } = await supabase
      .from("eval_runs")
      .update({
        status: "completed",
        processed_items: processedItems,
        total_items: totalItems,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .select("*")
      .maybeSingle();

    return NextResponse.json({ success: true, processed: 0, job: finishedJob });
  }

  const results = await Promise.allSettled(
    slice.map((item, offset) => {
      const evalRunId = String(job.id);
      const sourceItemKey = `${mode}:${processedItems + offset}`;
      if (mode === "manual") {
        return scoreEmail({
          evalRunId,
          sourceItemKey,
          shopId,
          runLabel,
          model,
          judgeModel,
          supabase,
          ticket: item as { subject?: string; body?: string },
          v2Options,
        });
      } else if (mode === "zendesk") {
        return scoreZendesk({
          evalRunId,
          sourceItemKey,
          shopId,
          runLabel,
          model,
          judgeModel,
          supabase,
          ticket: item as Record<string, unknown>,
          v2Options,
        });
      } else if (mode === "threads") {
        return scoreThread({
          evalRunId,
          sourceItemKey,
          shopId,
          runLabel,
          model,
          judgeModel,
          supabase,
          threadId: String(item || ""),
        });
      }
      return Promise.resolve();
    })
  );

  const processed = results.length;
  let errorCount = 0;
  let lastError: string | null = null;
  for (const result of results) {
    if (result.status === "rejected") {
      errorCount += 1;
      lastError = result.reason instanceof Error ? result.reason.message : "Unknown worker error.";
    }
  }

  const nextProcessed = processedItems + processed;
  const nextErrorCount = Number(job.error_count || 0) + errorCount;
  const completed = nextProcessed >= totalItems;

  const { data: updatedJob, error: updateError } = await supabase
    .from("eval_runs")
    .update({
      processed_items: nextProcessed,
      total_items: totalItems,
      error_count: nextErrorCount,
      last_error: lastError,
      status: completed ? "completed" : "running",
      updated_at: new Date().toISOString(),
      finished_at: completed ? new Date().toISOString() : null,
    })
    .eq("id", job.id)
    .select("*")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (internalAuthorized && chainRequested && updatedJob?.status === "running") {
    const baseUrl = resolveAppBaseUrl(request);
    if (baseUrl) {
      const workerUrl = `${baseUrl}/api/eval/run/worker`;
      void fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-eval-worker-secret": EVAL_WORKER_SECRET,
        },
        body: JSON.stringify({
          job_id: job.id,
          max_batches: maxBatches,
          batch_size: batchSize,
          chain: true,
        }),
      }).catch(() => null);
    }
  }

  return NextResponse.json({
    success: true,
    processed,
    job: updatedJob,
  });
}
