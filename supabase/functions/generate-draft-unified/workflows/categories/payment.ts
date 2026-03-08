import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildPaymentDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "payment",
    promptHint:
      "WORKFLOW: Payment. Afklar betalings-/fakturaspørgsmålet konkret og hold svaret transaktionelt og præcist.",
    systemHint:
      "Workflow er Payment: fokusér på billing/invoice afklaring. Undgå ordre-mutationer som cancel/refund medmindre kunden udtrykkeligt beder om det.",
    promptBlocks: [
      "PAYMENT FOCUS:\n- Bekræft hvad der er sket (fx dobbelttræk, failed payment, faktura-spørgsmål).\n- Brug kun verificerbare oplysninger fra konteksten.",
    ],
    systemRules: [
      "Tillad primært read-only actions, resend_confirmation_or_invoice og interne noter/tags.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "resend_confirmation_or_invoice",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}

