import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function extractThreadIdFromDetail(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      const id =
        parsed?.thread_id ??
        parsed?.threadId ??
        null;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    } catch {
      return null;
    }
  }
  const match = raw.match(/thread_id\s*[:=]\s*([a-z0-9-]+)/i);
  return match?.[1] || null;
}

function safeParseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

const INTENT_LABELS = {
  tracking:         "a shipment tracking request",
  return:           "a return request",
  refund:           "a refund request",
  exchange:         "an exchange request",
  address_change:   "a shipping address change",
  product_question: "a product question",
  complaint:        "a complaint",
  thanks:           "a thank-you message",
  update:           "a status update",
  other:            "a general inquiry",
};

function buildReasoning(intent, confidence, orderNumber, kb_chunks, knowledge_gaps) {
  if (!intent) return null;

  // Sentence 1: classification
  const label = INTENT_LABELS[intent] ?? intent;
  const lowConf = typeof confidence === "number" && confidence < 0.75;
  const s1 = `Classified as ${label}${lowConf ? " (low confidence)" : ""}.`;

  // Sentence 2: order + sources
  const parts = [];
  if (orderNumber) parts.push(`Found order #${orderNumber}.`);
  if (kb_chunks.length > 0) {
    const topTitles = kb_chunks.slice(0, 2).map((c) => c.title).filter(Boolean);
    const remainder = kb_chunks.length - topTitles.length;
    if (topTitles.length > 0) {
      const listed = topTitles.map((t) => `"${t}"`).join(" and ");
      const more = remainder > 0 ? ` and ${remainder} more source${remainder !== 1 ? "s" : ""}` : "";
      parts.push(`Used ${listed}${more}.`);
    } else {
      parts.push(`Retrieved ${kb_chunks.length} knowledge source${kb_chunks.length !== 1 ? "s" : ""}.`);
    }
  } else {
    parts.push("No matching knowledge found in the knowledge base.");
  }

  // Sentence 3: knowledge gaps (optional)
  let s3 = "";
  if (knowledge_gaps.length > 0) {
    const titles = knowledge_gaps
      .slice(0, 2)
      .map((g) => g.suggested_title || g.gap_type)
      .filter(Boolean)
      .join(" and ");
    if (titles) s3 = `Missing information about: ${titles}.`;
  }

  return [s1, ...parts, s3].filter(Boolean).join(" ");
}

function parseDiagnostic(logs) {
  const find = (stepName) => logs.findLast((l) => l.step_name === stepName);

  const intentLog       = find("draft_intent_assessed");
  const contextLog      = find("draft_context_loaded");
  const retrievalLog    = find("retrieval_completed");
  const gapLog          = find("knowledge_gap_detected");

  const intentDetail    = safeParseJson(intentLog?.step_detail);
  const contextDetail   = safeParseJson(contextLog?.step_detail);
  const retrievalDetail = safeParseJson(retrievalLog?.step_detail);
  const gapDetail       = safeParseJson(gapLog?.step_detail);

  const intent          = intentDetail?.primary_intent ?? null;
  const confidence      = typeof intentDetail?.confidence === "number" ? intentDetail.confidence : null;
  const orderNumber     = contextDetail?.order_number ?? null;
  const kb_chunks       = retrievalDetail?.kb_chunks ?? [];
  const ticket_examples = retrievalDetail?.ticket_examples ?? [];
  const knowledge_gaps  = gapDetail?.gaps ?? [];

  const reasoning = buildReasoning(intent, confidence, orderNumber, kb_chunks, knowledge_gaps);

  return { reasoning, intent, confidence, orderNumber, kb_chunks, ticket_examples, knowledge_gaps };
}

const THREAD_SCOPED_STEP_NAMES = [
  "draft_intent_assessed",
  "draft_context_loaded",
  "retrieval_completed",
  "knowledge_gap_detected",
  "draft_created",
  "postmark_inbound_draft_created",
  "draft_edit_feedback_captured",
  "send_smtp_success",
  "send_smtp_fail",
  "send_reply_failed",
  "email_simulated_test_mode",
  "action_feedback_captured",
  "shopify_action",
  "shopify_action_failed",
  "shopify_action_applied",
  "shopify_action_declined",
  "shopify_action_blocked",
  "shopify_action_approved_test_mode",
  "forward_email_applied",
  "forward_email_failed",
  "carrier_tracking",
  "Carrier Tracking",
  "Shopify Lookup",
  "Shopify Action",
  "Product Search",
  "Context",
];

export async function GET(_request, { params }) {
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

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve user scope." }, { status: 401 });
  }

  let threadQuery = serviceClient
    .from("mail_threads")
    .select("id, provider_thread_id, workspace_id")
    .eq("id", threadId);
  threadQuery = applyScope(threadQuery, scope);
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const threadKeys = [thread.id, thread.provider_thread_id].filter(Boolean).map(String);
  const threadKeySet = new Set(threadKeys);

  let draftIdRows = [];
  if (threadKeys.length) {
    let draftsQuery = serviceClient
      .from("drafts")
      .select("draft_id")
      .in("thread_id", threadKeys)
      .order("created_at", { ascending: false })
      .limit(100);
    draftsQuery = applyScope(draftsQuery, scope, {
      workspaceColumn: "workspace_id",
      userColumn: null,
    });
    const { data: draftsData } = await draftsQuery;
    draftIdRows = Array.isArray(draftsData) ? draftsData : [];
  }
  const draftIds = draftIdRows.map((row) => row?.draft_id).filter(Boolean);

  let draftLogs = [];
  if (draftIds.length) {
    const { data } = await serviceClient
      .from("agent_logs")
      .select("id, draft_id, step_name, step_detail, status, created_at")
      .in("draft_id", draftIds)
      .order("created_at", { ascending: false })
      .limit(300);
    draftLogs = Array.isArray(data) ? data : [];
  }

  let threadScopedQuery = serviceClient
    .from("agent_logs")
    .select("id, draft_id, step_name, step_detail, status, created_at")
    .in("step_name", THREAD_SCOPED_STEP_NAMES)
    .order("created_at", { ascending: false })
    .limit(800);
  if (thread.workspace_id) {
    threadScopedQuery = threadScopedQuery.eq("workspace_id", thread.workspace_id);
  }
  const { data: threadScopedLogsRaw } = await threadScopedQuery;
  const threadScopedLogs = (Array.isArray(threadScopedLogsRaw) ? threadScopedLogsRaw : []).filter((row) => {
    const parsedThreadId = extractThreadIdFromDetail(row?.step_detail);
    return parsedThreadId ? threadKeySet.has(String(parsedThreadId)) : false;
  });

  const { data: actionLogsRaw } = await serviceClient
    .from("agent_logs")
    .select("id, draft_id, step_name, step_detail, status, created_at")
    .in("step_name", [
      "shopify_action",
      "shopify_action_failed",
      "shopify_action_applied",
      "shopify_action_declined",
      "shopify_action_blocked",
    ])
    .order("created_at", { ascending: false })
    .limit(400);
  const actionLogs = (Array.isArray(actionLogsRaw) ? actionLogsRaw : []).filter((row) => {
    const parsedThreadId = extractThreadIdFromDetail(row?.step_detail);
    return parsedThreadId ? threadKeySet.has(String(parsedThreadId)) : false;
  });

  let threadActionsQuery = serviceClient
    .from("thread_actions")
    .select("id, action_type, status, detail, payload, created_at, updated_at, thread_id")
    .eq("thread_id", thread.id)
    .order("updated_at", { ascending: false })
    .limit(100);
  threadActionsQuery = applyScope(threadActionsQuery, scope);
  const { data: threadActionsRaw } = await threadActionsQuery;
  const threadActionLogs = (Array.isArray(threadActionsRaw) ? threadActionsRaw : []).map((row) => {
    const normalizedStatus = String(row?.status || "").trim().toLowerCase();
    const stepName = normalizedStatus
      ? `thread_action_${normalizedStatus}`
      : "thread_action_pending";
    const stepDetail = JSON.stringify({
      detail:
        (typeof row?.detail === "string" && row.detail.trim()) ||
        "Order action requires review.",
      action: row?.action_type || null,
      thread_id: row?.thread_id || thread.id,
      payload: row?.payload && typeof row.payload === "object" ? row.payload : {},
    });
    return {
      id: `thread_action_${row?.id}`,
      draft_id: null,
      step_name: stepName,
      step_detail: stepDetail,
      status: normalizedStatus || "pending",
      created_at: row?.updated_at || row?.created_at || new Date().toISOString(),
    };
  });

  const mergedById = new Map();
  for (const row of [...draftLogs, ...threadScopedLogs, ...actionLogs, ...threadActionLogs]) {
    if (!row?.id) continue;
    mergedById.set(String(row.id), row);
  }
  const logs = Array.from(mergedById.values()).sort((a, b) => {
    const aTs = Date.parse(a?.created_at || 0);
    const bTs = Date.parse(b?.created_at || 0);
    return (Number.isFinite(aTs) ? aTs : 0) - (Number.isFinite(bTs) ? bTs : 0);
  });

  const diagnostic = parseDiagnostic(logs);
  return NextResponse.json({ logs, diagnostic }, { status: 200 });
}
