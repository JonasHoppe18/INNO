export type ExecutionState =
  | "no_action"
  | "pending_approval"
  | "validated_not_executed"
  | "executed"
  | "blocked";

export type CaseState = {
  version: 1;
  workflow: {
    category: string;
    workflow_slug: string;
    source: "thread_tags" | "latest_message_override";
  };
  execution: {
    execution_state: ExecutionState;
    approval_required_flow: boolean;
  };
  order: {
    has_selected_order: boolean;
    order_id: number | null;
    order_reference: string | null;
    matched_subject_number: string | null;
    fulfillment_status: string | null;
    financial_status: string | null;
    cancelled: boolean;
    closed: boolean;
  };
  automation: {
    order_updates: boolean;
    cancel_orders: boolean;
    automatic_refunds: boolean;
    historic_inbox_access: boolean;
  };
  policy: {
    intent: "RETURN" | "REFUND" | "WARRANTY" | "SHIPPING" | "OTHER";
    summary_included: boolean;
    excerpt_included: boolean;
  };
  return_flow: {
    is_return_intent: boolean;
    missing_details: string[];
    eligibility: "eligible" | "not_eligible" | "manual_review" | "unknown";
  };
  tracking: {
    tracking_intent: boolean;
    tracking_data_present: boolean;
  };
  confidence_signals: {
    deterministic_facts_count: number;
    inferred_signals_count: number;
    unknown_facts_count: number;
  };
};

export type BuildCaseStateInput = {
  workflowCategory: string;
  workflowSlug: string;
  workflowSource?: "thread_tags" | "latest_message_override";
  executionState: ExecutionState;
  approvalRequiredFlow: boolean;
  selectedOrder?: Record<string, unknown> | null;
  matchedSubjectNumber?: string | null;
  automation?: {
    order_updates?: boolean;
    cancel_orders?: boolean;
    automatic_refunds?: boolean;
    historic_inbox_access?: boolean;
  } | null;
  policyIntent?: "RETURN" | "REFUND" | "WARRANTY" | "SHIPPING" | "OTHER";
  policySummaryIncluded?: boolean;
  policyExcerptIncluded?: boolean;
  isReturnIntent?: boolean;
  returnDetailsMissing?: string[] | null;
  returnEligibility?: { eligible?: boolean | null } | null;
  trackingIntent?: boolean;
  trackingDataPresent?: boolean;
};

const estimateTokens = (value: string) => Math.ceil(String(value || "").length / 4);

const truncateToApproxTokens = (value: string, maxTokens: number) => {
  const text = String(value || "");
  if (maxTokens <= 0) return "";
  const approxChars = Math.max(0, Math.floor(maxTokens * 4));
  if (!approxChars || text.length <= approxChars) return text;
  return text.slice(0, approxChars).trim();
};

const asText = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
};

const asNum = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function mapEligibility(
  isReturnIntent: boolean,
  returnEligibility?: { eligible?: boolean | null } | null,
): "eligible" | "not_eligible" | "manual_review" | "unknown" {
  if (!isReturnIntent) return "unknown";
  if (!returnEligibility) return "unknown";
  if (returnEligibility.eligible === true) return "eligible";
  if (returnEligibility.eligible === false) return "not_eligible";
  return "manual_review";
}

export function buildCaseState(input: BuildCaseStateInput): CaseState {
  const selectedOrder = input.selectedOrder ?? null;
  const hasSelectedOrder = Boolean(selectedOrder);
  const eligibility = mapEligibility(
    Boolean(input.isReturnIntent),
    input.returnEligibility || null,
  );

  const deterministicFactsCount = [
    input.workflowCategory,
    input.workflowSlug,
    input.executionState,
    hasSelectedOrder ? "has_order" : "",
    input.matchedSubjectNumber || "",
    input.policyIntent || "OTHER",
  ].filter(Boolean).length;

  const inferredSignalsCount = [
    input.trackingIntent ? "tracking_intent" : "",
    input.trackingDataPresent ? "tracking_data" : "",
    eligibility !== "unknown" ? eligibility : "",
  ].filter(Boolean).length;

  const unknownFactsCount = [
    hasSelectedOrder ? "" : "missing_order",
    asText(selectedOrder?.fulfillment_status) ? "" : "missing_fulfillment_status",
    asText(selectedOrder?.financial_status) ? "" : "missing_financial_status",
  ].filter(Boolean).length;

  return {
    version: 1,
    workflow: {
      category: String(input.workflowCategory || "General"),
      workflow_slug: String(input.workflowSlug || "general"),
      source: input.workflowSource || "thread_tags",
    },
    execution: {
      execution_state: input.executionState,
      approval_required_flow: Boolean(input.approvalRequiredFlow),
    },
    order: {
      has_selected_order: hasSelectedOrder,
      order_id: asNum(selectedOrder?.id),
      order_reference:
        asText(selectedOrder?.name) ||
        asText(selectedOrder?.order_number) ||
        (asNum(selectedOrder?.id) ? String(asNum(selectedOrder?.id)) : null),
      matched_subject_number: asText(input.matchedSubjectNumber),
      fulfillment_status: asText(selectedOrder?.fulfillment_status),
      financial_status: asText(selectedOrder?.financial_status),
      cancelled: Boolean(selectedOrder?.cancelled_at),
      closed: Boolean(selectedOrder?.closed_at),
    },
    automation: {
      order_updates: Boolean(input.automation?.order_updates),
      cancel_orders: Boolean(input.automation?.cancel_orders),
      automatic_refunds: Boolean(input.automation?.automatic_refunds),
      historic_inbox_access: Boolean(input.automation?.historic_inbox_access),
    },
    policy: {
      intent: input.policyIntent || "OTHER",
      summary_included: Boolean(input.policySummaryIncluded),
      excerpt_included: Boolean(input.policyExcerptIncluded),
    },
    return_flow: {
      is_return_intent: Boolean(input.isReturnIntent),
      missing_details: Array.isArray(input.returnDetailsMissing)
        ? input.returnDetailsMissing.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
      eligibility,
    },
    tracking: {
      tracking_intent: Boolean(input.trackingIntent),
      tracking_data_present: Boolean(input.trackingDataPresent),
    },
    confidence_signals: {
      deterministic_facts_count: deterministicFactsCount,
      inferred_signals_count: inferredSignalsCount,
      unknown_facts_count: unknownFactsCount,
    },
  };
}

export function formatCaseStateForPrompt(
  state: CaseState,
  options?: { maxTokens?: number },
): string {
  const maxTokens = Math.max(120, Number(options?.maxTokens ?? 320));
  const verified = [
    `- Workflow: ${state.workflow.category} (${state.workflow.workflow_slug}) [source=${state.workflow.source}]`,
    `- Execution state: ${state.execution.execution_state}`,
    `- Approval required flow: ${state.execution.approval_required_flow ? "yes" : "no"}`,
    `- Selected order: ${state.order.has_selected_order ? "yes" : "no"}`,
    state.order.order_reference ? `- Order reference: ${state.order.order_reference}` : "",
    state.order.matched_subject_number
      ? `- Matched subject order number: #${state.order.matched_subject_number}`
      : "",
    state.order.fulfillment_status
      ? `- Fulfillment status: ${state.order.fulfillment_status}`
      : "",
    state.order.financial_status ? `- Financial status: ${state.order.financial_status}` : "",
    `- Cancelled: ${state.order.cancelled ? "yes" : "no"}`,
    `- Closed: ${state.order.closed ? "yes" : "no"}`,
    `- Policy intent: ${state.policy.intent}`,
  ].filter(Boolean);

  const inferred = [
    `- Tracking intent detected: ${state.tracking.tracking_intent ? "yes" : "no"}`,
    `- Tracking data present: ${state.tracking.tracking_data_present ? "yes" : "no"}`,
    `- Return flow intent: ${state.return_flow.is_return_intent ? "yes" : "no"}`,
    state.return_flow.is_return_intent
      ? `- Return eligibility signal: ${state.return_flow.eligibility}`
      : "",
  ].filter(Boolean);

  const unknown = [
    !state.order.has_selected_order ? "- No selected order in verified context." : "",
    state.return_flow.is_return_intent && state.return_flow.missing_details.length
      ? `- Missing return details: ${state.return_flow.missing_details.join(", ")}`
      : "",
  ].filter(Boolean);

  const lines = [
    "CASE STATE (DETERMINISTIC):",
    "Verified facts:",
    ...verified,
    "Inferred useful signals:",
    ...inferred,
    "Unknown or missing facts:",
    ...(unknown.length ? unknown : ["- none"]),
  ];
  const raw = lines.join("\n").trim();
  if (estimateTokens(raw) <= maxTokens) return raw;
  return truncateToApproxTokens(raw, maxTokens);
}

export function formatThreadHistoryForPrompt(
  history: Array<{ role: "customer" | "support"; text: string }>,
  options?: { maxMessages?: number; maxCharsPerMessage?: number; maxTokens?: number },
): string {
  const maxMessages = Math.max(1, Number(options?.maxMessages ?? 6));
  const maxCharsPerMessage = Math.max(80, Number(options?.maxCharsPerMessage ?? 240));
  const maxTokens = Math.max(120, Number(options?.maxTokens ?? 420));
  if (!Array.isArray(history) || !history.length) return "";

  const compact = history
    .slice(-maxMessages)
    .map((item) => ({
      role: item.role === "support" ? "SUPPORT" : "CUSTOMER",
      text: String(item.text || "").replace(/\s+/g, " ").trim().slice(0, maxCharsPerMessage),
    }))
    .filter((item) => item.text.length > 0);

  if (!compact.length) return "";

  const lines = [
    "RECENT THREAD HISTORY (COMPACT, oldest -> newest):",
    ...compact.map((item) => `- [${item.role}] ${item.text}`),
  ];
  const raw = lines.join("\n").trim();
  if (estimateTokens(raw) <= maxTokens) return raw;

  for (let count = compact.length - 1; count >= 1; count -= 1) {
    const reduced = [
      "RECENT THREAD HISTORY (COMPACT, oldest -> newest):",
      ...compact.slice(-count).map((item) => `- [${item.role}] ${item.text}`),
    ].join("\n").trim();
    if (estimateTokens(reduced) <= maxTokens) return reduced;
  }
  return truncateToApproxTokens(raw, maxTokens);
}
