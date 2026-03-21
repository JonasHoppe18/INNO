import type { Automation } from "./agent-context.ts";
import type { AutomationAction } from "./automation-actions.ts";
import { applyWorkflowActionPolicy } from "../generate-draft-unified/workflows/action-policy.ts";
import type { WorkflowRoute } from "../generate-draft-unified/workflows/types.ts";

export type ActionDecisionValidation = {
  version: 1;
  allowed_actions: AutomationAction[];
  removed_actions: Array<{ type: string; reason: string }>;
  approval_actions: Array<{ type: string; reason: string }>;
  decision: "reply_only" | "auto_action" | "approval_required";
  summary: string;
  address_update_action_selected?: boolean;
  technical_escalation_selected?: boolean;
};

type ValidateActionDecisionInput = {
  actions: AutomationAction[];
  workflowRoute: WorkflowRoute;
  selectedOrder?: Record<string, unknown> | null;
  automation?: Automation | null;
  blockRedundantSameThreadReturnContactActions?: boolean;
};

const SAME_THREAD_RETURN_CONTACT_RE = /\b(?:contact us(?: via| by)? e-?mail|email us|write to us at|support@\S+|notify us of your return|kontakt os(?: via| på)? e-?mail|skriv til os(?: på)? e-?mail|giv os besked om din retur)\b/i;

const LOW_RISK_ACTIONS = new Set([
  "add_note",
  "add_tag",
  "add_internal_note_or_tag",
  "lookup_order_status",
  "fetch_tracking",
]);

function approvalReasonForAction(type: string, automation?: Automation | null): string | null {
  const normalized = String(type || "").trim().toLowerCase();
  if (!normalized) return "missing_action_type";
  if (LOW_RISK_ACTIONS.has(normalized)) return null;
  if (
    [
      "update_shipping_address",
      "change_shipping_method",
      "hold_or_release_fulfillment",
      "edit_line_items",
      "update_customer_contact",
      "resend_confirmation_or_invoice",
    ].includes(normalized) &&
    !automation?.order_updates
  ) {
    return "order_updates_disabled";
  }
  if (normalized === "cancel_order" && !automation?.cancel_orders) {
    return "cancel_orders_disabled";
  }
  if (normalized === "refund_order" && !automation?.automatic_refunds) {
    return "automatic_refunds_disabled";
  }
  if (normalized === "create_exchange_request") {
    return "exchange_requires_approval";
  }
  return null;
}

export function validateActionDecision(
  input: ValidateActionDecisionInput,
): ActionDecisionValidation {
  const workflowFiltered = applyWorkflowActionPolicy(input.actions || [], input.workflowRoute);
  const selectedOrderId = Number(input.selectedOrder?.id ?? 0);
  const removed = [...workflowFiltered.removed];
  const prefilteredActions = (workflowFiltered.actions || []).filter((action) => {
    if (!input.blockRedundantSameThreadReturnContactActions) return true;
    const type = String(action?.type || "").trim().toLowerCase();
    const payload = action?.payload && typeof action.payload === "object" ? action.payload : {};
    const text = [
      String(action?.detail || ""),
      String(payload?.note || ""),
      String(payload?.message || ""),
      String(payload?.reason_notes || ""),
    ]
      .filter(Boolean)
      .join("\n");
    const isInternalAnnotation =
      type === "add_note" || type === "add_tag" || type === "add_internal_note_or_tag";
    if (isInternalAnnotation && SAME_THREAD_RETURN_CONTACT_RE.test(text)) {
      removed.push({ type, reason: "redundant_same_thread_return_contact_instruction" });
      return false;
    }
    return true;
  });
  const allowedActions: AutomationAction[] = [];
  const approvalActions: Array<{ type: string; reason: string }> = [];

  for (const action of prefilteredActions) {
    const type = String(action?.type || "").trim().toLowerCase();
    if (!type) continue;
    const actionOrderId = Number(action?.orderId ?? action?.payload?.order_id ?? action?.payload?.orderId ?? 0);
    const resolvedOrderId =
      Number.isFinite(actionOrderId) && actionOrderId > 0
        ? actionOrderId
        : Number.isFinite(selectedOrderId) && selectedOrderId > 0
        ? selectedOrderId
        : 0;
    if (!resolvedOrderId) {
      removed.push({ type, reason: "missing_order_context" });
      continue;
    }
    const approvalReason = approvalReasonForAction(type, input.automation);
    allowedActions.push({
      ...action,
      orderId: resolvedOrderId,
    });
    if (approvalReason) {
      approvalActions.push({ type, reason: approvalReason });
    }
  }

  const decision =
    allowedActions.length === 0
      ? "reply_only"
      : approvalActions.length > 0
      ? "approval_required"
      : "auto_action";
  const addressUpdateActionSelected = allowedActions.some((action) =>
    String(action?.type || "").trim().toLowerCase() === "update_shipping_address"
  );
  const technicalEscalationSelected = allowedActions.some((action) =>
    String(action?.type || "").trim().toLowerCase() === "create_exchange_request"
  );
  const hasKnownOrderContext = Number.isFinite(selectedOrderId) && selectedOrderId > 0;
  const summarySuffix =
    hasKnownOrderContext && decision !== "approval_required"
      ? " Known order context is already available; do not request basic identity details again."
      : "";

  return {
    version: 1,
    allowed_actions: allowedActions,
    removed_actions: removed,
    approval_actions: approvalActions,
    decision,
    address_update_action_selected: addressUpdateActionSelected,
    technical_escalation_selected: technicalEscalationSelected,
    summary:
      decision === "reply_only"
        ? `No executable actions remain after validation.${summarySuffix}`
        : decision === "approval_required"
        ? `Validated actions require approval or automation is disabled.${addressUpdateActionSelected ? " Shipping address update action selected." : ""}${technicalEscalationSelected ? " Technical escalation action selected." : ""}`
        : `Validated actions can continue to automation execution.${addressUpdateActionSelected ? " Shipping address update action selected." : ""}${technicalEscalationSelected ? " Technical escalation action selected." : ""}${summarySuffix}`,
  };
}
