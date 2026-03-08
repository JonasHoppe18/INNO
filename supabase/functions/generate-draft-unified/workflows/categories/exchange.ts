import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildExchangeDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "exchange",
    promptHint:
      "WORKFLOW: Exchange. Fokuser på bytteflow (vare/størrelse/variant) og returner passende create_exchange_request-action når muligt.",
    systemHint:
      "Workflow er Exchange: foretræk create_exchange_request når data er tilstrækkelig.",
    promptBlocks: [
      "EXCHANGE FOCUS:\n- Vælg bytte-løsning (variant/størrelse) når muligt.\n- Prioriter ombytning fremfor interne noter.",
    ],
    systemRules: [
      "Foretræk create_exchange_request; undgå refund-only svar medmindre kunden specifikt beder om refund.",
    ],
    allowedActionTypes: [
      "create_exchange_request",
      "edit_line_items",
      "lookup_order_status",
      "fetch_tracking",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
    forceReturnDetailsFlow: true,
  };
}

