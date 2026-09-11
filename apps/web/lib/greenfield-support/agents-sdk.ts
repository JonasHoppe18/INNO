import { Agent, Runner, tool, withTrace } from "@openai/agents";
import type { AgentInputItem, Model } from "@openai/agents";
import { fallbackResponse } from "./agent";
import { executeActionProposals } from "./action-executor";
import { GREENFIELD_DEVELOPER_INSTRUCTIONS, instructionsForCapabilities } from "./instructions";
import { createCapabilityRegistry, extractOrderReferences } from "./capabilities";
import { GREENFIELD_TOOL_DEFINITIONS } from "./tool-contracts";
import { inferResponseLocale, renderResponseSegments, StructuredResponseSchema, summarizeResponseValidation, validateStructuredResponse } from "./response-contract";
import { extractCustomerProvidedContext, modelConversationContext, nextConversationContext } from "./conversation-context";
import { resolveGreenfieldRuntimeConfig } from "./runtime-config";
import type {
  AgentRunResult,
  ActionExecutor,
  AgentTrace,
  ConversationContext,
  GreenfieldInteractionChannel,
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
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  conversationContext?: ConversationContext;
  capabilities: Parameters<typeof createCapabilityRegistry>[0];
  maxTurns?: number;
  now?: () => string;
  model?: string | Model;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;
  actionExecutor?: ActionExecutor;
  interactionChannel?: GreenfieldInteractionChannel;
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

function shouldPreloadProcedureEvidence(message: string): boolean {
  return /\b(?:not working|broken|damaged|defective|troubleshoot(?:ing)?|connect(?:ion|ing)?|pair(?:ing)?|reset|firmware|microphone|interference|issue|problem)\b/i.test(String(message ?? ""));
}

function policyEvidenceQuery(message: string): string {
  const categories = ["return", "refund", "warranty", "shipping", "delivery", "destination"]
    .filter((term) => new RegExp(`\\b${term}\\b`, "i").test(String(message ?? "")));
  return [String(message ?? "").trim(), ...categories, "policy"].filter(Boolean).join(" ");
}

function preloadedEvidenceInput(continuityInput: string, results: Array<{ tool: string; result: ToolExecutionResult }>): string {
  const evidence = results
    .filter(({ result }) => result.status === "ok" && result.resultId)
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
  const registry = createCapabilityRegistry({
    ...options.capabilities,
    customerMessage: options.message,
    conversationContext,
    orderReferences: options.capabilities.orderReferences ?? extractOrderReferences(options.message),
  });
  const continuityInput = modelConversationContext(
    conversationContext,
    registry.getActiveOrderFocus(),
    options.message,
    options.history ?? [],
    options.interactionChannel,
  );
  const instructions = instructionsForCapabilities(registry.manifest);
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
  if (hasPolicyRequest && shouldPreloadProcedureEvidence(options.message)) await preload("search_procedures", options.message);
  const modelInput = preloadedEvidenceInput(continuityInput, preloadedResults);

  try {
    let result: any;
    await withTrace("Sona support agent", async () => {
      result = await runner.run(agent, inputItems(options, modelInput), { context, maxTurns });
    });

    if (result?.runContext?.usage && typeof result.runContext.usage === "object") {
      trace.usage.push(traceValue(result.runContext.usage) as Record<string, JsonValue>);
    }
    pushEvent(
      trace,
      "model_response",
      {
        runtime: "@openai/agents",
        raw_response_count: Array.isArray(result?.rawResponses) ? result.rawResponses.length : 0,
        item_types: Array.isArray(result?.newItems) ? result.newItems.map((item: any) => item?.type).filter(Boolean) : [],
        interruptions: Array.isArray(result?.interruptions) ? result.interruptions.map((item: any) => ({ name: item?.name, call_id: item?.rawItem?.callId })) : [],
      },
      now(),
    );

    if (Array.isArray(result?.interruptions) && result.interruptions.length) {
      pushEvent(trace, "error", { code: "approval_required", message: "The SDK paused for tool approval; no action was executed." }, now());
      const response = "I’ve prepared an action for review, but it still needs confirmation before anything can be changed.";
      pushEvent(trace, "final_response", { response, proposed_actions: proposedActions, action_executions: [] }, now());
      trace.finishedAt = now();
      return {
        response,
        proposedActions,
        actionExecutions: [],
        trace,
        conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message, options.history ?? []),
      };
    }

    const responseContext = {
      ...registry,
      proposedActions,
      activeOrder: registry.getActiveOrderFocus(),
      customerMessage: options.message,
      interactionChannel: options.interactionChannel,
      trustedCustomerIdentity: {
        verified: Boolean(options.tenant.customerEmail?.trim()),
        hasEmail: Boolean(options.tenant.customerEmail?.trim()),
        hasName: Boolean(options.tenant.customerName?.trim()),
      },
      customerProvidedContext: extractCustomerProvidedContext(options.history ?? [], options.message, conversationContext?.customerProvided),
    };
    const validation = validateStructuredResponse(result?.finalOutput, responseContext);
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
    const response = validation.approvedSegments.length
      ? renderResponseSegments(validation.approvedSegments, {
          ...responseContext,
          locale: inferResponseLocale(options.message),
          customerName: options.tenant.customerName,
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
    pushEvent(trace, "final_response", {
      response,
      proposed_actions: proposedActions,
      action_executions: actionExecutions,
      structured_response: validation.parsed,
      validation: summarizeResponseValidation(validation),
    }, now());
    trace.finishedAt = now();
    return {
      response,
      proposedActions,
      actionExecutions,
      trace,
      conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message, options.history ?? []),
    };
  } catch (error) {
    pushEvent(trace, "error", { code: "agent_failed", message: error instanceof Error ? error.message : "Agent failed." }, now());
  }

  const response = fallbackResponse({
    activeOrder: registry.getActiveOrderFocus(),
    locale: inferResponseLocale(options.message),
    customerMessage: options.message,
    customerProvidedContext: extractCustomerProvidedContext(options.history ?? [], options.message, conversationContext?.customerProvided),
    getResults: registry.getResults,
  });
  pushEvent(trace, "final_response", { response, proposed_actions: proposedActions, action_executions: [], fallback: true }, now());
  trace.finishedAt = now();
  return {
    response,
    proposedActions,
    actionExecutions: [],
    trace,
    conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message, options.history ?? []),
  };
}
