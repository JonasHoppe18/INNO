import { GREENFIELD_DEVELOPER_INSTRUCTIONS, instructionsForCapabilities } from "./instructions";
import { executeActionProposals } from "./action-executor";
import type {
  AgentRunResult,
  ActionExecutor,
  AgentTrace,
  ConversationContext,
  GreenfieldInteractionChannel,
  GreenfieldModel,
  JsonValue,
  ModelResponse,
  ProposedAction,
  TenantContext,
  ToolExecutionResult,
  TraceEvent,
} from "./types";
import { createCapabilityRegistry, extractOrderReferences } from "./capabilities";
import { GREENFIELD_TOOL_DEFINITIONS } from "./tool-contracts";
import {
  composeSafeKnowledgeGapResponse,
  inferResponseLocale,
  renderResponseSegments,
  summarizeResponseValidation,
  validateStructuredResponse,
} from "./response-contract";
import type { ResponseEvidenceRecord, ResponseValidationContext } from "./response-contract";
import { extractCustomerProvidedContext, modelConversationContext, nextConversationContext } from "./conversation-context";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GreenfieldAgentOptions {
  tenant: TenantContext;
  message: string;
  history?: ConversationMessage[];
  conversationContext?: ConversationContext;
  model: GreenfieldModel;
  capabilities: Parameters<typeof createCapabilityRegistry>[0];
  maxTurns?: number;
  now?: () => string;
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

function inputMessage(role: "user" | "assistant", content: string) {
  return { role, content };
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

export function keepActionStatusHonest(response: string, actions: ProposedAction[]): string {
  if (!actions.length) return response;
  const completionWords = /\b(cancelled|canceled|refunded|updated|created|sent|issued|processed|completed|done)\b/gi;
  const hasUnqualifiedCompletionClaim = Array.from(response.matchAll(completionWords)).some((match) => {
    const before = response.slice(Math.max(0, (match.index ?? 0) - 36), match.index ?? 0);
    return !/(not|never|cannot|can't|hasn't|haven't|pending|proposed|awaiting|would)\s*$/i.test(before);
  });
  const safeResponse = hasUnqualifiedCompletionClaim
    ? response.replace(completionWords, "requested")
    : response;
  const reminder = "This is only a proposal and has not been completed. Would you like me to submit it for confirmation?";
  return safeResponse.toLowerCase().includes("proposal") || safeResponse.toLowerCase().includes("not been completed")
    ? safeResponse
    : `${safeResponse}\n\n${reminder}`;
}

export function fallbackResponse(context?: {
  activeOrder?: ConversationContext["activeOrder"];
  locale?: "da" | "en";
  customerMessage?: string;
  customerProvidedContext?: ResponseValidationContext["customerProvidedContext"];
  getResults?: () => ResponseEvidenceRecord[];
}) {
  const requestedOrderId = context?.activeOrder?.requestedOrderId;
  if (context?.activeOrder?.state === "unresolved" && requestedOrderId) {
    const reference = ` #${requestedOrderId.replace(/^#/, "")}`;
    return context.locale === "da"
      ? `Jeg kunne ikke bekræfte ordre${reference}. Hvis du har et andet gyldigt ordrenummer eller en anden ordreidentifikator, må du gerne sende det.`
      : `I couldn’t verify order${reference}. If you have a different valid order number or order identifier, please share it.`;
  }
  const knowledgeGap = composeSafeKnowledgeGapResponse({
    locale: context?.locale,
    customerMessage: context?.customerMessage,
    customerProvidedContext: context?.customerProvidedContext,
    getResults: context?.getResults,
  });
  if (knowledgeGap) return knowledgeGap;
  return "I’m sorry, but I couldn’t safely complete that lookup right now. Could you try again in a moment?";
}

function responseUsage(response: ModelResponse) {
  return response.usage && typeof response.usage === "object" ? response.usage : null;
}

export async function runGreenfieldAgent(options: GreenfieldAgentOptions): Promise<AgentRunResult> {
  const started = new Date().toISOString();
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
  const input: unknown[] = [
    ...(options.history ?? []).map((message) => inputMessage(message.role, message.content)),
    inputMessage("user", continuityInput),
  ];
  const proposedActions: ProposedAction[] = [];
  const maxTurns = Math.max(1, Math.min(options.maxTurns ?? 8, 12));
  const now = options.now ?? (() => new Date().toISOString());

  pushEvent(trace, "agent_started", {
    message: options.message,
    history: options.history ?? [],
    conversation_context: continuityInput,
    capabilities: registry.definitions.map((tool) => ({ name: tool.name, sensitivity: tool.sensitivity })),
    capability_manifest: registry.manifest,
  }, now());

  try {
    for (let turn = 0; turn < maxTurns; turn += 1) {
      const modelStarted = Date.now();
      pushEvent(trace, "model_request", { turn, input }, now());
      const response = await options.model.complete({
        instructions,
        input,
        tools: registry.definitions,
      });
      const durationMs = Date.now() - modelStarted;
      if (responseUsage(response)) trace.usage.push(traceValue(responseUsage(response)) as Record<string, JsonValue>);
      pushEvent(trace, "model_response", { turn, duration_ms: durationMs, response }, now());

      if (response.type === "text") {
        const rawText = String(response.text ?? "").trim();
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
        const validation = validateStructuredResponse(rawText, responseContext);
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
        const finalResponse = validation.approvedSegments.length
          ? renderResponseSegments(validation.approvedSegments, {
              ...responseContext,
              locale: inferResponseLocale(options.message),
              customerName: options.tenant.customerName,
              firstResponse: !(options.history?.length) && !(conversationContext?.turn),
              proposedActions,
            })
          : fallbackResponse({
              activeOrder: registry.getActiveOrderFocus(),
              locale: inferResponseLocale(options.message),
              customerMessage: options.message,
              customerProvidedContext: responseContext.customerProvidedContext,
              getResults: registry.getResults,
            });
        pushEvent(trace, "final_response", {
          response: finalResponse,
          proposed_actions: proposedActions,
          action_executions: actionExecutions,
          structured_response: validation.parsed,
          validation: summarizeResponseValidation(validation),
        }, now());
        trace.finishedAt = now();
        return {
          response: finalResponse,
          proposedActions,
          actionExecutions,
          trace,
          conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message),
        };
      }

      const toolCall = response.toolCall;
      pushEvent(trace, "tool_call", { turn, call_id: toolCall.callId, name: toolCall.name, arguments: toolCall.arguments }, now());
      const toolStarted = Date.now();
      const result = await registry.execute(toolCall.name, toolCall.arguments);
      const resultDurationMs = Date.now() - toolStarted;
      if (result.proposedAction && !proposedActions.some((action) => JSON.stringify(action) === JSON.stringify(result.proposedAction))) {
        proposedActions.push(result.proposedAction);
      }
      pushEvent(trace, "tool_result", { turn, call_id: toolCall.callId, name: toolCall.name, duration_ms: resultDurationMs, result }, now());
      input.push({ type: "function_call", call_id: toolCall.callId, name: toolCall.name, arguments: toolCall.arguments });
      input.push({ type: "function_call_output", call_id: toolCall.callId, output: serializeToolResult(result) });
    }

    pushEvent(trace, "error", { code: "max_turns", message: "The agent reached its maximum tool turns." }, now());
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
    conversationContext: nextConversationContext(conversationContext, registry.getActiveOrderFocus(), options.message),
  };
}
