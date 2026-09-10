export const KNOWLEDGE_TYPES = [
  "policy",
  "product",
  "live_operational",
  "historic_support",
  "brand",
  "procedural",
] as const;

export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const PRODUCT_AVAILABILITY_STATES = [
  "AVAILABLE",
  "OUT_OF_STOCK",
  "AVAILABLE_TO_ORDER",
  "NOT_TRACKED",
  "UNKNOWN",
] as const;

export type ProductAvailabilityState = (typeof PRODUCT_AVAILABILITY_STATES)[number];

export const AUTHORITY_LEVELS = [
  "authoritative",
  "operational",
  "reference",
  "example",
  "guidance",
] as const;

export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

export const PROCEDURE_BLOCK_KINDS = [
  "heading",
  "prerequisite",
  "instruction",
  "note",
  "warning",
  "condition",
  "expected_result",
  "alternative",
] as const;

export type ProcedureBlockKind = (typeof PROCEDURE_BLOCK_KINDS)[number];

export type ProcedureBlock = JsonObject & {
  block_id?: string;
  kind: ProcedureBlockKind;
  text: string;
  list_style?: "ordered" | "unordered" | null;
  source?: {
    line?: number | null;
    section?: string | null;
    excerpt?: string | null;
  } | null;
};

export interface ProcedureTask {
  key: string;
  title?: string | null;
}

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

/**
 * Trusted context is created by the server. It is deliberately not part of
 * any model-facing tool schema.
 */
export interface TenantContext {
  workspaceId: string;
  shopId?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
}

export interface KnowledgeSourceInput {
  sourceKind: string;
  sourceId: string;
  title?: string | null;
  content: string;
  sourceUri?: string | null;
  sourceLabel?: string | null;
  knowledgeType?: KnowledgeType | null;
  authority?: AuthorityLevel | null;
  structuredData?: JsonObject;
  publishedAt?: string | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  metadata?: JsonObject;
  sourceVersion?: number | null;
  sourceContentHash?: string | null;
  sourceLocation?: JsonObject | null;
  sourceRecordKey?: string | null;
  taskKey?: string | null;
  customerAliases?: string[];
}

export interface KnowledgeSourceCandidateInput {
  recordKey: string;
  title: string;
  content: string;
  knowledgeType?: KnowledgeType | null;
  authority?: AuthorityLevel | null;
  structuredData?: JsonObject;
  metadata?: JsonObject;
  sourceLocation?: JsonObject | null;
  taskKey?: string | null;
  customerAliases?: string[];
}

export interface KnowledgeSourceDocumentInput {
  sourceKind: string;
  sourceId: string;
  title?: string | null;
  content: string;
  sourceUri?: string | null;
  sourceLabel?: string | null;
  observedAt?: string | null;
  sourceVersion?: number | null;
  metadata?: JsonObject;
  candidates: KnowledgeSourceCandidateInput[];
}

export interface KnowledgeRecord {
  id: string;
  workspaceId: string;
  knowledgeType: KnowledgeType;
  authority: AuthorityLevel;
  title: string;
  content: string;
  structuredData: JsonObject;
  sourceKind: string;
  sourceId: string;
  sourceUri: string | null;
  sourceLabel: string | null;
  contentHash: string;
  publishedAt: string | null;
  observedAt: string | null;
  expiresAt: string | null;
  metadata: JsonObject;
  chunks: string[];
  sourceVersion?: number | null;
  sourceContentHash?: string | null;
  sourceLocation?: JsonObject | null;
  sourceRecordKey?: string | null;
  taskKey?: string | null;
  customerAliases?: string[];
}

export interface KnowledgeSearchRequest {
  workspaceId: string;
  query: string;
  /** Server-owned latest customer wording used for task specificity; retrieval query may be model-composed. */
  taskQuery?: string;
  knowledgeTypes?: KnowledgeType[];
  limit?: number;
  /** Server-owned shop binding used to resolve a product from the current catalog. */
  trustedShopId?: string | null;
  /** Server-owned product context; never part of a model-facing tool schema. */
  productContext?: KnowledgeProductContext | null;
}

export interface KnowledgeProductContext {
  workspaceId: string;
  productId: string;
  productModels: string[];
}

export interface KnowledgeEvidenceSection {
  heading: string;
  content: string;
  chunkIds: string[];
}

export interface KnowledgeProcedureCandidate {
  taskKey: string | null;
  title: string;
}

export interface KnowledgeHit {
  record: KnowledgeRecord;
  score: number;
  /** Bounded deterministic overlap between the request's task terms and the record title/heading/body. */
  taskRelevance?: number;
  taskTitleMatches?: number;
  taskBodyMatches?: number;
  matchReason: "lexical" | "title" | "structured" | "semantic";
  rank?: number;
  evidenceSections?: KnowledgeEvidenceSection[];
  taskSpecificity?: "sufficient" | "insufficient";
  /** Sanitized labels used only to ground a task clarification. */
  procedureCandidates?: KnowledgeProcedureCandidate[];
}

export interface KnowledgeStore {
  ingest(workspaceId: string, source: KnowledgeSourceInput): Promise<KnowledgeRecord>;
  search(request: KnowledgeSearchRequest): Promise<KnowledgeHit[]>;
}

export interface KnowledgeSourceStore {
  ingestSource(
    workspaceId: string,
    source: KnowledgeSourceDocumentInput,
  ): Promise<{ sourceId: string; sourceVersion: number; records: KnowledgeRecord[] }>;
}

/** Per-run capability truth derived from the existing tool registry and providers. */
export interface CapabilityManifest {
  readTools: string[];
  proposalOnlyTools: string[];
  configured: {
    knowledge: boolean;
    commerce: boolean;
    tracking: boolean;
  };
}

export interface OrderSnapshot {
  id: string;
  orderNumber: string;
  status: string;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  total?: string | null;
  currency?: string | null;
  items?: Array<{ id: string; title: string; quantity: number; variantId?: string | null }>;
  fulfillments?: FulfillmentSnapshot[];
}

export interface FulfillmentItemSnapshot {
  /** Stable Shopify order line-item identifier used for the join. */
  orderLineItemId: string;
  variantId?: string | null;
  title: string;
  /** Quantity in this specific fulfillment, never the full ordered quantity. */
  quantity: number;
  orderedQuantity?: number | null;
  fulfilledQuantity?: number | null;
}

export interface FulfillmentSnapshot {
  id: string;
  status?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shipmentStatus?: string | null;
  items: FulfillmentItemSnapshot[];
  itemMappingStatus: "verified" | "unavailable";
}

/**
 * Small, customer-supplied continuity hints. These are not verified commerce
 * facts and must never be used as authorization or live operational evidence.
 */
export interface CustomerProvidedContext {
  product?: string;
  variant?: string;
  platform?: string;
  issue?: string;
  returnDetails?: string;
  attemptedSteps?: string[];
}

/**
 * Small server-owned continuity state passed between separate agent runs.
 * Customer messages and replies remain in `history`; this only carries state
 * that the tool boundary cannot safely reconstruct from prose alone.
 */
export interface ConversationContext {
  turn: number;
  activeOrder: {
    requestedOrderId: string;
    state: "unresolved" | "verified";
    order: OrderSnapshot | null;
  } | null;
  customerSignal: "resolution" | null;
  customerProvided?: CustomerProvidedContext;
}

export interface TrackingSnapshot {
  orderId: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  status?: string | null;
  statusText?: string | null;
  estimatedDelivery?: string | null;
  lastEvent?: string | null;
  observedAt: string;
}

export interface TrackingEvent {
  description: string | null;
  timestamp: string | null;
  location: string | null;
  status: string | null;
  subStatus: string | null;
}

export interface TrackingCheckpoint extends TrackingEvent {}

export interface TrackingIdentifierProvenance {
  source: "shopify_order_fulfillment" | "customer_message";
  workspaceId: string;
  orderId?: string | null;
  orderNumber?: string | null;
  fulfillmentId?: string | null;
}

export interface LiveTrackingSnapshot {
  trackingNumber: string;
  carrier: string | null;
  status: string | null;
  subStatus: string | null;
  latestEvent: TrackingEvent | null;
  estimatedDelivery: string | null;
  checkpoints: TrackingCheckpoint[];
  exception: string | null;
  observedAt: string;
  provider: string;
  source: string;
}

export type TrackingProviderFailure = "not_found" | "invalid_request" | "unavailable" | "unauthorized";

export type TrackingProviderResult =
  | { status: "ok"; data: LiveTrackingSnapshot }
  | { status: TrackingProviderFailure; trackingNumber: string; provider: string; observedAt: string; error?: { code: string; message: string } };

export interface LiveTrackingProvider {
  readonly providerName: string;
  lookup(input: {
    trackingNumber: string;
    carrierHint?: string | null;
    trackingUrl?: string | null;
    provenance: TrackingIdentifierProvenance;
  }): Promise<TrackingProviderResult>;
}

export interface CustomerSnapshot {
  name?: string | null;
  email?: string | null;
}

/** Only read methods live in this interface. There is intentionally no write method. */
export interface CommerceReadProvider {
  readonly providerName: string;
  getOrder(orderId: string): Promise<OrderSnapshot | null>;
  getOrderHistory(customerEmail: string | null | undefined): Promise<OrderSnapshot[]>;
  getCustomer(): Promise<CustomerSnapshot | null>;
  getProduct(query: string): Promise<JsonValue>;
  getProductAvailability(query: string): Promise<JsonValue>;
  inspectFulfillment(orderId: string): Promise<JsonValue>;
}

export type SensitiveAction =
  | "cancel_order"
  | "update_address"
  | "create_return"
  | "create_refund"
  | "send_replacement";

export interface ProposedAction {
  action: SensitiveAction;
  arguments: JsonObject;
  reason: string;
  requiresConfirmation: true;
  status: "proposed";
}

export type ActionValidationStatus = "validated" | "blocked";
export type ActionExecutionStatus = "dry_run_success" | "blocked" | "executed";

export interface ActionValidationCheck {
  name: string;
  status: "passed" | "failed";
  detail: string;
}

export interface ActionExecutionResult {
  mode: "dry_run";
  action: SensitiveAction;
  target: { order_id: string | null };
  arguments: JsonObject;
  proposal_status: "proposed";
  validation_status: ActionValidationStatus;
  execution_status: ActionExecutionStatus;
  would_execute: boolean;
  executed: false;
  validation_checks: ActionValidationCheck[];
  reason: string;
}

export interface ActionExecutorContext {
  tenant: TenantContext;
  manifest: CapabilityManifest;
  activeOrder: ConversationContext["activeOrder"];
  /** Server-owned scope binding; never supplied by the model or client. */
  verifiedWorkspaceId: string;
}

export interface ActionExecutor {
  execute(proposal: ProposedAction, context: ActionExecutorContext): Promise<ActionExecutionResult>;
}

export interface ToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface ModelRequest {
  instructions: string;
  input: unknown[];
  tools: unknown[];
}

export interface ModelTextResponse {
  type: "text";
  text: string;
  usage?: JsonObject | null;
  raw?: unknown;
}

export interface ModelToolResponse {
  type: "tool_call";
  toolCall: ToolCall;
  usage?: JsonObject | null;
  raw?: unknown;
}

export type ModelResponse = ModelTextResponse | ModelToolResponse;

export interface GreenfieldModel {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export type TraceEventType =
  | "agent_started"
  | "model_request"
  | "model_response"
  | "tool_call"
  | "tool_result"
  | "action_execution"
  | "final_response"
  | "error";

export interface TraceEvent {
  at: string;
  type: TraceEventType;
  data: JsonValue;
}

export interface AgentTrace {
  traceId: string;
  workspaceId: string;
  startedAt: string;
  finishedAt: string | null;
  events: TraceEvent[];
  developerInstructions: string;
  tools: unknown[];
  usage: JsonObject[];
}

export interface ToolExecutionResult {
  status: "ok" | "not_found" | "missing_context" | "invalid_arguments" | "invalid_request" | "unavailable" | "unauthorized" | "error" | "proposed";
  /** Assigned by the per-run capability registry and never supplied by the model. */
  resultId?: string;
  data?: JsonValue;
  proposedAction?: ProposedAction;
  error?: { code: string; message: string };
}

export interface AgentRunResult {
  response: string;
  proposedActions: ProposedAction[];
  actionExecutions?: ActionExecutionResult[];
  trace: AgentTrace;
  conversationContext: ConversationContext;
}
