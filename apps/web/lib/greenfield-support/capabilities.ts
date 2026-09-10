import { GREENFIELD_TOOL_DEFINITIONS, isExplicitAddressChangeRequest, parseToolArguments } from "./tool-contracts";
import { validateActionProposal } from "./action-executor";
import { structuredKnowledgeData } from "./knowledge";
import type {
  CapabilityManifest,
  CommerceReadProvider,
  ConversationContext,
  FulfillmentItemSnapshot,
  FulfillmentSnapshot,
  JsonObject,
  JsonValue,
  LiveTrackingProvider,
  KnowledgeStore,
  OrderSnapshot,
  ProposedAction,
  TenantContext,
  ToolExecutionResult,
} from "./types";

export interface CapabilityContext {
  tenant: TenantContext;
  knowledge: KnowledgeStore;
  commerce: CommerceReadProvider;
  tracking?: LiveTrackingProvider;
  /** Server-owned current customer wording; never supplied by the model. */
  customerMessage?: string;
  /** Explicit order references extracted from the current customer request. */
  orderReferences?: string[];
  /** Trusted server-owned continuity state; never supplied by the model. */
  conversationContext?: ConversationContext;
  now?: () => string;
}

interface RequestOrderFocus {
  requestedOrderId: string;
  state: "unresolved" | "verified";
  order: OrderSnapshot | null;
}

function stringArg(args: JsonObject, key: string): string {
  return String(args[key] ?? "").trim();
}

function normalizeOrderReference(value: unknown): string {
  return String(value ?? "").trim().replace(/^#/, "").toLowerCase();
}

function sameOrderReference(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeOrderReference(left);
  const normalizedRight = normalizeOrderReference(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

/** Extracts generic explicit order references from the current customer message. */
export function extractOrderReferences(message: string): string[] {
  const references = new Set<string>();
  const source = String(message ?? "");
  const patterns = [
    /\b(?:order|ordre)\s*(?:number|no\.?|nr\.?)?\s*#\s*([a-z0-9][a-z0-9_-]{0,79})\b/gi,
    /\b(?:order|ordre)\s+(?:number|no\.?|nr\.?)?\s*([0-9][a-z0-9_-]{0,79})\b/gi,
    /#([a-z0-9][a-z0-9_-]{0,79})\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of Array.from(source.matchAll(pattern))) {
      const reference = normalizeOrderReference(match[1]);
      if (reference) references.add(reference);
    }
  }
  return Array.from(references);
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function removeUnsupportedProductFields(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(removeUnsupportedProductFields);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/(?:inventory|stock|available)/i.test(key))
        .map(([key, child]) => [key, removeUnsupportedProductFields(child)]),
    );
  }
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function providerStatus(value: JsonValue): "ok" | "not_found" | "unavailable" {
  if (value && typeof value === "object" && !Array.isArray(value) && value.status === "not_found") return "not_found";
  if (value && typeof value === "object" && !Array.isArray(value) && value.status === "unavailable") return "unavailable";
  return "ok";
}

function availabilityProviderStatus(value: JsonValue): "ok" | "not_found" | "invalid_request" | "unavailable" {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "ok";
  if (value.status === "not_found") return "not_found";
  if (value.status === "ambiguous") return "invalid_request";
  if (value.status === "unavailable") return "unavailable";
  return "ok";
}

function knowledgeResult(result: Awaited<ReturnType<KnowledgeStore["search"]>>, query: string): ToolExecutionResult {
  const procedural = result.some(({ record }) => record.knowledgeType === "procedural");
  const procedureHit = result.find(({ record }) => record.knowledgeType === "procedural");
  const taskSpecificity = procedural
    ? procedureHit?.taskSpecificity
      ?? (result.some(({ taskTitleMatches = 0 }) => taskTitleMatches > 0) ? "sufficient" : "insufficient")
    : "not_applicable";
  const procedureCandidates = procedureHit?.procedureCandidates ?? [];
  return {
    status: result.length ? "ok" : "not_found",
    data: {
      query,
      task_specificity: taskSpecificity,
      ...(procedural && taskSpecificity === "insufficient" && procedureCandidates.length
        ? { possible_tasks: procedureCandidates.map(({ taskKey, title }) => ({ task_key: taskKey, title })) }
        : {}),
      results: result.map(({ record, score, taskRelevance = 0, taskTitleMatches = 0, taskBodyMatches = 0, matchReason, rank, evidenceSections }, index) => ({
        title: record.title,
        knowledge_type: record.knowledgeType,
        authority: record.authority,
        score: Number(score.toFixed(4)),
        task_relevance_score: Number(taskRelevance.toFixed(4)),
        task_title_matches: taskTitleMatches,
        task_body_matches: taskBodyMatches,
        rank: rank ?? index + 1,
        match_reason: matchReason,
        evidence_sections: (evidenceSections ?? []).map((section) => ({
          heading: section.heading,
          content: section.content,
          chunk_ids: section.chunkIds,
        })),
        provenance: {
          source_kind: record.sourceKind,
          source_id: record.sourceId,
          source_label: record.sourceLabel,
          source_uri: record.sourceUri,
          published_at: record.publishedAt,
          observed_at: record.observedAt,
          expires_at: record.expiresAt,
        },
        structured_data: taskSpecificity === "insufficient" && record.knowledgeType === "procedural"
          ? { task_candidate_only: true, task_key: record.taskKey, task_title: record.title }
          : structuredKnowledgeData(record),
        ...(taskSpecificity === "insufficient" && record.knowledgeType === "procedural" ? { evidence_sections: [] } : {}),
      })),
    },
  };
}

function normalizeTrackingNumber(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function verifiedTrackingSource(orders: Awaited<ReturnType<CommerceReadProvider["getOrderHistory"]>>, trackingNumber: string) {
  const wanted = normalizeTrackingNumber(trackingNumber);
  for (const order of orders) {
    for (const fulfillment of order.fulfillments ?? []) {
      if (normalizeTrackingNumber(fulfillment.trackingNumber) !== wanted) continue;
      return {
        source: "shopify_order_fulfillment" as const,
        order_id: order.id,
        order_number: order.orderNumber,
        fulfillment_id: fulfillment.id,
        carrier: fulfillment.carrier ?? null,
        tracking_url: fulfillment.trackingUrl ?? null,
      };
    }
  }
  return null;
}

function orderFocusData(focus: RequestOrderFocus | null) {
  if (!focus) return { state: "unbound" as const };
  return {
    state: focus.state,
    requested_order_id: focus.requestedOrderId,
    verified_order_id: focus.order?.id ?? null,
    verified_order_number: focus.order?.orderNumber ?? null,
  };
}

function orderFocusConflict(context: CapabilityContext, focus: RequestOrderFocus | null, orderId: string): ToolExecutionResult | null {
  if (!focus || sameOrderReference(focus.requestedOrderId, orderId)) return null;
  const explicitlyRequested = (context.orderReferences ?? []).some((reference) => sameOrderReference(reference, orderId));
  if (explicitlyRequested) return null;
  return {
    status: "invalid_request",
    data: jsonValue({
      requested_order_id: orderId,
      order_focus: orderFocusData(focus),
    }),
    error: {
      code: "order_focus_conflict",
      message: "This order is outside the current customer request and cannot be read without an explicit customer reference.",
    },
  };
}

function orderFromFulfillmentResult(value: JsonValue, fallbackOrderId: string): OrderSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const orderId = String(value.order_id ?? value.orderId ?? fallbackOrderId).trim();
  const orderNumber = String(value.order_number ?? value.orderNumber ?? fallbackOrderId).trim();
  if (!orderId || !orderNumber || !Array.isArray(value.fulfillments)) return null;
  const fulfillments: FulfillmentSnapshot[] = value.fulfillments
    .filter((item): item is JsonObject => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => {
      const items: FulfillmentItemSnapshot[] = Array.isArray(item.items)
        ? item.items
          .filter((child): child is JsonObject => Boolean(child && typeof child === "object" && !Array.isArray(child)))
          .map((child) => ({
            orderLineItemId: String(child.orderLineItemId ?? child.order_line_item_id ?? "").trim(),
            variantId: child.variantId == null && child.variant_id == null ? null : String(child.variantId ?? child.variant_id),
            title: String(child.title ?? "").trim(),
            quantity: Number(child.quantity ?? 0),
            orderedQuantity: child.orderedQuantity == null && child.ordered_quantity == null ? null : Number(child.orderedQuantity ?? child.ordered_quantity),
            fulfilledQuantity: child.fulfilledQuantity == null && child.fulfilled_quantity == null ? null : Number(child.fulfilledQuantity ?? child.fulfilled_quantity),
          }))
          .filter((child) => child.orderLineItemId && child.title && Number.isFinite(child.quantity))
        : [];
      return {
        id: String(item.id ?? "").trim(),
        status: item.status == null ? null : String(item.status),
        carrier: item.carrier == null ? null : String(item.carrier),
        trackingNumber: item.tracking_number == null && item.trackingNumber == null
          ? null
          : String(item.tracking_number ?? item.trackingNumber),
        trackingUrl: item.tracking_url == null && item.trackingUrl == null
          ? null
          : String(item.tracking_url ?? item.trackingUrl),
        shipmentStatus: item.shipment_status == null && item.shipmentStatus == null
          ? null
          : String(item.shipment_status ?? item.shipmentStatus),
        items,
        itemMappingStatus: item.item_mapping_status === "verified" || item.itemMappingStatus === "verified" ? "verified" : "unavailable",
      } satisfies FulfillmentSnapshot;
    })
    .filter((item) => item.id);
  return {
    id: orderId,
    orderNumber,
    status: "unknown",
    fulfillmentStatus: value.fulfillment_status == null && value.fulfillmentStatus == null
      ? null
      : String(value.fulfillment_status ?? value.fulfillmentStatus),
    items: Array.isArray(value.items)
      ? value.items
        .filter((item): item is JsonObject => Boolean(item && typeof item === "object" && !Array.isArray(item)))
        .map((item) => ({ id: String(item.id ?? "").trim(), title: String(item.title ?? "").trim(), quantity: Number(item.quantity ?? 0), variantId: item.variantId == null && item.variant_id == null ? null : String(item.variantId ?? item.variant_id) }))
        .filter((item) => item.id && item.title && Number.isFinite(item.quantity))
      : [],
    fulfillments,
  };
}

function proposedAction(name: ProposedAction["action"], args: JsonObject, reason: string): ToolExecutionResult {
  return {
    status: "proposed",
    proposedAction: {
      action: name,
      arguments: args,
      reason,
      requiresConfirmation: true,
      status: "proposed",
    },
  };
}

function validatedProposedAction(
  name: ProposedAction["action"],
  args: JsonObject,
  reason: string,
  context: CapabilityContext,
  manifest: CapabilityManifest,
  orderFocus: RequestOrderFocus | null,
): ToolExecutionResult {
  const proposal = {
    action: name,
    arguments: args,
    reason,
    requiresConfirmation: true as const,
    status: "proposed" as const,
  } satisfies ProposedAction;
  const validation = validateActionProposal(proposal, {
    tenant: context.tenant,
    manifest,
    activeOrder: orderFocus,
    verifiedWorkspaceId: context.tenant.workspaceId,
  });
  if (!validation.valid) {
    return {
      status: "invalid_request",
      data: jsonValue({ action_validation: validation }),
      error: { code: "action_not_validated", message: validation.reason },
    };
  }
  return proposedAction(name, args, reason);
}

function buildCapabilityManifest(context: CapabilityContext): CapabilityManifest {
  return {
    readTools: GREENFIELD_TOOL_DEFINITIONS
      .filter((definition) => definition.sensitivity === "read_only")
      .map((definition) => definition.name),
    proposalOnlyTools: GREENFIELD_TOOL_DEFINITIONS
      .filter((definition) => definition.sensitivity === "proposed_action")
      .map((definition) => definition.name),
    configured: {
      knowledge: Boolean(context.knowledge),
      commerce: Boolean(context.commerce),
      tracking: Boolean(context.tracking),
    },
  };
}

function searchKnowledge(
  context: CapabilityContext,
  query: string,
  knowledgeTypes: Parameters<KnowledgeStore["search"]>[0]["knowledgeTypes"],
  limit: number,
) {
  const customerProvided = context.conversationContext?.customerProvided;
  const continuityTerms = knowledgeTypes?.includes("product")
    ? [customerProvided?.product, customerProvided?.variant, customerProvided?.platform]
    : knowledgeTypes?.includes("procedural")
      ? [customerProvided?.product, customerProvided?.variant, customerProvided?.platform, customerProvided?.issue, ...(customerProvided?.attemptedSteps ?? [])]
      : [];
  const normalizedQuery = query.toLowerCase();
  const contextualQuery = [query, ...continuityTerms.filter((term) => term && !normalizedQuery.includes(term.toLowerCase()))]
    .filter(Boolean)
    .join(" ");
  return context.knowledge.search({
    workspaceId: context.tenant.workspaceId,
    trustedShopId: context.tenant.shopId ?? null,
    query: contextualQuery,
    taskQuery: context.customerMessage || customerProvided?.issue || query,
    knowledgeTypes,
    limit,
  });
}

function productLookupQuery(context: CapabilityContext, query: string): string {
  const product = context.conversationContext?.customerProvided?.product;
  const variant = context.conversationContext?.customerProvided?.variant;
  const normalizedQuery = query.toLowerCase();
  const contextTerms = [product, variant]
    .filter((term) => term && !normalizedQuery.includes(term.toLowerCase()));
  // Keep the current tool argument as the authoritative lookup text. Context
  // may add missing entity terms, but must never filter the argument itself
  // away when it already contains those terms.
  return [query, ...contextTerms].filter(Boolean).join(" ");
}

export function createCapabilityRegistry(context: CapabilityContext) {
  if (!context?.tenant?.workspaceId) throw new Error("Trusted workspace context is required.");

  const initialOrderReferences = context.orderReferences ?? [];
  const persistedOrder = context.conversationContext?.activeOrder ?? null;
  const persistedMatchesCurrent = persistedOrder && initialOrderReferences.length === 1
    ? sameOrderReference(persistedOrder.requestedOrderId, initialOrderReferences[0])
    : false;
  let orderFocus: RequestOrderFocus | null = initialOrderReferences.length === 1
    ? persistedMatchesCurrent && persistedOrder.state === "verified"
      ? { requestedOrderId: initialOrderReferences[0], state: "verified", order: persistedOrder.order }
      : { requestedOrderId: initialOrderReferences[0], state: "unresolved", order: null }
    : persistedOrder
      ? { requestedOrderId: persistedOrder.requestedOrderId, state: persistedOrder.state, order: persistedOrder.order }
      : null;
  const manifest = buildCapabilityManifest(context);
  let resultSequence = 0;
  const resultRecords = new Map<string, { resultId: string; toolName: string; result: ToolExecutionResult }>();
  const recordResult = (toolName: string, result: ToolExecutionResult): ToolExecutionResult => {
    const resultId = `tool_result_${++resultSequence}`;
    const recorded = { ...result, resultId };
    resultRecords.set(resultId, { resultId, toolName, result: recorded });
    return recorded;
  };

  return {
    definitions: GREENFIELD_TOOL_DEFINITIONS,
    manifest,
    getResult(resultId: string) {
      return resultRecords.get(resultId);
    },
    getResults() {
      return Array.from(resultRecords.values());
    },
    getActiveOrderFocus() {
      if (!orderFocus) return null;
      return {
        requestedOrderId: orderFocus.requestedOrderId,
        state: orderFocus.state,
        order: orderFocus.order,
      } satisfies ConversationContext["activeOrder"];
    },
    async execute(toolName: string, rawArguments: string): Promise<ToolExecutionResult> {
      const parsed = parseToolArguments(toolName, rawArguments);
      if (parsed.ok === false) return recordResult(toolName, parsed.result);
      const args = parsed.value;
      const query = stringArg(args, "query");
      try {
        const result = await (async (): Promise<ToolExecutionResult> => {
          switch (toolName) {
          case "search_policy":
            return knowledgeResult(await searchKnowledge(context, query, ["policy"], 5), query);
          case "search_product_knowledge":
            return knowledgeResult(await searchKnowledge(context, query, ["product"], 5), query);
          case "search_historical_cases":
            return knowledgeResult(await searchKnowledge(context, query, ["historic_support"], 3), query);
          case "get_brand_guidance":
            return knowledgeResult(await searchKnowledge(context, query, ["brand"], 3), query);
          case "search_procedures":
            return knowledgeResult(await searchKnowledge(context, query, ["procedural"], 5), query);
          case "get_order": {
            if (!context.tenant.customerEmail) {
              return { status: "missing_context", error: { code: "customer_identity_missing", message: "A verified customer identity is required before reading order data." } };
            }
            const orderId = stringArg(args, "order_id");
            const conflict = orderFocusConflict(context, orderFocus, orderId);
            if (conflict) return conflict;
            if (!orderFocus || !sameOrderReference(orderFocus.requestedOrderId, orderId)) {
              orderFocus = { requestedOrderId: orderId, state: "unresolved", order: null };
            }
            const order = await context.commerce.getOrder(orderId);
            if (!order) {
              orderFocus = { ...orderFocus, state: "unresolved", order: null };
              return { status: "not_found", data: jsonValue({ order_id: orderId, order_focus: orderFocusData(orderFocus) }) };
            }
            orderFocus = { requestedOrderId: orderId, state: "verified", order };
            return { status: "ok", data: jsonValue({ ...order, order_focus: orderFocusData(orderFocus) }) };
          }
          case "get_order_history": {
            if (!context.tenant.customerEmail) return { status: "missing_context", error: { code: "customer_identity_missing", message: "The current customer's verified email is not available." } };
            const orders = await context.commerce.getOrderHistory(context.tenant.customerEmail);
            if (orderFocus?.state === "unresolved") {
              return {
                status: orders.length ? "ok" : "not_found",
                data: jsonValue({
                  candidate_only: true,
                  has_order_history: orders.length > 0,
                  order_focus: orderFocusData(orderFocus),
                }),
              };
            }
            return { status: orders.length ? "ok" : "not_found", data: jsonValue({ orders }) };
          }
          case "get_customer": {
            const customer = await context.commerce.getCustomer();
            return customer ? { status: "ok", data: jsonValue(customer) } : { status: "not_found" };
          }
          case "get_product": {
            const product = removeUnsupportedProductFields(await context.commerce.getProduct(productLookupQuery(context, query)));
            return { status: providerStatus(product), data: product };
          }
          case "get_product_availability": {
            const availability = jsonValue(await context.commerce.getProductAvailability(productLookupQuery(context, query)));
            return { status: availabilityProviderStatus(availability), data: availability };
          }
          case "inspect_fulfillment":
            if (!context.tenant.customerEmail) {
              return { status: "missing_context", error: { code: "customer_identity_missing", message: "A verified customer identity is required before reading fulfillment data." } };
            }
            {
              const orderId = stringArg(args, "order_id");
              const conflict = orderFocusConflict(context, orderFocus, orderId);
              if (conflict) return conflict;
              if (!orderFocus || !sameOrderReference(orderFocus.requestedOrderId, orderId)) {
                orderFocus = { requestedOrderId: orderId, state: "unresolved", order: null };
              }
              const fulfillment = jsonValue(await context.commerce.inspectFulfillment(orderId));
              const inspectedOrder = orderFromFulfillmentResult(fulfillment, orderId);
              orderFocus = {
                ...orderFocus,
                state: inspectedOrder ? "verified" : "unresolved",
                order: inspectedOrder,
              };
              return { status: providerStatus(fulfillment), data: fulfillment };
            }
          case "get_tracking": {
            if (!context.tenant.customerEmail) {
              return { status: "missing_context", error: { code: "customer_identity_missing", message: "A verified customer identity is required before reading tracking data." } };
            }
            const trackingNumber = stringArg(args, "tracking_number");
            if (!trackingNumber) {
              return { status: "invalid_request", error: { code: "tracking_number_required", message: "A tracking number is required." } };
            }
            if (orderFocus?.state === "unresolved") {
              return {
                status: "invalid_request",
                data: jsonValue({ tracking_number: trackingNumber, order_focus: orderFocusData(orderFocus) }),
                error: {
                  code: "tracking_order_unresolved",
                  message: "Tracking cannot be read until the requested order is verified.",
                },
              };
            }
            let orders: OrderSnapshot[];
            if (orderFocus?.state === "verified") {
              if (!orderFocus.order) {
                return {
                  status: "invalid_request",
                  data: jsonValue({ tracking_number: trackingNumber, order_focus: orderFocusData(orderFocus) }),
                  error: {
                    code: "tracking_order_details_required",
                    message: "Read the verified order details before reading its tracking.",
                  },
                };
              }
              orders = [orderFocus.order];
            } else {
              orders = await context.commerce.getOrderHistory(context.tenant.customerEmail);
            }
            const source = verifiedTrackingSource(orders, trackingNumber);
            if (!source) {
              return {
                status: "not_found",
                data: jsonValue({ tracking_number: trackingNumber, tracking_verification: "not_found", order_focus: orderFocusData(orderFocus) }),
              };
            }
            const sourceOrder = orders.find((order) => order.id === source.order_id) ?? null;
            if (!orderFocus) {
              orderFocus = { requestedOrderId: source.order_number, state: "verified", order: sourceOrder };
            }
            if (!context.tracking) {
              return { status: "unavailable", error: { code: "tracking_provider_unavailable", message: "Live tracking is not configured for this runtime." } };
            }
            const liveResult = await context.tracking.lookup({
              trackingNumber,
              carrierHint: source.carrier,
              trackingUrl: source.tracking_url,
              provenance: {
                source: "shopify_order_fulfillment",
                workspaceId: context.tenant.workspaceId,
                orderId: source.order_id,
                orderNumber: source.order_number,
                fulfillmentId: source.fulfillment_id,
              },
            });
            const verified = { tracking_identifier: source, order_focus: orderFocusData(orderFocus) };
            if (liveResult.status !== "ok") {
              return { status: liveResult.status, data: jsonValue(verified), error: liveResult.error };
            }
            return { status: "ok", data: jsonValue({ ...verified, live_tracking: liveResult.data }) };
          }
          case "cancel_order":
            return validatedProposedAction("cancel_order", args, stringArg(args, "reason"), context, manifest, orderFocus);
          case "update_address":
            if (context.customerMessage?.trim() && !isExplicitAddressChangeRequest(context.customerMessage)) {
              return {
                status: "invalid_request",
                error: {
                  code: "address_change_request_required",
                  message: "An address proposal requires an explicit request to change the existing order address.",
                },
              };
            }
            return validatedProposedAction("update_address", args, stringArg(args, "reason"), context, manifest, orderFocus);
          case "create_return":
            return validatedProposedAction("create_return", args, stringArg(args, "reason"), context, manifest, orderFocus);
          case "create_refund":
            return validatedProposedAction("create_refund", args, stringArg(args, "reason"), context, manifest, orderFocus);
          case "send_replacement":
            return validatedProposedAction("send_replacement", args, stringArg(args, "reason"), context, manifest, orderFocus);
          default:
            return { status: "invalid_arguments", error: { code: "unknown_tool", message: `Unknown capability: ${toolName}` } };
          }
        })();
        return recordResult(toolName, result);
      } catch (error) {
        return recordResult(toolName, {
          status: "error",
          error: {
            code: "capability_failed",
            message: error instanceof Error ? error.message : "Capability failed.",
          },
        });
      }
    },
  };
}
