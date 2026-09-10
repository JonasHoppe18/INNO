import { normalizeCustomerProvidedContext } from "../greenfield-support/conversation-context";

const MAX_MESSAGE_LENGTH = 12_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_TRACE_STRING_LENGTH = 420;
const MAX_EVIDENCE_SECTIONS = 2;
const GREENFIELD_DEV_SUPABASE_PROJECT_REF = "zxaoycxzdjrbnzvbullk";

export const GREENFIELD_PLAYGROUND_MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH;
export const GREENFIELD_PLAYGROUND_HISTORY_LIMIT = MAX_HISTORY_MESSAGES;

function supabaseProjectRef(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const hostname = new URL(raw).hostname.toLowerCase();
    const match = hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

export function greenfieldPlaygroundEnvironment(env = process.env) {
  return env.NODE_ENV === "production" ? "production" : "development";
}

export function isGreenfieldPlaygroundEnabled(env = process.env) {
  if (env.GREENFIELD_PLAYGROUND_DISABLED === "true") return false;

  const environment = greenfieldPlaygroundEnvironment(env);
  const actualProjectRef = supabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL);
  const configuredProjectRef = String(env.GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF || "").trim();

  if (configuredProjectRef && actualProjectRef !== configuredProjectRef) return false;
  if (environment !== "production") return env.GREENFIELD_PLAYGROUND_ENABLED !== "false";

  return (
    env.GREENFIELD_PLAYGROUND_ENABLED === "true" &&
    env.GREENFIELD_PLAYGROUND_ENVIRONMENT === "production" &&
    Boolean(configuredProjectRef) &&
    actualProjectRef === configuredProjectRef
  );
}

export function isGreenfieldPlaygroundProduction(env = process.env) {
  return greenfieldPlaygroundEnvironment(env) === "production";
}

export function isGreenfieldPlaygroundFreeformEnabled(env = process.env) {
  if (!isGreenfieldPlaygroundProduction(env)) return true;
  if (env.GREENFIELD_PLAYGROUND_ALLOW_FREEFORM !== "true") return false;

  const actualProjectRef = supabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL);
  const configuredProjectRef = String(env.GREENFIELD_PLAYGROUND_SUPABASE_PROJECT_REF || "").trim();
  return actualProjectRef === GREENFIELD_DEV_SUPABASE_PROJECT_REF && configuredProjectRef === GREENFIELD_DEV_SUPABASE_PROJECT_REF;
}

export function isGreenfieldPlaygroundTicketRequired(env = process.env) {
  return !isGreenfieldPlaygroundFreeformEnabled(env);
}

export async function isInternalGreenfieldPlaygroundUser(serviceClient, { workspaceId, clerkUserId } = {}) {
  if (!serviceClient || !workspaceId || !clerkUserId) return false;
  const { data, error } = await serviceClient
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const role = String(data?.role || "").toLowerCase();
  return role.includes("admin") || role.includes("owner");
}

export function normalizePlaygroundMessage(value) {
  const message = String(value ?? "").trim();
  if (!message) return { value: "", error: "message is required." };
  if (message.length > MAX_MESSAGE_LENGTH) return { value: "", error: "message is too long." };
  return { value: message, error: null };
}

export function normalizePlaygroundCustomerEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return { value: null, error: null };
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { value: null, error: "Enter a valid test customer email or leave it blank." };
  }
  return { value: email, error: null };
}

export function normalizePlaygroundCustomerName(value) {
  const firstName = String(value ?? "").trim().replace(/\s+/g, " ").split(" ")[0] ?? "";
  return /^[\p{L}][\p{L}'’-]{0,39}$/u.test(firstName) ? firstName : null;
}

export function isOwnedPlaygroundSession(session, { workspaceId, clerkUserId } = {}) {
  return Boolean(
    session &&
      String(session.workspace_id || "") === String(workspaceId || "") &&
      String(session.owner_clerk_user_id || "") === String(clerkUserId || ""),
  );
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value, limit = MAX_TRACE_STRING_LENGTH) {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function redactedText(value) {
  return text(value)
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/((?:access[_-]?token|api[_-]?key|client[_-]?secret|password|secret|authorization|cookie)\s*[:=]\s*)[^\s,;}]+/gi, "$1[redacted]");
}

function safeContext(value) {
  if (!isRecord(value)) return null;
  const activeOrder = isRecord(value.activeOrder) ? value.activeOrder : null;
  const order = activeOrder && isRecord(activeOrder.order) ? activeOrder.order : null;
  const customerProvided = normalizeCustomerProvidedContext(value.customerProvided);
  return {
    turn: Number.isSafeInteger(value.turn) ? value.turn : 0,
    active_order: activeOrder
      ? {
          requested_order_id: text(activeOrder.requestedOrderId, 80),
          state: activeOrder.state === "verified" ? "verified" : "unresolved",
          verified_order_number: order ? text(order.orderNumber, 80) || null : null,
        }
      : null,
    customer_signal: value.customerSignal === "resolution" ? "resolution" : null,
    customer_provided: customerProvided ?? null,
  };
}

export function normalizePlaygroundContext(value) {
  const context = safeContext(value);
  if (!context || !Number.isSafeInteger(context.turn) || context.turn < 0) return null;
  return {
    turn: context.turn,
    activeOrder: context.active_order
      ? {
          requestedOrderId: context.active_order.requested_order_id,
          state: context.active_order.state,
          order: null,
        }
      : null,
    customerSignal: context.customer_signal,
    ...(context.customer_provided ? { customerProvided: context.customer_provided } : {}),
  };
}

export function historyFromPlaygroundRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => (
      (row?.role === "user" || row?.role === "assistant") &&
      typeof row?.content === "string" &&
      row?.trace_json?.comparison_only !== true
    ))
    .slice(-MAX_HISTORY_MESSAGES)
    .map((row) => ({ role: row.role, content: row.content.slice(0, MAX_MESSAGE_LENGTH) }));
}

function parseArguments(value) {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeToolArguments(value) {
  const args = parseArguments(value);
  return Object.fromEntries(
    Object.entries(args)
      .filter(([key]) => !/(token|secret|password|authorization|cookie|credential|api[_-]?key)/i.test(key))
      .map(([key, entry]) => [key, typeof entry === "string" ? redactedText(entry) : entry]),
  );
}

function sourceFromResult(result) {
  const data = result?.data;
  if (!isRecord(data) || !Array.isArray(data.results)) return [];
  return data.results
    .slice(0, 5)
    .map((item) => {
      const provenance = isRecord(item?.provenance) ? item.provenance : {};
      return {
        title: text(item?.title, 180),
        knowledge_type: text(item?.knowledge_type, 40),
        authority: text(item?.authority, 40),
        score: typeof item?.score === "number" ? item.score : null,
        rank: Number.isInteger(item?.rank) ? item.rank : null,
        provenance: {
          source_kind: text(provenance.source_kind, 80),
          source_id: text(provenance.source_id, 120),
          source_label: text(provenance.source_label, 180),
          source_uri: text(provenance.source_uri, 220) || null,
        },
        evidence_sections: Array.isArray(item?.evidence_sections)
          ? item.evidence_sections.slice(0, MAX_EVIDENCE_SECTIONS).map((section) => ({
              heading: text(section?.heading, 120),
              content: text(section?.content, 420),
              chunk_ids: Array.isArray(section?.chunk_ids) ? section.chunk_ids.slice(0, 6).map((id) => text(id, 100)) : [],
            }))
          : [],
      };
    });
}

function compactData(result) {
  const data = result?.data;
  if (!isRecord(data)) return null;
  const output = {};
  for (const key of [
    "query",
    "status",
    "candidate_only",
    "has_order_history",
    "selection",
    "provider",
    "source",
    "location_scope",
    "tracking_verification",
    "observed_at",
  ]) {
    if (data[key] !== undefined) output[key] = typeof data[key] === "string" ? text(data[key], 180) : data[key];
  }
  if (isRecord(data.order_focus)) output.order_focus = safeContext({ turn: 0, activeOrder: {
    requestedOrderId: data.order_focus.requested_order_id,
    state: data.order_focus.state,
    order: data.order_focus.verified_order_number ? { orderNumber: data.order_focus.verified_order_number } : null,
  } })?.active_order;
  if (Array.isArray(data.results)) output.results = sourceFromResult(result);
  if (Array.isArray(data.products)) {
    output.products = data.products.slice(0, 8).map((product) => ({
      id: text(product?.id, 120) || null,
      title: text(product?.title, 180) || null,
      handle: text(product?.handle, 180) || null,
      variants: Array.isArray(product?.variants)
        ? product.variants.slice(0, 12).map((variant) => ({
            id: text(variant?.id, 120) || null,
            title: text(variant?.title, 180) || null,
            sku: text(variant?.sku, 120) || null,
            availability_state: text(variant?.availability_state, 40) || null,
          }))
        : [],
    }));
  }
  if (isRecord(data.live_tracking)) {
    output.live_tracking = {
      provider: text(data.live_tracking.provider, 80),
      source: text(data.live_tracking.source, 120),
      status: text(data.live_tracking.status, 100),
      sub_status: text(data.live_tracking.subStatus ?? data.live_tracking.sub_status, 100),
      estimated_delivery: text(data.live_tracking.estimatedDelivery ?? data.live_tracking.estimated_delivery, 120),
      exception: text(data.live_tracking.exception, 240),
      latest_event: isRecord(data.live_tracking.latestEvent ?? data.live_tracking.latest_event)
        ? {
            description: text((data.live_tracking.latestEvent ?? data.live_tracking.latest_event).description, 240),
            timestamp: text((data.live_tracking.latestEvent ?? data.live_tracking.latest_event).timestamp, 80),
            location: text((data.live_tracking.latestEvent ?? data.live_tracking.latest_event).location, 120),
          }
        : null,
    };
  }
  return output;
}

function traceEventSummary(event) {
  const data = isRecord(event?.data) ? event.data : {};
  if (event?.type === "tool_call") {
    return {
      at: event.at,
      type: event.type,
      call_id: text(data.call_id, 100),
      name: text(data.name, 80),
      arguments: safeToolArguments(data.arguments),
    };
  }
  if (event?.type === "tool_result") {
    const result = isRecord(data.result) ? data.result : {};
    return {
      at: event.at,
      type: event.type,
      call_id: text(data.call_id, 100),
      name: text(data.name, 80),
      duration_ms: Number.isFinite(data.duration_ms) ? data.duration_ms : null,
      result: {
        result_id: text(result.resultId, 100) || null,
        status: text(result.status, 40),
        data: compactData(result),
        error: isRecord(result.error)
          ? { code: text(result.error.code, 100), message: redactedText(result.error.message) }
          : null,
        proposed_action: result.proposedAction
          ? { action: text(result.proposedAction.action, 80), status: "proposed", executed: false }
          : null,
      },
    };
  }
  if (event?.type === "model_response") {
    return {
      at: event.at,
      type: event.type,
      turn: Number.isInteger(data.turn) ? data.turn : null,
      duration_ms: Number.isFinite(data.duration_ms) ? data.duration_ms : null,
      runtime: "@openai/agents",
      item_types: Array.isArray(data.item_types) ? data.item_types.slice(0, 12).map((item) => text(item, 80)) : [],
    };
  }
  if (event?.type === "action_execution") {
    const checks = Array.isArray(data.validation_checks) ? data.validation_checks : [];
    return {
      at: event.at,
      type: event.type,
      mode: "dry_run",
      action: text(data.action, 80),
      target: { order_id: text(data.target?.order_id, 80) || null },
      arguments: safeToolArguments(data.arguments),
      proposal_status: "proposed",
      validation_status: data.validation_status === "validated" ? "validated" : "blocked",
      execution_status: data.execution_status === "dry_run_success" ? "dry_run_success" : "blocked",
      would_execute: data.would_execute === true,
      executed: false,
      validation_checks: checks.slice(0, 12).map((item) => ({
        name: text(item?.name, 80),
        status: item?.status === "passed" ? "passed" : "failed",
        detail: redactedText(item?.detail),
      })),
      reason: redactedText(data.reason),
    };
  }
  if (event?.type === "final_response") {
    const validation = isRecord(data.validation) ? data.validation : null;
    return {
      at: event.at,
      type: event.type,
      validation: validation
        ? {
            approved_segments: Number.isInteger(validation.approvedSegments) ? validation.approvedSegments : null,
            rejected_segments: Number.isInteger(validation.rejectedSegments) ? validation.rejectedSegments : null,
            valid: validation.valid === true,
          }
        : null,
      proposed_actions: Array.isArray(data.proposed_actions)
        ? data.proposed_actions.map((action) => ({ action: text(action?.action, 80), status: "proposed", executed: false })).slice(0, 8)
        : [],
    };
  }
  if (event?.type === "error") {
    return {
      at: event.at,
      type: event.type,
      code: text(data.code, 100),
      message: redactedText(data.message),
    };
  }
  return {
    at: event?.at,
    type: text(event?.type, 80),
  };
}

export function sanitizeGreenfieldTrace(trace, { contextBefore = null, contextAfter = null } = {}) {
  const events = Array.isArray(trace?.events) ? trace.events.map(traceEventSummary) : [];
  const resultEvents = events.filter((event) => event.type === "tool_result");
  const evidence = resultEvents.flatMap((event) => event.result?.data?.results || []);
  const providerResults = resultEvents
    .map((event) => ({
      tool: event.name,
      status: event.result?.status || null,
      provider: event.result?.data?.provider || event.result?.data?.source || null,
    }))
    .filter((item) => item.tool);
  const after = safeContext(contextAfter);
  const simulatedActions = events
    .filter((event) => event.type === "action_execution")
    .slice(0, 8);
  const availabilityState = resultEvents
    .flatMap((event) => event.result?.data?.products || [])
    .flatMap((product) => product.variants || [])
    .map((variant) => variant.availability_state)
    .find(Boolean) || null;
  const startedAt = Date.parse(trace?.startedAt || "");
  const finishedAt = Date.parse(trace?.finishedAt || "");
  return {
    trace_id: text(trace?.traceId, 120),
    runtime: "@openai/agents",
    started_at: trace?.startedAt || null,
    finished_at: trace?.finishedAt || null,
    latency_ms: Number.isFinite(startedAt) && Number.isFinite(finishedAt) ? Math.max(0, finishedAt - startedAt) : null,
    tools: Array.isArray(trace?.tools)
      ? trace.tools.map((tool) => ({ name: text(tool?.name, 80), sensitivity: text(tool?.sensitivity, 40) })).filter((tool) => tool.name)
      : [],
    events,
    evidence_sources: evidence.slice(0, 10),
    provider_results: providerResults,
    context_before: safeContext(contextBefore),
    context_after: after,
    order_focus: after?.active_order || null,
    availability_state: availabilityState,
    proposed_actions: Array.isArray(trace?.events)
      ? trace.events
          .filter((event) => event?.type === "tool_result" && event?.data?.result?.proposedAction)
          .map((event) => ({ action: text(event.data.result.proposedAction.action, 80), status: "proposed", executed: false }))
          .slice(0, 8)
      : [],
    simulated_actions: simulatedActions,
  };
}

export function publicPlaygroundSession(row) {
  const sourceThreadId = text(row?.conversation_context_json?.sourceThreadId, 80) || null;
  return {
    id: row.id,
    title: row.title || "New conversation",
    customer_email: row.customer_email || null,
    source_thread_id: sourceThreadId,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function publicPlaygroundMessage(row) {
  const comparisonOnly = row?.trace_json?.comparison_only === true;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    comparison_only: comparisonOnly,
    trace: row.role === "assistant" && !comparisonOnly && isRecord(row.trace_json) ? row.trace_json : null,
    created_at: row.created_at,
  };
}
