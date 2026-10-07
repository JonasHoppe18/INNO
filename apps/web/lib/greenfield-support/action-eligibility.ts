import type { ActionExecutorContext, ConversationContext, ProposedAction } from "./types";

export interface ActionEligibility {
  eligible: boolean;
  authorized: boolean;
  reason: string;
  outcome: "proposal_allowed" | "non_action_guidance" | "assessment_required";
  requirements: Array<{ name: string; satisfied: boolean }>;
}

function reference(value: unknown) {
  return String(value ?? "").trim().replace(/^#/, "").toLowerCase();
}

/** Reuse complaint continuity only when it is not bound to a different order. */
export function complaintContextForOrder(context: ConversationContext | undefined, orderId: string | undefined): string | undefined {
  const previous = context?.activeOrder?.requestedOrderId;
  return !previous || reference(previous) === reference(orderId) ? context?.customerProvided?.issue : undefined;
}

/** Complaint context is server-owned customer wording, never action arguments. */
export function isComplaintContext(value: string): boolean {
  const asserted = value.replace(/\b(?:not|isn't|aren't|ikke|nicht)\s+(?:broken|damaged|defective|faulty|defekt|beskadiget)\b/gi, "");
  return /\b(?:broken|chipped|cracked|smashed|damaged?|defect(?:ive)?|faulty|wrong\s+(?:item|product|colou?r|variant)|received\s+(?:the\s+)?wrong|reklamation|beskadiget|defekt|forkert)\b/i.test(asserted)
    || /\bordered\b[\s\S]{0,180}\bbut\b[\s\S]{0,100}\b(?:got|received)\b/i.test(asserted);
}

/** Deterministic case eligibility, separate from technical capability and schema validation. */
export function actionEligibility(proposal: ProposedAction, context: ActionExecutorContext): ActionEligibility {
  const order = context.activeOrder?.order;
  const requirements: ActionEligibility["requirements"] = [];
  const require = (name: string, satisfied: boolean) => requirements.push({ name, satisfied });
  const states = [order?.status, order?.fulfillmentStatus].map(reference);
  const fulfillments = order?.fulfillments ?? [];
  const activeFulfillments = fulfillments.filter(f => !["cancelled", "canceled", "failure", "failed"].includes(reference(f.status)));
  const dispatched = states.some(s => ["partial", "partially_fulfilled", "fulfilled", "shipped", "in_transit", "delivered"].includes(s))
    || activeFulfillments.length > 0;
  const closed = states.some(s => ["cancelled", "canceled", "closed"].includes(s));
  const liveStateKnown = Boolean(order && states[0] && states[0] !== "unknown");
  require("operational_state_known", liveStateKnown);

  if (proposal.action === "cancel_order" || proposal.action === "update_address") {
    // These tools operate on the entire order. There is no remaining-line cancel/address tool.
    require("order_open", !closed);
    require("whole_order_unfulfilled", !dispatched);
    const eligible = requirements.every(r => r.satisfied);
    return {
      eligible, authorized: true,
      reason: eligible ? "The verified order has no dispatched fulfillment. Customer confirmation is still required."
        : !liveStateKnown ? "Current operational state is unavailable. Resolve live order state before offering this action."
        : closed ? "This order is closed. Use supported non-action guidance."
        : "This order has already been fulfilled at least in part. An order-wide address change or cancellation is unavailable. Use supported return or support guidance without requesting the same identity or address again.",
      outcome: eligible ? "proposal_allowed" : "non_action_guidance", requirements,
    };
  }

  const complaint = isComplaintContext([context.customerMessage, context.complaintContext].filter(Boolean).join(" "));
  const requiresAssessment = proposal.action === "create_refund" || proposal.action === "send_replacement"
    || (proposal.action === "create_return" && complaint);
  if (!requiresAssessment) {
    return { eligible: requirements.every(r => r.satisfied), authorized: true,
      reason: "Ordinary return proposal. Existing identity, item and confirmation checks still apply.",
      outcome: requirements.every(r => r.satisfied) ? "proposal_allowed" : "non_action_guidance", requirements };
  }

  const approval = context.remedyAuthorization;
  const requestedItems = proposal.action === "send_replacement" ? [String(proposal.arguments.item_id ?? "")]
    : proposal.action === "create_return" ? (Array.isArray(proposal.arguments.item_ids) ? proposal.arguments.item_ids.map(String) : [])
    : approval?.itemIds ?? [];
  const scopeMatches = Boolean(approval && context.tenant.shopId && approval.shopId && approval.workspaceId === context.tenant.workspaceId
    && approval.shopId === context.tenant.shopId && reference(approval.orderId) === reference(proposal.arguments.order_id)
    && approval.action === proposal.action);
  require("assessment_scope", scopeMatches);
  require("affected_items_identified", requestedItems.length > 0 && requestedItems.every(id =>
    Boolean(order?.items?.some(item => reference(item.id) === reference(id)))));
  require("assessment_item_scope", Boolean(approval && requestedItems.every(id => approval.itemIds.some(a => reference(a) === reference(id)))));
  require("assessment_evidence", Boolean(approval?.evidenceReferences.length));
  require("assessment_requirements", Boolean(approval?.requirements.length && approval.requirements.every(r => r.satisfied)));
  if (proposal.action === "create_refund") {
    const requested = Number(proposal.arguments.amount);
    const maximum = Number(approval?.maximumRefundAmount);
    require("authorized_refund_amount", String(proposal.arguments.amount ?? "").trim().length > 0
      && Number.isFinite(requested) && requested > 0 && Number.isFinite(maximum) && maximum > 0 && requested <= maximum);
  }
  if (complaint || proposal.action === "send_replacement") {
    const allFulfilled = states.some(s => ["fulfilled", "shipped", "in_transit", "delivered"].includes(s))
      && !states.some(s => ["partial", "partially_fulfilled"].includes(s));
    require("affected_items_fulfilled", allFulfilled || requestedItems.every(id => {
      const orderedQuantity = order?.items?.find(item => reference(item.id) === reference(id))?.quantity ?? 0;
      const fulfilledQuantity = activeFulfillments.filter(f => f.itemMappingStatus === "verified")
        .flatMap(f => f.items).filter(item => reference(item.orderLineItemId) === reference(id))
        .reduce((sum, item) => sum + item.quantity, 0);
      // The proposal schema has no quantity field, so a whole-line remedy needs the whole line fulfilled.
      return orderedQuantity > 0 && fulfilledQuantity >= orderedQuantity;
    }));
  }
  const authorized = Boolean(scopeMatches && approval?.approved && approval.decisionId.trim());
  const eligible = requirements.every(r => r.satisfied);
  return { eligible, authorized,
    reason: eligible && authorized ? "The scoped assessment requirements and explicit remedy authorization are satisfied. Customer confirmation is still required."
      : "This remedy requires a scoped assessment and explicit merchant authorization. A customer report or saying photos exist is not approval. Use known order and conversation facts, obtain only evidence required by the existing merchant process, and route assessment to support. Do not apply ordinary-return shipping charges to a complaint or offer a remedy before approval.",
    outcome: eligible && authorized ? "proposal_allowed" : "assessment_required", requirements };
}
