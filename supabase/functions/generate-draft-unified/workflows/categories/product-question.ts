import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildProductDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "product_question",
    promptHint:
      "WORKFLOW: Product question. Svar konkret på produktspørgsmålet med kendt kontekst og undgå unødvendige ordre-actions.",
    systemHint:
      "Workflow er Product question: default til reply uden mutations medmindre kunden beder om ordreændring.",
    promptBlocks: [
      "PRODUCT QUESTION FOCUS:\n- Svar direkte på produktspørgsmålet med kendte fakta.\n- Undgå handlinger der ændrer ordren.",
    ],
    systemRules: [
      "Tillad kun read-only actions og interne noter/tags i product-question workflow.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "fetch_tracking",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
      "resend_confirmation_or_invoice",
    ],
  };
}

