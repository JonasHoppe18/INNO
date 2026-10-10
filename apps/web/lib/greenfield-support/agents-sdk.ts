import { compilePreciseAnswerRequests, facetReadQuery } from "./answer-facets";
import { normalizeMerchantPolicyAttribution, preserveMaterialPolicyEvidence, missingPreciseEvidence, renderWithAnswerCoverage, verifiedAnswerSubject, groundedAnswerSubject, resolvePreciseAnswerSubjects, type ResponseValidationContext } from "./response-contract";
import { resolveOperationalAction } from "./operational-execution";
import type { OperationalRuntime } from "./operational-types";
import { prepareCaseContext, advanceCaseContext, caseActionIntents, confirmedCaseAction, resolvedCaseEmail, caseIntakeRequirements, deduplicateReadOnlySubjects, normalizeReadOnlySubject, prepareReadOnlyAnswers, bindReadOnlyAnswer, completeReadOnlyAnswers } from "./case-state";
import { interpretTurnIR, normalizeTurnIR, TurnIRReadOnlyRecoveryError, type TurnIR, type TurnInterpreter } from "./turn-ir";
import { complaintContextForOrder } from "./action-eligibility";
import { boundedActionDecision } from "./action-decision";
import { validateActionProposal } from "./action-executor";
import { Agent, Runner, tool, withTrace } from "@openai/agents";
import type { AgentInputItem, JsonSchemaDefinition, Model } from "@openai/agents";
import { z } from "zod";
import { composeEmailBodyWithSignature, inferGermanLanguage, selectSignatureText } from "@/lib/server/email-signature";
import { fallbackResponse } from "./agent";
import { executeActionProposals } from "./action-executor";
import { GREENFIELD_DEVELOPER_INSTRUCTIONS, instructionsForCapabilities } from "./instructions";
import { createCapabilityRegistry, extractOrderReferences } from "./capabilities";
import { GREENFIELD_RUNTIME_TOOL_DEFINITIONS } from "./tool-contracts";
import { ensureAnswerCompleteness, inferResponseLocale, renderResponseSegments, shouldPreferAuthoritativeEvidenceFallback, StructuredResponseSchema, summarizeResponseValidation, validateStructuredResponse } from "./response-contract";
import type { ResponseCompletenessDiagnostics, ResponseValidationResult } from "./response-contract";
import { extractCustomerProvidedContext, modelConversationContext, nextConversationContext, resolveCustomerDisplayName } from "./conversation-context";
import { resolveGreenfieldRuntimeConfig } from "./runtime-config";
import type {
  AgentRunResult,
  ActionExecutor,
  AgentTrace,
  ConversationContext,
  GreenfieldInteractionChannel,
  JsonObject,
  JsonValue,
  ProposedAction,
  TenantContext,
  ToolExecutionResult,
  TraceEvent,
} from "./types";

type CapabilityRegistry = ReturnType<typeof createCapabilityRegistry>;

// Derive model-facing structural guidance from the same contract that
// Greenfield validates below. A raw JSON Schema output type is parsed by the
// SDK without applying local schema validation, so the application contract
// remains the only semantic validation layer.
const GREENFIELD_SDK_OUTPUT_TYPE: JsonSchemaDefinition = {
  type: "json_schema",
  name: "greenfield_model_output",
  strict: false,
  schema: z.toJSONSchema(StructuredResponseSchema, {
    target: "openai",
    unrepresentable: "any",
  }) as JsonSchemaDefinition["schema"],
};

interface SonaAgentContext {
  registry: CapabilityRegistry;
  trace: AgentTrace;
  proposedActions: ProposedAction[];
  now: () => string;
}

export interface GreenfieldAgentsSdkOptions {
  tenant: TenantContext;
  operational?: OperationalRuntime;
  /** Server-owned semantic interpreter; injectable for deterministic evaluation. */
  turnInterpreter?: TurnInterpreter;
  /** Display-only sender/profile name; never used for authorization. */
  customerDisplayName?: string | null;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  conversationContext?: ConversationContext;
  capabilities: Parameters<typeof createCapabilityRegistry>[0];
  maxTurns?: number;
  now?: () => string;
  model?: string | Model;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;
  /** Enables sanitized diagnostics only for the internal DEV Playground. */
  enableDevDiagnostics?: boolean;
  /** Server-resolved support-user signature configuration; never supplied to the model. */
  signature?: string | {
    defaultClosingText?: string | null;
    closingText?: string | null;
    languageSignatures?: Record<string, string | null | undefined>;
  } | null;
  actionExecutor?: ActionExecutor;
  interactionChannel?: GreenfieldInteractionChannel;
}

function signatureLanguage(message: string): "da" | "de" | "en" {
  const responseLocale = inferResponseLocale(message);
  if (responseLocale === "da") return "da";
  return inferGermanLanguage(message) ? "de" : "en";
}

function composeGreenfieldResponse(response: string, signature: GreenfieldAgentsSdkOptions["signature"], message: string): string {
  const normalizedResponse = normalizeMerchantPolicyAttribution(String(response || "").trim());
  const normalizedSignature = typeof signature === "string"
    ? String(signature || "").trim()
    : selectSignatureText({
        defaultSignature: signature?.defaultClosingText ?? signature?.closingText ?? "",
        languageSignatures: signature?.languageSignatures,
        language: signatureLanguage(message),
      });
  if (!normalizedSignature) return normalizedResponse;
  return composeEmailBodyWithSignature({
    bodyText: normalizedResponse,
    config: { closingText: normalizedSignature },
  }).finalBodyText;
}

function traceValue(value: unknown): JsonValue {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : (JSON.parse(serialized) as JsonValue);
  } catch {
    return String(value ?? "");
  }
}

function traceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function pushEvent(trace: AgentTrace, type: TraceEvent["type"], data: unknown, at: string) {
  trace.events.push({ at, type, data: traceValue(data) });
}

function serializeToolResult(result: ToolExecutionResult): string {
  return JSON.stringify({
    result_id: result.resultId ?? null,
    status: result.status,
    data: result.data ?? null,
    proposed_action: result.proposedAction ?? null,
    error: result.error ?? null,
  });
}

function toolCallId(details: any): string {
  return String(details?.toolCall?.callId || details?.toolCall?.call_id || "");
}

function toolArguments(args: unknown): JsonValue {
  return traceValue(args ?? {});
}

function diagnosticQuestionShape(message: string) {
  const value = String(message ?? "").toLowerCase();
  if (/\b(?:when|hvornår|wann)\b[\s\S]{0,80}\b(?:refund|refusion|refundering|money|pengene|geld|zurück|back)\b/.test(value)) return "timing";
  if (/\b(?:who|hvem|wer)\b[\s\S]{0,80}\b(?:pay|betaler|zahlt|postage|shipping|fragt|returfragt|versand)\b/.test(value)) return "payer";
  if (/\b(?:where|hvor|wo)\b[\s\S]{0,80}\b(?:send|return|retur|rück|adresse|address|sende)\b/.test(value)) return "destination";
  if (/\b(?:can|kan|kann)\b[\s\S]{0,80}\b(?:return|returnere|zurück|opened|åbnet|geöffnet)\b/.test(value)) return "eligibility";
  if (/\b(?:how|hvordan|wie)\b/.test(value)) return "process";
  if (/\b(?:pair|parr|koppel|connect|forbind|verbinden|troubleshoot|fejl|problem|issue)\b/.test(value)) return "procedure";
  if (/\b(?:policy|politik|policy|refund|return|retur|warranty|garanti|shipping|levering)\b/.test(value)) return "policy";
  return "general";
}

function looksLikeFallbackText(value: unknown) {
  return /\b(?:couldn['’]?t|cannot|can't|unable|try again|safely complete|could not|beklager|kan ikke|prøv igen|nicht sicher|erneut versuchen)\b/i.test(String(value ?? ""));
}

function modelOutputDiagnostics(output: unknown) {
  const parsed = StructuredResponseSchema.safeParse(output);
  const segments = parsed.success ? parsed.data.segments : [];
  const knowledgeSegments = segments.filter((segment) => segment.type === "knowledge_guidance");
  const answerSegments = segments.filter((segment) => ["fact", "source_content", "source_comparison", "evidence_limitation", "facet_limit", "knowledge_guidance", "procedure_guidance", "action_offer", "acknowledgement"].includes(segment.type));
  const clarificationRequested = segments.some((segment) => segment.type === "question");
  const fallbackLikeContent = segments.some((segment) => "text" in segment && looksLikeFallbackText(segment.text));
  const hasAnswer = answerSegments.length > 0 && !fallbackLikeContent;
  return {
    structured_parse_failed: !parsed.success,
    knowledge_guidance_exists: knowledgeSegments.length > 0,
    knowledge_guidance_has_answer_text: knowledgeSegments.some((segment) => Boolean(segment.text?.trim())),
    knowledge_guidance_basis_refs: knowledgeSegments.filter((segment) => Boolean(segment.basis?.result_id)).length,
    clarification_requested: clarificationRequested,
    fallback_like_content: fallbackLikeContent,
    segment_count: segments.length,
    response_mode: hasAnswer ? "answered" : clarificationRequested ? "clarification" : "fallback",
  };
}

function evidenceDiagnostics(registry: CapabilityRegistry) {
  const sourceIds = new Set<string>();
  const evidenceSectionIds = new Set<string>();
  const providerStatuses: Record<string, string> = {};
  let resolvableIntent = false;
  for (const evidence of registry.getResults()) {
    providerStatuses[evidence.toolName] = evidence.result.status;
    const data = evidence.result.data && typeof evidence.result.data === "object" && !Array.isArray(evidence.result.data)
      ? evidence.result.data as Record<string, unknown>
      : null;
    const results = Array.isArray(data?.results) ? data.results : [];
    if (evidence.result.status === "ok" && (results.length > 0 || evidence.toolName !== "search_policy")) {
      resolvableIntent = true;
    }
    for (const item of results) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const provenance = record.provenance && typeof record.provenance === "object" && !Array.isArray(record.provenance)
        ? record.provenance as Record<string, unknown>
        : null;
      const sourceId = String(record.source_id ?? provenance?.source_id ?? "").trim();
      if (sourceId) sourceIds.add(sourceId);
      const sections = Array.isArray(record.evidence_sections) ? record.evidence_sections : [];
      for (const section of sections) {
        if (!section || typeof section !== "object" || Array.isArray(section)) continue;
        const chunkIds = Array.isArray((section as Record<string, unknown>).chunk_ids)
          ? (section as Record<string, unknown>).chunk_ids as unknown[]
          : [];
        for (const chunkId of chunkIds) {
          const normalized = String(chunkId ?? "").trim();
          if (normalized) evidenceSectionIds.add(normalized);
        }
      }
    }
  }
  return {
    selected_source_ids: [...sourceIds].slice(0, 20),
    selected_evidence_section_ids: [...evidenceSectionIds].slice(0, 40),
    provider_status: providerStatuses,
    resolvable_intent: resolvableIntent,
  };
}

function completenessDiagnostics(validation: ResponseValidationResult): ResponseCompletenessDiagnostics {
  return validation.completenessDiagnostics ?? { entered: false, cues: [], recovery: [] };
}

function recoverySummary(validation: ResponseValidationResult) {
  const diagnostics = completenessDiagnostics(validation);
  const recovered = diagnostics.recovery.filter((item) => item.result === "recovered");
  const attempted = diagnostics.recovery.some((item) => ["recovered", "ambiguous", "unavailable"].includes(item.result));
  return {
    recovery_attempted: attempted,
    recovery_type: [...new Set(diagnostics.recovery.map((item) => item.type))],
    recovery_result: recovered.length > 0
      ? "recovered"
      : diagnostics.recovery.some((item) => item.result === "ambiguous")
        ? "ambiguous"
        : diagnostics.recovery.some((item) => item.result === "unavailable")
          ? "unavailable"
          : diagnostics.recovery.some((item) => item.result === "skipped")
            ? "skipped"
            : "unavailable",
    recovery_details: diagnostics.recovery,
  };
}

function responseCompositionSource(
  modelDiagnostics: ReturnType<typeof modelOutputDiagnostics>,
  validation: ResponseValidationResult,
  usedAuthoritativeFallback = false,
) {
  const recovery = recoverySummary(validation);
  if (usedAuthoritativeFallback) return recovery.recovery_result === "recovered" ? "recovered_evidence" : "fallback";
  if (!validation.approvedSegments.length) return "fallback";
  if (recovery.recovery_result === "recovered") return modelDiagnostics.response_mode === "answered" ? "mixed" : "recovered_evidence";
  return "model";
}

function createSdkTools(context: SonaAgentContext, definitions: typeof GREENFIELD_RUNTIME_TOOL_DEFINITIONS) {
  return definitions.map((definition) =>
    tool({
      name: definition.name,
      description: definition.description,
      strict: true,
      parameters: definition.parameters,
      // These are deliberately proposal-only today. If a real write is added,
      // set needsApproval: true and persist/resume the SDK RunState at the route.
      timeoutMs: 15_000,
      timeoutBehavior: "error_as_result",
      errorFunction: async (_runContext, error) =>
        serializeToolResult({
          status: "error",
          error: {
            code: "sdk_tool_failed",
            message: error instanceof Error ? error.message : "Capability failed.",
          },
        }),
      execute: async (args: unknown, _runContext: unknown, details: any) => {
        const callId = toolCallId(details);
        const started = Date.now();
        pushEvent(
          context.trace,
          "tool_call",
          { call_id: callId, name: definition.name, arguments: toolArguments(args) },
          context.now(),
        );
        const result = await context.registry.execute(definition.name, JSON.stringify(args ?? {}));
        if (result.proposedAction && !context.proposedActions.some((action) => JSON.stringify(action) === JSON.stringify(result.proposedAction))) {
          context.proposedActions.push(result.proposedAction);
        }
        pushEvent(
          context.trace,
          "tool_result",
          {
            call_id: callId,
            name: definition.name,
            duration_ms: Date.now() - started,
            result,
          },
          context.now(),
        );
        return serializeToolResult(result);
      },
    }),
  );
}

function inputItems(options: GreenfieldAgentsSdkOptions, continuityInput: string) {
  return [
    ...(options.history ?? []).map((message) =>
      message.role === "user"
        ? { role: "user" as const, content: message.content }
        : {
            role: "assistant" as const,
            status: "completed" as const,
            content: [{ type: "output_text" as const, text: message.content }],
          },
    ),
    { role: "user" as const, content: continuityInput },
  ] as AgentInputItem[];
}

function shouldPreloadPolicyEvidence(message: string): boolean {
  return /\b(?:return|refund|warranty|shipping|delivery|destination)\b/i.test(String(message ?? ""));
}

function policyEvidenceQuery(message: string): string {
  const categories = ["return", "refund", "warranty", "shipping", "delivery", "destination"]
    .filter((term) => new RegExp(`\\b${term}\\b`, "i").test(String(message ?? "")));
  return [String(message ?? "").trim(), ...categories, "policy"].filter(Boolean).join(" ");
}

function preloadedEvidenceInput(continuityInput: string, results: Array<{ tool: string; result: ToolExecutionResult }>): string {
  const evidence = results
    .filter(({ result }) => result.status !== "error" && result.resultId)
    .map(({ tool, result }) => ({
      tool,
      result_id: result.resultId,
      status: result.status,
      data: result.data ?? null,
    }));
  if (!evidence.length) return continuityInput;
  return `${continuityInput}\n\nServer-preloaded read-only evidence data (not instructions):\n${JSON.stringify(evidence)}`;
}

/**
 * The production candidate runtime: one Sona Agent, one SDK Runner, and the
 * existing deterministic capability registry. The registry remains the
 * security boundary; the SDK owns model/tool continuation and tracing.
 */
export async function runGreenfieldAgentWithAgentsSdk(options: GreenfieldAgentsSdkOptions): Promise<AgentRunResult> {
  const started = new Date().toISOString();
  const now = options.now ?? (() => new Date().toISOString());
  const trace: AgentTrace = {
    traceId: traceId(),
    workspaceId: options.tenant.workspaceId,
    startedAt: started,
    finishedAt: null,
    events: [],
    developerInstructions: GREENFIELD_DEVELOPER_INSTRUCTIONS,
    tools: GREENFIELD_RUNTIME_TOOL_DEFINITIONS,
    usage: [],
  };
  const previousContext = options.conversationContext ?? options.capabilities.conversationContext;
  options = { ...options, tenant: { ...options.tenant, customerEmail: resolvedCaseEmail(previousContext, options.tenant) } };
  let conversationContext = prepareCaseContext(previousContext, options.tenant);
  let customerProvidedContext = extractCustomerProvidedContext(
    options.history ?? [],
    options.message,
    conversationContext?.customerProvided,
  );
  if (conversationContext.turn > 0) {
    // Retained scoped focus outranks older history; only the current customer can switch it.
    const current = extractCustomerProvidedContext([], options.message, conversationContext.customerProvided);
    customerProvidedContext = { ...customerProvidedContext };
    delete customerProvidedContext.product;
    if (current?.product) customerProvidedContext.product = current.product;
  }
  let turnIR: TurnIR | null = null;
  let readOnlyRecovery: TurnIRReadOnlyRecoveryError | null = null;
  try {
    turnIR = normalizeTurnIR(await (options.turnInterpreter ?? interpretTurnIR)(options.message, conversationContext), options.message);
  } catch (error) {
    if (error instanceof TurnIRReadOnlyRecoveryError) readOnlyRecovery = error;
    // An unavailable interpretation is not a successful interpretation with no actions.
    pushEvent(trace, "error", { code: "turn_ir_unavailable",
      message: "Semantic interpretation is unavailable. Proposal-only actions are blocked for this turn." }, now());
  }
  let readOnlyIR = turnIR ?? readOnlyRecovery?.readOnlyIR;
  if (readOnlyRecovery) pushEvent(trace, "error", { code: "turn_ir_read_only_recovered", actions_blocked: true, request_count: readOnlyIR?.answerRequests?.length ?? 0, unresolved_facets: readOnlyRecovery.unresolvedFacets }, now());
  const namedSubjects = deduplicateReadOnlySubjects([
    ...(readOnlyIR?.answerRequests ?? []).flatMap(request => request.subject ? [request.subject] : []),
    ...(turnIR?.readOnlyFollowup?.subject ? [turnIR.readOnlyFollowup.subject] : []),
  ]).filter(subject => groundedAnswerSubject({ customerMessage: options.message } as ResponseValidationContext, subject));
  const readOnlyAnswers = prepareReadOnlyAnswers(conversationContext, turnIR, options.message, namedSubjects, readOnlyRecovery);
  readOnlyIR = readOnlyAnswers.ir ?? undefined;
  if (readOnlyAnswers.bindings.length || readOnlyAnswers.closed.length) pushEvent(trace, "case_state", {
    diagnostic: "read_only_answer_lifecycle", carried: readOnlyAnswers.carried, closed: readOnlyAnswers.closed,
    pending: conversationContext.caseState?.pendingReadOnlyAnswers?.map(value => ({ id: value.id, subjectRequirement: value.subjectRequirement, facets: value.request.facets })),
  }, now());
  if (namedSubjects.length) {
    customerProvidedContext = { ...customerProvidedContext };
    delete customerProvidedContext.product;
    if (namedSubjects.length === 1) customerProvidedContext.product = namedSubjects[0];
  }
  conversationContext.customerProvided = customerProvidedContext;
  const unresolvedReadOnlyFacets = readOnlyAnswers.bindings.flatMap(binding => {
    const pending = conversationContext.caseState?.pendingReadOnlyAnswers?.find(value => value.id === binding.id);
    return pending?.unresolvedFacets?.length ? [{ requestIndex: binding.requestIndex, facets: pending.unresolvedFacets }] : [];
  });
  const unresolvedFacets = [...(readOnlyRecovery?.unresolvedFacets ?? []), ...unresolvedReadOnlyFacets];
  let preciseRequests = resolvePreciseAnswerSubjects(compilePreciseAnswerRequests(readOnlyIR?.answerRequests ?? []), {
    customerMessage: options.message, customerProvidedContext,
  }).map(request => ({ ...request, ...(unresolvedFacets.some(entry => entry.requestIndex === request.requestIndex
    && entry.facets.some(facet => facet === request.facet
      || request.facet === "qualified_next_step" && request.requiredFor.includes(facet))) ? { unresolvedSpecificity: true } : {}) }));
  const preciseReadResults: Record<string, string[]> = {};
  // Identity reads precede facet reads so one subject cannot consume another's lookup.
  const preciseReadBudgets = new Map(preciseRequests.map(request => [request.subject, 6]));
  let providerCustomer = await options.capabilities.commerce.getCustomer().catch(() => null);
  const identityMismatch = Boolean(options.tenant.customerEmail && providerCustomer?.email
    && options.tenant.customerEmail.toLowerCase() !== providerCustomer.email.trim().toLowerCase());
  if (identityMismatch) {
    conversationContext.caseState!.customerEmail = options.tenant.customerEmail!;
    conversationContext.caseState!.identityUnavailable = true;
    options.tenant.customerEmail = null;
    providerCustomer = null;
    pushEvent(trace, "error", { code: "customer_identity_scope_mismatch", message: "Provider identity does not match the current case." }, now());
  }
  const currentReferences = options.capabilities.orderReferences ?? extractOrderReferences(options.message);
  conversationContext = advanceCaseContext(conversationContext, turnIR, options.message,
    currentReferences.length === 1 ? { requestedOrderId: currentReferences[0], state: "unresolved", order: null } : conversationContext.activeOrder);
  const registry = createCapabilityRegistry({
    ...options.capabilities,
    tenant: options.tenant,
    customerIdentityMismatch: identityMismatch,
    customerMessage: options.message,
    turnIR: caseActionIntents(conversationContext, turnIR, currentReferences.length > 0) ?? undefined,
    proposalActionsBlocked: turnIR === null,
    conversationContext,
    orderReferences: options.capabilities.orderReferences ?? Array.from(new Set([
      ...extractOrderReferences(options.message),
      ...(turnIR?.actions ?? []).flatMap(intent => {
        const reference = intent.orderReference?.replace(/^#/, "");
        return reference && options.message.includes(reference) ? [reference] : [];
      }),
    ])),
    toolDefinitions: GREENFIELD_RUNTIME_TOOL_DEFINITIONS,
  });
  let continuityInput = modelConversationContext(
    conversationContext,
    registry.getActiveOrderFocus(),
    options.message,
    options.history ?? [],
    options.interactionChannel,
    registry.getOrderCandidates(),
  );
  const instructions = instructionsForCapabilities(registry.manifest);
  const verifiedProfileName = options.tenant.customerName ?? providerCustomer?.name ?? null;
  const customerDisplayName = resolveCustomerDisplayName({
    verifiedProfileName,
    structuredSenderName: options.customerDisplayName,
    history: options.history,
    message: options.message,
  });
  trace.developerInstructions = instructions;
  const proposedActions: ProposedAction[] = [];
  const context: SonaAgentContext = { registry, trace, proposedActions, now };
  const maxTurns = Math.max(1, Math.min(options.maxTurns ?? 8, 12));
  const runtimeConfig = resolveGreenfieldRuntimeConfig({
    model: typeof options.model === "string" ? options.model : undefined,
    reasoningEffort: options.reasoningEffort,
  });
  const model = options.model ?? runtimeConfig.model;
  const agent = new Agent<SonaAgentContext, JsonSchemaDefinition>({
    name: "Sona Support Agent",
    instructions,
    model,
    outputType: GREENFIELD_SDK_OUTPUT_TYPE,
    modelSettings: {
      parallelToolCalls: false,
      ...(runtimeConfig.reasoningEffort ? { reasoning: { effort: runtimeConfig.reasoningEffort } } : {}),
    },
    tools: createSdkTools(context, registry.definitions),
  });
  const runner = new Runner({
    workflowName: "Sona support agent",
    traceIncludeSensitiveData: false,
  });

  pushEvent(
    trace,
    "agent_started",
    {
      message: options.message,
      history: options.history ?? [],
      conversation_context: continuityInput,
      runtime: "@openai/agents",
      capabilities: registry.definitions.map((definition) => ({
        name: definition.name,
        sensitivity: definition.sensitivity,
      })),
      capability_manifest: registry.manifest,
    },
    now(),
  );

  // This is a read-only evidence lookup. Preload explicitly signalled policy
  // evidence so one agent can preserve a supported policy answer while also
  // handling another request in the same turn.
  const preloadedResults: Array<{ tool: string; result: ToolExecutionResult }> = [];
  const orderContextResults = await registry.resolveCustomerOrderContext();
  for (const { tool, result, arguments: toolArguments } of orderContextResults) {
    pushEvent(trace, "tool_call", {
      call_id: `preloaded_${tool}`,
      name: tool,
      arguments: toolArguments ?? {},
      preloaded: true,
    }, now());
    pushEvent(trace, "tool_result", {
      call_id: `preloaded_${tool}`,
      name: tool,
      duration_ms: 0,
      result,
      preloaded: true,
    }, now());
  }
  preloadedResults.push(...orderContextResults);
  const preload = async (toolName: "search_policy" | "search_product_knowledge" | "get_product", query: string) => {
    const startedPreload = Date.now();
    pushEvent(trace, "tool_call", {
      call_id: `preloaded_${toolName}`,
      name: toolName,
      arguments: { query },
      preloaded: true,
    }, now());
    const result = await registry.execute(toolName, JSON.stringify({ query }));
    pushEvent(trace, "tool_result", {
      call_id: `preloaded_${toolName}`,
      name: toolName,
      duration_ms: Date.now() - startedPreload,
      result,
      preloaded: true,
    }, now());
    preloadedResults.push({ tool: toolName, result });
    return result;
  };
  const preciseContext = () => ({ ...registry, evidenceScope: { workspaceId: options.tenant.workspaceId, shopId: options.tenant.shopId ?? "" }, operationalScope: { workspaceId: options.tenant.workspaceId, shopId: options.tenant.shopId ?? "", caseId: options.tenant.caseId, customerEmail: options.tenant.customerEmail ?? "" }, preciseRequests, preciseReadResults, turnIR: readOnlyIR ?? undefined, customerMessage: options.message, customerProvidedContext, caseState: conversationContext.caseState });
  const recoverPreciseReads = async () => {
    for (const request of missingPreciseEvidence(preciseContext())) {
      const subject = verifiedAnswerSubject(preciseContext(), request);
      if (!subject && !groundedAnswerSubject(preciseContext(), request.subject)) continue;
      if (!missingPreciseEvidence(preciseContext()).some(current => current.id === request.id)) continue;
      const budget = preciseReadBudgets.get(request.subject) ?? 0;
      if (budget <= 0) continue;
      const query = `${subject?.title ?? request.subject}: ${facetReadQuery(request.facet)}${request.qualifiers.length ? ` ${request.qualifiers.join(" ")}` : ""}`;
      preciseReadBudgets.set(request.subject, budget - 1);
      const result = await preload("search_product_knowledge", query);
      if (result.resultId) (preciseReadResults[request.id] ??= []).push(result.resultId);
      // Retry the verified catalog alias, never a different product or an invented value.
      if (subject?.handle && (preciseReadBudgets.get(request.subject) ?? 0) > 0 && missingPreciseEvidence(preciseContext()).some(current => current.id === request.id)) {
        preciseReadBudgets.set(request.subject, (preciseReadBudgets.get(request.subject) ?? 0) - 1);
        const retry = await preload("search_product_knowledge", `${subject.handle}: ${facetReadQuery(request.facet)}${request.qualifiers.length ? ` ${request.qualifiers.join(" ")}` : ""}`);
        if (retry.resultId) (preciseReadResults[request.id] ??= []).push(retry.resultId);
      }
    }
  };
  if (preciseRequests.length && preciseRequests.some(request => request.subject)) {
    for (const lookupSubject of new Set(preciseRequests.map(request => request.subject).filter((subject): subject is string => Boolean(subject)))) {
      if (!groundedAnswerSubject(preciseContext(), lookupSubject)) continue;
      preciseReadBudgets.set(lookupSubject, (preciseReadBudgets.get(lookupSubject) ?? 0) - 1);
      // A semantic label is only a query. Each returned identity binds its own requests.
      const read = await preload("get_product", lookupSubject);
      if (read.resultId) for (const request of preciseRequests.filter(request => request.subject === lookupSubject)) (preciseReadResults[request.id] ??= []).push(read.resultId);
    }
    const conflicting = readOnlyAnswers.bindings.filter(binding => {
      const prior = conversationContext.caseState?.pendingReadOnlyAnswers?.find(value => value.id === binding.id);
      const request = preciseRequests.find(value => value.requestIndex === binding.requestIndex);
      const verified = request && verifiedAnswerSubject(preciseContext(), request);
      return prior?.verifiedProductId && verified && prior.verifiedProductId !== verified.id;
    });
    if (conflicting.length) {
      pushEvent(trace, "case_state", { diagnostic: "read_only_subject_binding_conflict", ids: conflicting.map(value => value.id) }, now());
      readOnlyAnswers.bindings = [];
      readOnlyIR = turnIR ?? undefined;
      preciseRequests = resolvePreciseAnswerSubjects(compilePreciseAnswerRequests(readOnlyIR?.answerRequests ?? []), { customerMessage: options.message, customerProvidedContext });
    }
    await recoverPreciseReads();
  }
  if (namedSubjects.length) {
    const verified = namedSubjects.length === 1 && preciseRequests.some(request => request.subject && normalizeReadOnlySubject(request.subject) === normalizeReadOnlySubject(namedSubjects[0]) && verifiedAnswerSubject(preciseContext(), request));
    customerProvidedContext = { ...customerProvidedContext };
    delete customerProvidedContext.product;
    if (verified) customerProvidedContext.product = namedSubjects[0];
    conversationContext.customerProvided = customerProvidedContext;
  }
  conversationContext.customerProvided = customerProvidedContext;
  for (const binding of readOnlyAnswers.bindings) {
    const request = preciseRequests.find(value => value.requestIndex === binding.requestIndex);
    const product = request ? verifiedAnswerSubject(preciseContext(), request) : null;
    if (bindReadOnlyAnswer(conversationContext, binding, product, turnIR
      ? { request: turnIR.answerRequests?.[binding.requestIndex], message: options.message } : undefined)) pushEvent(trace, "case_state", {
      diagnostic: "read_only_subject_bound", obligation_id: binding.id, verified_product_id: product!.id,
    }, now());
  }
  conversationContext = advanceCaseContext(conversationContext, turnIR, options.message, registry.getActiveOrderFocus());
  const effectiveTurnIR = caseActionIntents(conversationContext, turnIR, currentReferences.length > 0);
  const operationalOutcome = options.operational && turnIR !== null ? await resolveOperationalAction({ tenant: options.tenant,
    commerce: options.capabilities.commerce, runtime: options.operational, channel: options.interactionChannel }, conversationContext, effectiveTurnIR) : null;
  const operationalRecord = operationalOutcome ? registry.recordOperationalOutcome({ operation: traceValue(operationalOutcome) }) : null;
  const operationalDecision = operationalRecord ? { structuredOutput: { segments: [{ type: "operational_result", basis: { result_id: operationalRecord.resultId, field_paths: ["data.operation"] } }] } } : null;
  const intentAssessments = effectiveTurnIR && !operationalDecision ? registry.evaluateActionIntents(effectiveTurnIR) : [];
  if (options.operational && turnIR?.orderContext === "status" && !effectiveTurnIR?.actions.length && registry.getActiveOrderFocus()?.state === "verified") {
    const numbers = Array.from(new Set((registry.getActiveOrderFocus()?.order?.fulfillments ?? []).filter(f => !["cancelled", "canceled", "failed", "failure"].includes(String(f.status ?? "").toLowerCase())).map(f => f.trackingNumber).filter((value): value is string => Boolean(value && /^[A-Za-z0-9][A-Za-z0-9 ._/-]{1,79}$/.test(value)))));
    for (const trackingNumber of numbers) {
      const trackingResult = await registry.execute("get_tracking", JSON.stringify({ tracking_number: trackingNumber }));
      pushEvent(trace, "tool_call", { name: "get_tracking", call_id: `preloaded_tracking_${trackingNumber}`, arguments: { tracking_number: trackingNumber }, preloaded: true }, now());
      pushEvent(trace, "tool_result", { name: "get_tracking", call_id: `preloaded_tracking_${trackingNumber}`, result: trackingResult, preloaded: true, duration_ms: 0 }, now());
      preloadedResults.push({ tool: "get_tracking", result: trackingResult });
    }
  }
  pushEvent(trace, "case_state", { canonical: conversationContext.caseState,
    active_order: registry.getActiveOrderFocus(), information_ownership: { identity: "server", order_state: "live_data", address: "customer", execution_approval: "human" } }, now());
  for (const assessment of intentAssessments) pushEvent(trace, "action_intent", assessment, now());
  let intentDecision = boundedActionDecision(registry.getResults(), [], inferResponseLocale(options.message));
  const missingAddress = intentAssessments.find(a => a.intent.action === "update_address"
    && a.eligibility.outcome === "proposal_allowed" && !a.intent.addressProvided);
  const addressQuestion = missingAddress ? { structuredOutput: { segments: [{ type: "question",
    purpose: "resolve_required_argument", capability: "update_address", missing_arguments: ["address"],
    text: inferResponseLocale(options.message) === "da" ? "Hvad er den nye komplette leveringsadresse?" : "What is the complete new delivery address?",
    basis: { result_id: missingAddress.result.resultId!, field_paths: ["data.action_eligibility"] } }] } } : null;
  const requirements = readOnlyRecovery ? [] : caseIntakeRequirements(conversationContext, turnIR, registry.getOrderCandidates(),
    registry.getResults().filter(record => record.toolName === "get_order" || record.toolName === "get_order_history").at(-1)?.result.status, options.capabilities.remedyAuthorization);
  if (requirements[0]?.field === "photo" && intentDecision?.outcome === "assessment_required") intentDecision = null;
  let intakeDecision: { structuredOutput: unknown } | null = null;
  if (requirements.length && !intentDecision && !addressQuestion && !operationalDecision) {
    const requirement = requirements[0];
    const result = registry.recordCaseRequirements({ requirements: requirements.map(r => ({ ...r })),
      active_order_reference: registry.getActiveOrderFocus()?.requestedOrderId ?? null,
      available_proposal_capabilities: registry.manifest.proposalOnlyTools });
    const texts = {
      photo: "Could you supply the required photo of the affected item?",
      order_lookup: "Order lookup is currently unavailable. The order reference you supplied is retained; no order change has been made.",
      customer_email: "What email address was used for the order?",
      identity_verification: "The email you supplied still needs identity verification before order details can be accessed.",
      order_choice: `Which order do you mean: ${(registry.getOrderCandidates() ?? []).map(c => `#${c.orderNumber}`).join(" or ")}?`,
      order_reference: "I couldn’t find a matching order through your verified identity. Do you have another order reference?",
      desired_change: "What would you like to change on this order?",
      variant_edit: "Changing ordered items, variants or quantities is not available through the current automated capabilities. This requires human review; no order change has been made.",
    };
    intakeDecision = { structuredOutput: { segments: [requirement.owner === "customer"
      ? { type: "question", purpose: "pure_clarification", text: texts[requirement.field], capability: null, missing_arguments: [] }
      : { type: "limitation", text: texts[requirement.field], basis: { result_id: result.resultId, field_paths: ["data.requirements"] } }] } };
    pushEvent(trace, "case_state", { requirements: requirements.map(r => ({ ...r })), diagnostic: "case_intake_required" }, now());
  }
  let confirmedProposal: { structuredOutput: unknown } | null = null;
  const confirmedAssessment = intentAssessments.find(assessment =>
    ["cancel_order", "update_address"].includes(assessment.intent.action)
    && assessment.eligibility.outcome === "proposal_allowed"
    && confirmedCaseAction(conversationContext, assessment.intent.action)
    && (assessment.intent.action !== "update_address" || assessment.intent.addressProvided));
  if (confirmedAssessment && !intakeDecision && !intentDecision && !addressQuestion && !operationalDecision) {
    const action = confirmedAssessment.intent.action;
    const args = { order_id: registry.getActiveOrderFocus()!.requestedOrderId, reason: confirmedAssessment.intent.sourceText,
      ...(action === "update_address" ? { address: conversationContext.caseState?.address?.value ?? "" } : {}) };
    const result = await registry.execute(action, JSON.stringify(args));
    pushEvent(trace, "tool_call", { call_id: `case_${action}`, name: action, arguments: args, preloaded: true }, now());
    pushEvent(trace, "tool_result", { call_id: `case_${action}`, name: action, result, duration_ms: 0, preloaded: true }, now());
    if (result.proposedAction) {
      proposedActions.push(result.proposedAction);
      confirmedProposal = { structuredOutput: { segments: [{ type: "action_offer", capability: action, mode: "proposal", missing_arguments: [] }] } };
    }
  }
  const hasPolicyRequest = Boolean(turnIR?.policyIntents?.length) || (!intakeDecision && !confirmedProposal && !intentDecision && !addressQuestion && shouldPreloadPolicyEvidence(options.message));
  if (hasPolicyRequest) await preload("search_policy", policyEvidenceQuery(options.message));
  continuityInput = modelConversationContext(
    conversationContext,
    registry.getActiveOrderFocus(),
    options.message,
    options.history ?? [],
    options.interactionChannel,
    registry.getOrderCandidates(),
  );
  const modelInput = preloadedEvidenceInput(continuityInput, preloadedResults);

  try {
    let result: any;
    // A bounded decision needs no writer/tool-loop cooperation, including on writer failure.
    const preModelBoundary = operationalDecision ?? intentDecision ?? addressQuestion ?? intakeDecision ?? confirmedProposal;
    if (preModelBoundary) {
      result = { finalOutput: preModelBoundary.structuredOutput };
    } else {
      await withTrace("Sona support agent", async () => {
        result = await runner.run(agent, inputItems(options, modelInput), { context, maxTurns });
      });
    }

    if (result?.runContext?.usage && typeof result.runContext.usage === "object") {
      trace.usage.push(traceValue(result.runContext.usage) as Record<string, JsonValue>);
    }
    const modelDiagnostics = options.enableDevDiagnostics ? modelOutputDiagnostics(result?.finalOutput) : null;
    if (!preModelBoundary) pushEvent(
      trace,
      "model_response",
      {
        runtime: "@openai/agents",
        raw_response_count: Array.isArray(result?.rawResponses) ? result.rawResponses.length : 0,
        item_types: Array.isArray(result?.newItems) ? result.newItems.map((item: any) => item?.type).filter(Boolean) : [],
        interruptions: Array.isArray(result?.interruptions) ? result.interruptions.map((item: any) => ({ name: item?.name, call_id: item?.rawItem?.callId })) : [],
        ...(modelDiagnostics ? { model_output: modelDiagnostics } : {}),
      },
      now(),
    );

    if (Array.isArray(result?.interruptions) && result.interruptions.length) {
      pushEvent(trace, "error", { code: "approval_required", message: "The SDK paused for tool approval; no action was executed." }, now());
      if (options.enableDevDiagnostics && modelDiagnostics) {
        const evidence = evidenceDiagnostics(registry);
        trace.diagnostics = traceValue({
          turn_ir_unavailable: turnIR === null,
          question_shape: diagnosticQuestionShape(options.message),
          ...evidence,
          validation: null,
          model_output: preModelBoundary ? null : modelDiagnostics,
          model_response_mode: preModelBoundary ? "not_run" : modelDiagnostics.response_mode,
          completeness_check_entered: false,
          recovery_attempted: false,
          recovery_type: [],
          recovery_result: "skipped",
          fallback_reason: "approval_required",
          final_composition_source: "fallback",
        }) as JsonObject;
      }
      const response = composeGreenfieldResponse(
        "I’ve prepared an action for review, but it still needs confirmation before anything can be changed.",
        options.signature,
        options.message,
      );
      pushEvent(trace, "final_response", { response, proposed_actions: proposedActions, action_executions: [] }, now());
      trace.finishedAt = now();
      return {
        response,
        proposedActions,
        actionExecutions: [],
        trace,
        conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message, [], registry.getOrderCandidates()),
      };
    }

    const actionContext = {
      tenant: options.tenant,
      manifest: registry.manifest,
      activeOrder: registry.getActiveOrderFocus(),
      verifiedWorkspaceId: options.tenant.workspaceId,
      customerMessage: options.message,
      complaintContext: complaintContextForOrder(conversationContext, registry.getActiveOrderFocus()?.requestedOrderId),
      remedyAuthorization: options.capabilities.remedyAuthorization,
    };
    // Missing customer data cannot be filled by model-invented proposal arguments.
    if (missingAddress) {
      for (let index = proposedActions.length - 1; index >= 0; index--) {
        if (proposedActions[index].action === "update_address") proposedActions.splice(index, 1);
      }
    }
    // A later live-state gate cannot leave an earlier proposal eligible.
    for (let index = proposedActions.length - 1; index >= 0; index--) {
      if (!validateActionProposal(proposedActions[index], actionContext).valid) proposedActions.splice(index, 1);
    }
    const actionDecision = operationalDecision || (requirements[0]?.field === "photo" && intakeDecision) ? null
      : intentDecision ?? boundedActionDecision(registry.getResults(), proposedActions, inferResponseLocale(options.message));
    const boundaryOutput = operationalDecision ?? actionDecision ?? addressQuestion ?? intakeDecision ?? confirmedProposal;
    if (actionDecision) pushEvent(trace, "action_decision", { action: actionDecision.action,
      outcome: actionDecision.outcome, eligibility: actionDecision.eligibility, proposal_allowed: false }, now());
    else if (missingAddress) pushEvent(trace, "action_decision", { action: "update_address",
      outcome: "required_argument", eligibility: missingAddress.eligibility, proposal_allowed: false }, now());
    const responseContext = {
      ...registry,
      operationalScope: options.operational ? { workspaceId: options.tenant.workspaceId, shopId: options.tenant.shopId ?? "", caseId: options.tenant.caseId, customerEmail: options.tenant.customerEmail ?? "" } : undefined,
      turnIR: effectiveTurnIR ? { ...effectiveTurnIR, answerRequests: readOnlyIR?.answerRequests ?? effectiveTurnIR.answerRequests } : readOnlyIR ?? undefined,
      caseState: conversationContext.caseState,
      evidenceScope: { workspaceId: options.tenant.workspaceId, shopId: options.tenant.shopId ?? "" }, preciseRequests, preciseReadResults,
      knownCaseArguments: [...(conversationContext.activeOrder ? ["order_id"] : []),
        ...(conversationContext.caseState?.scope.customerEmail ? ["customer_email"] : []),
        ...(conversationContext.caseState?.address?.complete ? ["address"] : []),
        ...(new Set((registry.getActiveOrderFocus()?.order?.fulfillments ?? []).map(f => f.trackingNumber).filter(Boolean)).size === 1 ? ["tracking_number"] : [])],
      confirmedAction: (action: string) => confirmedCaseAction(conversationContext, action),
      proposedActions,
      activeOrder: registry.getActiveOrderFocus(),
      customerMessage: options.message,
      interactionChannel: options.interactionChannel,
      customerName: verifiedProfileName,
      customerDisplayName,
      trustedCustomerIdentity: {
        verified: Boolean(options.tenant.customerEmail?.trim()),
        hasEmail: Boolean(options.tenant.customerEmail?.trim()),
        hasName: Boolean(verifiedProfileName?.trim()),
      },
      customerProvidedContext,
    };
    let validatedOutput = validateStructuredResponse(boundaryOutput?.structuredOutput ?? result?.finalOutput, responseContext);
    if (!boundaryOutput && options.operational && turnIR?.orderContext === "status") {
      const trackingFacts = registry.getResults().filter(record => record.toolName === "get_tracking" && record.result.status === "ok").flatMap(record => {
        const data = record.result.data as JsonObject; const live = data?.live_tracking as JsonObject;
        const event = live?.latestEvent as JsonObject;
        return [["shipment_status", "live_tracking.status", live?.status], ["shipment_event", "live_tracking.latestEvent.description", event?.description], ["shipment_eta", "live_tracking.estimatedDelivery", live?.estimatedDelivery], ["shipment_timestamp", "live_tracking.latestEvent.timestamp", event?.timestamp], ["shipment_location", "live_tracking.latestEvent.location", event?.location]]
          .filter(([, , value]) => value && value !== "unknown").map(([kind, path]) => ({ type: "fact", fact_kind: kind, evidence: [{ result_id: record.resultId, field_paths: [path] }] }));
      });
      if (!trackingFacts.some(fact => fact.fact_kind === "shipment_status") && !validatedOutput.approvedSegments.some(segment => segment.type === "fact" && segment.fact_kind === "order_fulfillment_status")) {
        const orderEvidence = registry.getResults().find(record => record.toolName === "get_order" && record.result.status === "ok");
        if (orderEvidence) trackingFacts.push({ type: "fact", fact_kind: "order_fulfillment_status", evidence: [{ result_id: orderEvidence.resultId, field_paths: ["fulfillmentStatus"] }] });
      }
      for (const fact of trackingFacts) {
        if (validatedOutput.approvedSegments.some(segment => JSON.stringify(segment) === JSON.stringify(fact))) continue;
        const addition = validateStructuredResponse({ segments: [fact] }, responseContext);
        validatedOutput = { ...validatedOutput, approvedSegments: [...validatedOutput.approvedSegments, ...addition.approvedSegments], rejectedSegments: [...validatedOutput.rejectedSegments, ...addition.rejectedSegments] };
      }
    }
    if (!boundaryOutput && !validatedOutput.approvedSegments.length && turnIR?.orderContext === "status"
      && responseContext.activeOrder?.state === "verified" && responseContext.activeOrder.order) {
      const evidence = registry.getResults().find(record => record.toolName === "get_order" && record.result.status === "ok");
      if (evidence) validatedOutput = validateStructuredResponse({ segments: [{ type: "fact", fact_kind: "order_fulfillment_status",
        evidence: [{ result_id: evidence.resultId, field_paths: ["fulfillmentStatus"] }] }] }, responseContext);
    }
    // Completeness recovery cannot replace an action-boundary decision with an ineligible action path.
    if (!boundaryOutput) await recoverPreciseReads();
    let validation = preserveMaterialPolicyEvidence(boundaryOutput ? validatedOutput : ensureAnswerCompleteness(validatedOutput, responseContext), responseContext);
    const renderedCoverage = renderWithAnswerCoverage(validation, { ...responseContext, locale: inferResponseLocale(options.message), customerDisplayName, firstResponse: !(options.history?.length) && !(conversationContext?.turn) });
    validation = renderedCoverage.validation;
    const useAuthoritativeFallback = !boundaryOutput && shouldPreferAuthoritativeEvidenceFallback(validation, responseContext);
    if (options.enableDevDiagnostics && modelDiagnostics) {
      const evidence = evidenceDiagnostics(registry);
      const recovery = recoverySummary(validation);
      const fallbackReason = useAuthoritativeFallback
        ? "approved_segments_do_not_resolve_intent"
        : validation.approvedSegments.length
        ? null
        : modelDiagnostics.structured_parse_failed
          ? "structured_parse_failed"
          : validation.rejectedSegments.length
            ? "contract_rejected_segments"
            : "no_approved_segments";
      trace.diagnostics = traceValue({
        turn_ir_unavailable: turnIR === null,
        question_shape: diagnosticQuestionShape(options.message),
        ...evidence,
        validation: summarizeResponseValidation(validation, { includeCompleteness: options.enableDevDiagnostics === true }),
        model_output: preModelBoundary ? null : modelDiagnostics,
        model_response_mode: preModelBoundary ? "not_run" : modelDiagnostics.response_mode,
        intent_resolved_by_approved_segment: validation.completenessDiagnostics?.intent_resolved_by_approved_segment ?? null,
        completeness_check_entered: validation.completenessDiagnostics?.entered === true,
        ...recovery,
        fallback_reason: fallbackReason,
        final_composition_source: boundaryOutput ? (operationalDecision ? "operational_execution" : intakeDecision || confirmedProposal ? "case_state_boundary" : "action_boundary") : responseCompositionSource(modelDiagnostics, validation, useAuthoritativeFallback),
      }) as JsonObject;
    }
    const actionExecutions = operationalOutcome ? [{ mode: operationalOutcome.mode, action: operationalOutcome.action,
      target: { order_id: operationalOutcome.command?.orderReference ?? registry.getActiveOrderFocus()?.requestedOrderId ?? null }, arguments: traceValue(operationalOutcome.command ?? {}) as JsonObject,
      proposal_status: "proposed" as const, validation_status: operationalOutcome.eligible ? "validated" as const : "blocked" as const,
      execution_status: operationalOutcome.status === "SIMULATED" ? "simulated_success" as const : operationalOutcome.status === "EXECUTED" ? "executed" as const : operationalOutcome.status === "PROPOSED" ? "hitl" as const : "blocked" as const,
      would_execute: operationalOutcome.eligible && operationalOutcome.permission === "auto" && operationalOutcome.providerCapable,
      executed: operationalOutcome.executed, validation_checks: [], reason: operationalOutcome.reason, operational: operationalOutcome }] : await executeActionProposals({
      executor: options.actionExecutor,
      proposals: proposedActions,
      approvedSegments: validation.approvedSegments,
      context: actionContext,
    });
    for (const execution of actionExecutions) pushEvent(trace, "action_execution", execution, now());
    const responseWithoutSignature = validation.approvedSegments.length && !useAuthoritativeFallback
      ? renderedCoverage.response
      : fallbackResponse({
          activeOrder: responseContext.activeOrder,
          locale: inferResponseLocale(options.message),
          customerMessage: options.message,
          customerProvidedContext: responseContext.customerProvidedContext,
          interactionChannel: responseContext.interactionChannel,
          getResults: registry.getResults,
        });
    const response = composeGreenfieldResponse(responseWithoutSignature, options.signature, options.message);
    pushEvent(trace, "final_response", {
      response,
      proposed_actions: proposedActions,
      action_executions: actionExecutions,
      structured_response: validation.parsed,
      validation: summarizeResponseValidation(validation, { includeCompleteness: options.enableDevDiagnostics === true }),
    }, now());
    if (operationalOutcome?.readBackVerified && conversationContext.caseState) {
      // Completed intent is not authority for a later edit of the same order.
      const state = { ...conversationContext.caseState };
      delete state.pendingAction; delete state.requestedChange; delete state.actionConfirmation;
      delete state.orderConfirmation; delete state.address; delete state.lineChange;
      conversationContext = { ...conversationContext, caseState: state };
    }
    if (!useAuthoritativeFallback) {
      const closed = completeReadOnlyAnswers(conversationContext, readOnlyAnswers.bindings, validation);
      if (readOnlyAnswers.bindings.length) pushEvent(trace, "case_state", { diagnostic: "read_only_answer_coverage",
        closed, pending: conversationContext.caseState?.pendingReadOnlyAnswers?.map(value => value.id) }, now());
    }
    trace.finishedAt = now();
    return {
      response,
      proposedActions,
      actionExecutions,
      trace,
      conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message, [], registry.getOrderCandidates()),
    };
  } catch (error) {
    pushEvent(trace, "error", { code: "agent_failed", message: error instanceof Error ? error.message : "Agent failed." }, now());
    if (options.enableDevDiagnostics) {
      trace.diagnostics = traceValue({
        turn_ir_unavailable: turnIR === null,
        question_shape: diagnosticQuestionShape(options.message),
        ...evidenceDiagnostics(registry),
        validation: null,
        model_output: null,
        model_response_mode: "fallback",
        completeness_check_entered: false,
        recovery_attempted: false,
        recovery_type: [],
        recovery_result: "skipped",
        fallback_reason: "agent_error",
        final_composition_source: "fallback",
      }) as JsonObject;
    }
  }

  const fallback = fallbackResponse({
    activeOrder: registry.getActiveOrderFocus(),
    locale: inferResponseLocale(options.message),
    customerMessage: options.message,
    customerProvidedContext,
    interactionChannel: options.interactionChannel,
    getResults: registry.getResults,
  });
  const response = composeGreenfieldResponse(fallback, options.signature, options.message);
  pushEvent(trace, "final_response", { response, proposed_actions: proposedActions, action_executions: [], fallback: true }, now());
  trace.finishedAt = now();
  return {
    response,
    proposedActions,
    actionExecutions: [],
    trace,
    conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message, [], registry.getOrderCandidates()),
  };
}
