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
      "CANCELLATION FOCUS:\n- Afgør først om ordren er annullerbar.\n- Hvis den allerede er sendt/fuldført, forklar kort begrænsningen og næste trin.",
    ],
    systemRules: [
      "Prioriter cancel_order over refund_order i cancellation-workflow.",
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

