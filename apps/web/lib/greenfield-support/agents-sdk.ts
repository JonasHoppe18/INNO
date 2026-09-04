import { Agent, Runner, tool, withTrace } from "@openai/agents";
import type { AgentInputItem, Model } from "@openai/agents";
import { fallbackResponse } from "./agent";
import { GREENFIELD_DEVELOPER_INSTRUCTIONS, instructionsForCapabilities } from "./instructions";
import { createCapabilityRegistry, extractOrderReferences } from "./capabilities";
import { GREENFIELD_TOOL_DEFINITIONS } from "./tool-contracts";
import { inferResponseLocale, renderResponseSegments, StructuredResponseSchema, summarizeResponseValidation, validateStructuredResponse } from "./response-contract";
import type {
  AgentRunResult,
  AgentTrace,
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
  capabilities: Parameters<typeof createCapabilityRegistry>[0];
  maxTurns?: number;
  now?: () => string;
  model?: string | Model;
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

function inputItems(options: GreenfieldAgentsSdkOptions) {
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
    { role: "user" as const, content: options.message },
  ] as AgentInputItem[];
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
  const registry = createCapabilityRegistry({
    ...options.capabilities,
    orderReferences: options.capabilities.orderReferences ?? extractOrderReferences(options.message),
  });
  const instructions = instructionsForCapabilities(registry.manifest);
  trace.developerInstructions = instructions;
  const proposedActions: ProposedAction[] = [];
  const context: SonaAgentContext = { registry, trace, proposedActions, now };
  const maxTurns = Math.max(1, Math.min(options.maxTurns ?? 8, 12));
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.2";
  const agent = new Agent<SonaAgentContext, typeof StructuredResponseSchema>({
    name: "Sona Support Agent",
    instructions,
    model,
    outputType: StructuredResponseSchema,
    modelSettings: { parallelToolCalls: false },
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
      runtime: "@openai/agents",
      capabilities: GREENFIELD_TOOL_DEFINITIONS.map((definition) => ({
        name: definition.name,
        sensitivity: definition.sensitivity,
      })),
      capability_manifest: registry.manifest,
    },
    now(),
  );

  try {
    let result: any;
    await withTrace("Sona support agent", async () => {
      result = await runner.run(agent, inputItems(options), { context, maxTurns });
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
      pushEvent(trace, "final_response", { response, proposed_actions: proposedActions }, now());
      trace.finishedAt = now();
      return { response, proposedActions, trace };
    }

    const validation = validateStructuredResponse(result?.finalOutput, registry);
    const response = validation.approvedSegments.length
      ? renderResponseSegments(validation.approvedSegments, { ...registry, locale: inferResponseLocale(options.message) })
      : fallbackResponse();
    pushEvent(trace, "final_response", {
      response,
      proposed_actions: proposedActions,
      structured_response: validation.parsed,
      validation: summarizeResponseValidation(validation),
    }, now());
    trace.finishedAt = now();
    return { response, proposedActions, trace };
  } catch (error) {
    pushEvent(trace, "error", { code: "agent_failed", message: error instanceof Error ? error.message : "Agent failed." }, now());
  }

  const response = fallbackResponse();
  pushEvent(trace, "final_response", { response, proposed_actions: proposedActions, fallback: true }, now());
  trace.finishedAt = now();
  return { response, proposedActions, trace };
}
