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
      "PRODUCT QUESTION FOCUS:\n" +
      "- Do NOT summarize or restate the customer's problem back to them — go straight to the answer or next step.\n" +
      "- Answer the product question directly with known facts from the knowledge base. Use specific product names, features, and specifications.\n" +
      "- If the knowledge base contains product details (specs, compatibility, features, usage guides), use them to give a thorough answer. Do NOT give generic advice when specific information is available.\n" +
      "- If there is no order data and the product was purchased elsewhere, state once what you cannot do, then give the single next step in 1-2 sentences.\n" +
      "- Do NOT use filler like 'Vi vil gerne hjælpe dig med at finde en løsning' — either give the answer or explain the next step directly.\n" +
      "- Do not add actions that mutate the order.",
    ],
    systemRules: [
      "Tillad kun read-only actions og interne noter/tags i product-question workflow.",
      "Never summarize the customer's problem back to them.",
      "Never use filler phrases like 'Vi vil gerne hjælpe' without an immediate concrete next step in the same sentence.",
      "When no order data and no KB answer exist, keep the reply to 2-3 sentences maximum.",
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

