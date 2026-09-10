import { GREENFIELD_TOOL_DEFINITIONS, PROPOSED_ACTION_TOOL_NAMES, parseToolArguments } from "./tool-contracts";
import type {
  ActionExecutionResult,
  ActionExecutor,
  ActionExecutorContext,
  ActionValidationCheck,
  JsonObject,
  ProposedAction,
} from "./types";
import type { ResponseSegment } from "./response-contract";

function normalizeOrderReference(value: unknown): string {
  return String(value ?? "").trim().replace(/^#/, "").toLowerCase();
}

function sameOrderReference(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeOrderReference(left);
  const normalizedRight = normalizeOrderReference(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function requiredString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedActionArguments(proposal: ProposedAction): JsonObject {
  const definition = GREENFIELD_TOOL_DEFINITIONS.find((tool) => tool.name === proposal.action);
  if (!definition) return {};
  return Object.fromEntries(
    Object.entries(proposal.arguments ?? {}).filter(([key]) => Object.prototype.hasOwnProperty.call(definition.parameters.properties, key)),
  ) as JsonObject;
}

function check(name: string, passed: boolean, detail: string): ActionValidationCheck {
  return { name, status: passed ? "passed" : "failed", detail };
}

export interface ActionValidationResult {
  valid: boolean;
  checks: ActionValidationCheck[];
  reason: string;
}

/**
 * Shared deterministic action validation. It is intentionally limited to
 * prerequisites represented by the current greenfield runtime; it does not
 * infer merchant policy or perform a mutation.
 */
export function validateActionProposal(proposal: ProposedAction, context: ActionExecutorContext): ActionValidationResult {
  const checks: ActionValidationCheck[] = [];
  const definitionAvailable = context.manifest.proposalOnlyTools.includes(proposal.action)
    && PROPOSED_ACTION_TOOL_NAMES.has(proposal.action);
  checks.push(check("capability_available", definitionAvailable, definitionAvailable
    ? "The action is available as a current proposal-only capability."
    : "The action is not available as a current proposal-only capability."));

  const scopeBound = Boolean(context.tenant.workspaceId)
    && context.tenant.workspaceId === context.verifiedWorkspaceId;
  checks.push(check("workspace_scope", scopeBound, scopeBound
    ? "The action is bound to the server-owned workspace scope."
    : "The action is not bound to the current workspace scope."));

  const customerVerified = requiredString(context.tenant.customerEmail);
  checks.push(check("customer_identity", customerVerified, customerVerified
    ? "A verified customer identity is present."
    : "A verified customer identity is required."));

  const parsed = parseToolArguments(proposal.action, JSON.stringify(proposal.arguments ?? {}));
  const argumentsValid = parsed.ok;
  let argumentMessage = "Action arguments are invalid.";
  if (parsed.ok) argumentMessage = "All action arguments match the current strict tool schema.";
  else {
    const failedParse = parsed as { ok: false; result: { error?: { message?: string } } };
    argumentMessage = failedParse.result.error?.message || argumentMessage;
  }
  checks.push(check("required_arguments", argumentsValid, argumentMessage));

  const args = parsed.ok ? parsed.value : (proposal.arguments ?? {});
  const orderId = String(args.order_id ?? "").trim();
  const orderVerified = context.activeOrder?.state === "verified" && Boolean(context.activeOrder.requestedOrderId);
  checks.push(check("verified_order", orderVerified, orderVerified
    ? "The current customer order is verified."
    : "The exact customer order must be verified before proposing this action."));

  const orderMatches = orderVerified && sameOrderReference(orderId, context.activeOrder?.requestedOrderId)
    && (!context.activeOrder?.order?.orderNumber || sameOrderReference(orderId, context.activeOrder.order.orderNumber));
  checks.push(check("order_scope", orderMatches, orderMatches
    ? "The action targets the verified current order."
    : "The action order does not match the verified current order."));

  const actionArgumentsValid = ["cancel_order", "update_address", "create_return", "create_refund", "send_replacement"].includes(proposal.action)
    ? requiredString(args.reason)
    : false;
  checks.push(check("action_details", actionArgumentsValid, actionArgumentsValid
    ? "The action-specific reason is present."
    : "A customer-stated reason is required."));

  if (proposal.action === "update_address") {
    const valid = requiredString(args.address);
    checks.push(check("address_details", valid, valid ? "The complete new address is present." : "The complete new address is required."));
  }

  if (proposal.action === "create_return") {
    const itemIds = Array.isArray(args.item_ids) ? args.item_ids.filter(requiredString) : [];
    const orderItems = context.activeOrder?.order?.items ?? [];
    const valid = itemIds.length > 0 && (!orderItems.length || itemIds.every((itemId) => orderItems.some((item) => sameOrderReference(item.id, itemId))));
    checks.push(check("return_items", valid, valid
      ? "The requested return items are present on the verified order."
      : "At least one verified order item is required for a return proposal."));
  }

  if (proposal.action === "send_replacement") {
    const itemId = String(args.item_id ?? "").trim();
    const orderItems = context.activeOrder?.order?.items ?? [];
    const valid = requiredString(itemId) && (!orderItems.length || orderItems.some((item) => sameOrderReference(item.id, itemId)));
    checks.push(check("replacement_item", valid, valid
      ? "The replacement item is present on the verified order."
      : "A verified order item is required for a replacement proposal."));
  }

  const failed = checks.find((item) => item.status === "failed");
  return { valid: !failed, checks, reason: failed?.detail || "The action is valid for a dry-run." };
}

export class PlaygroundDryRunExecutor implements ActionExecutor {
  async execute(proposal: ProposedAction, context: ActionExecutorContext): Promise<ActionExecutionResult> {
    const validation = validateActionProposal(proposal, context);
    const orderId = String(proposal.arguments?.order_id ?? "").trim().replace(/^#/, "") || null;
    return {
      mode: "dry_run",
      action: proposal.action,
      target: { order_id: orderId },
      arguments: normalizedActionArguments(proposal),
      proposal_status: "proposed",
      validation_status: validation.valid ? "validated" : "blocked",
      execution_status: validation.valid ? "dry_run_success" : "blocked",
      would_execute: validation.valid,
      executed: false,
      validation_checks: validation.checks,
      reason: validation.valid
        ? "Playground simulation only. No provider mutation was attempted."
        : validation.reason,
    };
  }
}

export async function executeActionProposals({
  executor,
  proposals,
  approvedSegments,
  context,
}: {
  executor?: ActionExecutor;
  proposals: ProposedAction[];
  approvedSegments: ResponseSegment[];
  context: ActionExecutorContext;
}): Promise<ActionExecutionResult[]> {
  if (!executor) return [];
  const approvedActions = new Set(
    approvedSegments
      .filter((segment): segment is Extract<ResponseSegment, { type: "action_offer" }> => segment.type === "action_offer")
      .map((segment) => segment.capability),
  );
  const results: ActionExecutionResult[] = [];
  for (const proposal of proposals) {
    if (!approvedActions.has(proposal.action)) continue;
    results.push(await executor.execute(proposal, context));
  }
  return results;
}
