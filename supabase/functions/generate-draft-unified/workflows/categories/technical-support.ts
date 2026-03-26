import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildTechnicalSupportDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "technical_support",
    promptHint:
      "WORKFLOW: Technical support. The customer has a hardware or software problem and wants help fixing it — NOT a return or exchange. " +
      "Acknowledge the specific symptom described. Use troubleshooting steps from the knowledge base. " +
      "If the knowledge base has steps, lead with them in a numbered list. Ask specific diagnostic questions only if no steps are available.",
    systemHint:
      "Workflow er Technical support: fokus på fejlfinding og løsning. Foreslå ALDRIG retur, bytte eller refusion som første svar.",
    promptBlocks: [
      "TECHNICAL SUPPORT FOCUS:\n" +
      "- Acknowledge the exact symptom the customer described.\n" +
      "- Provide concrete troubleshooting steps from the product knowledge base (numbered list if multiple steps).\n" +
      "- If the knowledge base has no relevant steps, ask specific diagnostic questions (e.g. firmware version, paired device/OS).\n" +
      "- Do NOT mention returns, exchanges, or refunds unless troubleshooting is exhausted and explicitly grounded in the approved context.\n" +
      "- Do NOT add a signature.",
    ],
    systemRules: [
      "Never suggest return_order, create_exchange_request, refund_order, or cancel_order as a first response in the technical support workflow.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
    forceReturnDetailsFlow: false,
  };
}
