import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildCancellationDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "cancellation",
    promptHint:
      "WORKFLOW: Cancellation. Bekræft om ordren stadig kan annulleres ud fra status og vælg cancel_order når det er muligt.",
    systemHint:
      "Workflow er Cancellation: prioriter cancel_order og undgå refund-flow medmindre kunden specifikt beder om refund.",
    promptBlocks: [
      "CANCELLATION FOCUS:\n- First determine whether the order can still be cancelled.\n- If the order has already shipped/fulfilled, briefly explain the limitation and the next step in the customer's language.\n- If the next step is a return, never direct the customer to email or contact a support address. They are already in the correct support thread. If customer input is needed, ask them to respond in this thread, phrased naturally in the customer's language.",
    ],
    systemRules: [
      "Prioriter cancel_order over refund_order i cancellation-workflow.",
      "When cancellation is blocked because the order has shipped/fulfilled: do not include a support email address or tell the customer to contact support by email. Use this thread as the channel, phrased naturally in the customer's language.",
    ],
    allowedActionTypes: [
      "cancel_order",
      "lookup_order_status",
      "fetch_tracking",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}
