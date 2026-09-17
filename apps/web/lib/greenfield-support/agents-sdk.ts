import { Agent, Runner, tool, withTrace } from "@openai/agents";
import type { AgentInputItem, Model } from "@openai/agents";
import { composeEmailBodyWithSignature, inferGermanLanguage, selectSignatureText } from "@/lib/server/email-signature";
import { fallbackResponse } from "./agent";
import { executeActionProposals } from "./action-executor";
import { GREENFIELD_DEVELOPER_INSTRUCTIONS, instructionsForCapabilities } from "./instructions";
import { createCapabilityRegistry, extractOrderReferences } from "./capabilities";
import { GREENFIELD_TOOL_DEFINITIONS } from "./tool-contracts";
import { ensureAnswerCompleteness, inferResponseLocale, renderResponseSegments, StructuredResponseSchema, summarizeResponseValidation, validateStructuredResponse } from "./response-contract";
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

interface SonaAgentContext {
  registry: CapabilityRegistry;
  trace: AgentTrace;
  proposedActions: ProposedAction[];
  now: () => string;
}

export interface GreenfieldAgentsSdkOptions {
  tenant: TenantContext;
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
  const normalizedResponse = String(response || "").trim();
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
  const answerSegments = segments.filter((segment) => ["fact", "knowledge_guidance", "procedure_guidance", "action_offer", "acknowledgement"].includes(segment.type));
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
    if (evidence.result.status === "ok" && (results.length > 0 || evidence.toolName !== "search_policy" && evidence.toolName !== "search_procedures")) {
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

function responseCompositionSource(modelDiagnostics: ReturnType<typeof modelOutputDiagnostics>, validation: ResponseValidationResult) {
  const recovery = recoverySummary(validation);
  if (!validation.approvedSegments.length) return "fallback";
  if (recovery.recovery_result === "recovered") return modelDiagnostics.response_mode === "answered" ? "mixed" : "recovered_evidence";
  return "model";
}

function createSdkTools(context: SonaAgentContext) {
  return GREENFIELD_TOOL_DEFINITIONS.map((definition) =>
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

function shouldPreloadProcedureEvidence(message: string, customerProvidedContext?: ReturnType<typeof extractCustomerProvidedContext>): boolean {
  return /\b(?:not working|broken|damaged|defective|troubleshoot(?:ing)?|connect(?:ion|ing)?|pair(?:ing)?|reset|firmware|microphone|interference|issue|problem)\b/i.test([
    message,
    customerProvidedContext?.issue,
  ].filter(Boolean).join(" "));
}

function procedureEvidenceQuery(message: string, customerProvidedContext?: ReturnType<typeof extractCustomerProvidedContext>): string {
  return [
    message,
    customerProvidedContext?.product,
    customerProvidedContext?.platform,
    customerProvidedContext?.issue,
  ].filter(Boolean).join(" ");
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
    tools: GREENFIELD_TOOL_DEFINITIONS,
    usage: [],
  };
  const conversationContext = options.conversationContext ?? options.capabilities.conversationContext;
  const customerProvidedContext = extractCustomerProvidedContext(
    options.history ?? [],
    options.message,
    conversationContext?.customerProvided,
  );
  const registry = createCapabilityRegistry({
    ...options.capabilities,
    customerMessage: options.message,
    conversationContext,
    orderReferences: options.capabilities.orderReferences ?? extractOrderReferences(options.message),
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
  const providerCustomer = !options.tenant.customerName && !options.customerDisplayName
    ? await options.capabilities.commerce.getCustomer().catch(() => null)
    : null;
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
  const agent = new Agent<SonaAgentContext, typeof StructuredResponseSchema>({
    name: "Sona Support Agent",
    instructions,
    model,
    outputType: StructuredResponseSchema,
    modelSettings: {
      parallelToolCalls: false,
      ...(runtimeConfig.reasoningEffort ? { reasoning: { effort: runtimeConfig.reasoningEffort } } : {}),
    },
    tools: createSdkTools(context),
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
      capabilities: GREENFIELD_TOOL_DEFINITIONS.map((definition) => ({
        name: definition.name,
        sensitivity: definition.sensitivity,
      })),
      capability_manifest: registry.manifest,
    },
    now(),
  );

  // These are read-only evidence lookups. Preload the explicitly signalled
  // policy/procedure segments so one agent can preserve each supported part
  // while also handling another request in the same turn. This adds no model
  // call, router, or second agent.
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
  continuityInput = modelConversationContext(
    conversationContext,
    registry.getActiveOrderFocus(),
    options.message,
    options.history ?? [],
    options.interactionChannel,
    registry.getOrderCandidates(),
  );
  const preload = async (toolName: "search_policy" | "search_procedures", query: string) => {
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
  };
  const hasPolicyRequest = shouldPreloadPolicyEvidence(options.message);
  if (hasPolicyRequest) await preload("search_policy", policyEvidenceQuery(options.message));
  if (shouldPreloadProcedureEvidence(options.message, customerProvidedContext)) {
    await preload("search_procedures", procedureEvidenceQuery(options.message, customerProvidedContext));
  }
  const modelInput = preloadedEvidenceInput(continuityInput, preloadedResults);

  try {
    let result: any;
    await withTrace("Sona support agent", async () => {
      result = await runner.run(agent, inputItems(options, modelInput), { context, maxTurns });
    });

    if (result?.runContext?.usage && typeof result.runContext.usage === "object") {
      trace.usage.push(traceValue(result.runContext.usage) as Record<string, JsonValue>);
    }
    const modelDiagnostics = options.enableDevDiagnostics ? modelOutputDiagnostics(result?.finalOutput) : null;
    pushEvent(
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
          question_shape: diagnosticQuestionShape(options.message),
          ...evidence,
          validation: null,
          model_output: modelDiagnostics,
          model_response_mode: modelDiagnostics.response_mode,
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
        conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message, options.history ?? [], registry.getOrderCandidates()),
      };
    }

    const responseContext = {
      ...registry,
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
      customerProvidedContext: extractCustomerProvidedContext(options.history ?? [], options.message, conversationContext?.customerProvided),
    };
    const validation = ensureAnswerCompleteness(
      validateStructuredResponse(result?.finalOutput, responseContext),
      responseContext,
    );
    if (options.enableDevDiagnostics && modelDiagnostics) {
      const evidence = evidenceDiagnostics(registry);
      const recovery = recoverySummary(validation);
      const fallbackReason = validation.approvedSegments.length
        ? null
        : modelDiagnostics.structured_parse_failed
          ? "structured_parse_failed"
          : validation.rejectedSegments.length
            ? "contract_rejected_segments"
            : "no_approved_segments";
      trace.diagnostics = traceValue({
        question_shape: diagnosticQuestionShape(options.message),
        ...evidence,
        validation: summarizeResponseValidation(validation, { includeCompleteness: options.enableDevDiagnostics === true }),
        model_output: modelDiagnostics,
        model_response_mode: modelDiagnostics.response_mode,
        completeness_check_entered: validation.completenessDiagnostics?.entered === true,
        ...recovery,
        fallback_reason: fallbackReason,
        final_composition_source: responseCompositionSource(modelDiagnostics, validation),
      }) as JsonObject;
    }
    const actionExecutions = await executeActionProposals({
      executor: options.actionExecutor,
      proposals: proposedActions,
      approvedSegments: validation.approvedSegments,
      context: {
        tenant: options.tenant,
        manifest: registry.manifest,
        activeOrder: registry.getActiveOrderFocus(),
        verifiedWorkspaceId: options.tenant.workspaceId,
      },
    });
    for (const execution of actionExecutions) pushEvent(trace, "action_execution", execution, now());
    const responseWithoutSignature = validation.approvedSegments.length
      ? renderResponseSegments(validation.approvedSegments, {
          ...responseContext,
          locale: inferResponseLocale(options.message),
          customerDisplayName,
          firstResponse: !(options.history?.length) && !(conversationContext?.turn),
          proposedActions,
        })
      : fallbackResponse({
          activeOrder: responseContext.activeOrder,
          locale: inferResponseLocale(options.message),
          customerMessage: options.message,
          customerProvidedContext: responseContext.customerProvidedContext,
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
    trace.finishedAt = now();
    return {
      response,
      proposedActions,
      actionExecutions,
      trace,
      conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message, options.history ?? [], registry.getOrderCandidates()),
    };
  } catch (error) {
    pushEvent(trace, "error", { code: "agent_failed", message: error instanceof Error ? error.message : "Agent failed." }, now());
    if (options.enableDevDiagnostics) {
      trace.diagnostics = traceValue({
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
    customerProvidedContext: extractCustomerProvidedContext(options.history ?? [], options.message, conversationContext?.customerProvided),
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
    conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message, options.history ?? [], registry.getOrderCandidates()),
  };
}
