import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildRefundDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "refund",
    promptHint:
      "WORKFLOW: Refund. Bekræft refund-policy og tidslinje fra policy/kontekst, og foreslå refund_order-action når anmodningen er tydelig.",
    systemHint:
      "Workflow er Refund: følg refund-policy strikt og undgå at love refunds uden policy-dækning.",
    promptBlocks: [
      "REFUND FOCUS:\n- Angiv refund-regler og forventet behandlingstid ud fra policy.\n- Foreslå refund_order/cancel_order når relevant.",
    ],
    systemRules: [
      "Undgå shipping/address-mutationer i refund-workflow.",
    ],
    allowedActionTypes: [
      "refund_order",
      "lookup_order_status",
      "fetch_tracking",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
      "resend_confirmation_or_invoice",
    ],
    forceReturnDetailsFlow: true,
  };
}
