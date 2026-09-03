import { GREENFIELD_TOOL_DEFINITIONS, parseToolArguments } from "./tool-contracts";
import type {
  CommerceReadProvider,
  JsonObject,
  JsonValue,
  KnowledgeStore,
  ProposedAction,
  TenantContext,
  ToolExecutionResult,
} from "./types";

export interface CapabilityContext {
  tenant: TenantContext;
  knowledge: KnowledgeStore;
  commerce: CommerceReadProvider;
  now?: () => string;
}

function stringArg(args: JsonObject, key: string): string {
  return String(args[key] ?? "").trim();
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function providerStatus(value: JsonValue): "ok" | "not_found" {
  if (value && typeof value === "object" && !Array.isArray(value) && value.status === "not_found") return "not_found";
  return "ok";
}

function knowledgeResult(result: Awaited<ReturnType<KnowledgeStore["search"]>>, query: string): ToolExecutionResult {
  return {
    status: result.length ? "ok" : "not_found",
    data: {
      query,
      results: result.map(({ record, score, matchReason, rank, evidenceSections }, index) => ({
        title: record.title,
        knowledge_type: record.knowledgeType,
        authority: record.authority,
        score: Number(score.toFixed(4)),
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
        structured_data: record.structuredData,
      })),
    },
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

export function createCapabilityRegistry(context: CapabilityContext) {
  if (!context?.tenant?.workspaceId) throw new Error("Trusted workspace context is required.");

  return {
    definitions: GREENFIELD_TOOL_DEFINITIONS,
    async execute(toolName: string, rawArguments: string): Promise<ToolExecutionResult> {
      const parsed = parseToolArguments(toolName, rawArguments);
      if (parsed.ok === false) return parsed.result;
      const args = parsed.value;
      const query = stringArg(args, "query");
      try {
        switch (toolName) {
          case "search_policy":
            return knowledgeResult(await context.knowledge.search({ workspaceId: context.tenant.workspaceId, query, knowledgeTypes: ["policy"], limit: 5 }), query);
          case "search_product_knowledge":
            return knowledgeResult(await context.knowledge.search({ workspaceId: context.tenant.workspaceId, query, knowledgeTypes: ["product"], limit: 5 }), query);
          case "search_historical_cases":
            return knowledgeResult(await context.knowledge.search({ workspaceId: context.tenant.workspaceId, query, knowledgeTypes: ["historic_support"], limit: 3 }), query);
          case "get_brand_guidance":
            return knowledgeResult(await context.knowledge.search({ workspaceId: context.tenant.workspaceId, query, knowledgeTypes: ["brand"], limit: 3 }), query);
          case "get_procedure":
            return knowledgeResult(await context.knowledge.search({ workspaceId: context.tenant.workspaceId, query, knowledgeTypes: ["procedural"], limit: 5 }), query);
          case "get_order": {
            if (!context.tenant.customerEmail) {
              return { status: "missing_context", error: { code: "customer_identity_missing", message: "A verified customer identity is required before reading order data." } };
            }
            const order = await context.commerce.getOrder(stringArg(args, "order_id"));
            return order ? { status: "ok", data: jsonValue(order) } : { status: "not_found", data: { order_id: stringArg(args, "order_id") } };
          }
          case "get_order_history": {
            if (!context.tenant.customerEmail) return { status: "missing_context", error: { code: "customer_identity_missing", message: "The current customer's verified email is not available." } };
            const orders = await context.commerce.getOrderHistory(context.tenant.customerEmail);
            return { status: orders.length ? "ok" : "not_found", data: jsonValue({ orders }) };
          }
          case "get_customer": {
            const customer = await context.commerce.getCustomer();
            return customer ? { status: "ok", data: jsonValue(customer) } : { status: "not_found" };
          }
          case "get_product": {
            const product = jsonValue(await context.commerce.getProduct(query));
            return { status: providerStatus(product), data: product };
          }
          case "inspect_fulfillment":
            if (!context.tenant.customerEmail) {
              return { status: "missing_context", error: { code: "customer_identity_missing", message: "A verified customer identity is required before reading fulfillment data." } };
            }
            {
              const fulfillment = jsonValue(await context.commerce.inspectFulfillment(stringArg(args, "order_id")));
              return { status: providerStatus(fulfillment), data: fulfillment };
            }
          case "get_tracking": {
            if (!context.tenant.customerEmail) {
              return { status: "missing_context", error: { code: "customer_identity_missing", message: "A verified customer identity is required before reading tracking data." } };
            }
            const tracking = await context.commerce.getTracking(stringArg(args, "order_id"));
            return { status: tracking.length ? "ok" : "not_found", data: jsonValue({ tracking }) };
          }
          case "cancel_order":
            return proposedAction("cancel_order", args, stringArg(args, "reason"));
          case "update_address":
            return proposedAction("update_address", args, stringArg(args, "reason"));
          case "create_return":
            return proposedAction("create_return", args, stringArg(args, "reason"));
          case "create_refund":
            return proposedAction("create_refund", args, stringArg(args, "reason"));
          case "send_replacement":
            return proposedAction("send_replacement", args, stringArg(args, "reason"));
          default:
            return { status: "invalid_arguments", error: { code: "unknown_tool", message: `Unknown capability: ${toolName}` } };
        }
      } catch (error) {
        return {
          status: "error",
          error: {
            code: "capability_failed",
            message: error instanceof Error ? error.message : "Capability failed.",
          },
        };
      }
    },
  };
}
