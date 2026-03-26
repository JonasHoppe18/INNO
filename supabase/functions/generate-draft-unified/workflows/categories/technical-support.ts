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
      "- Do NOT summarize or restate the customer's problem back to them — they know what their problem is. Go straight to the response or next step.\n" +
      "- Acknowledge the exact symptom the customer described.\n" +
      "- Provide concrete troubleshooting steps from the product knowledge base (numbered list if multiple steps).\n" +
      "- If the knowledge base has no relevant steps, ask specific diagnostic questions (e.g. firmware version, paired device/OS).\n" +
      "- Do NOT mention returns, exchanges, or refunds unless troubleshooting is exhausted and explicitly grounded in the approved context.\n" +
      "- Do NOT add a signature.",
      "NO-ORDER / THIRD-PARTY PURCHASE RULES:\n" +
      "- If there is no order data and the product was purchased elsewhere (e.g. ProShop, retailer), do NOT pretend you can look up the order.\n" +
      "- Be concise: state once what you cannot do, then state the single next step (e.g. send proof of purchase).\n" +
      "- Do NOT repeat the same limitation twice in the same reply.\n" +
      "- Do NOT use filler like 'Vi vil gerne hjælpe dig med at finde en løsning' — either give the solution or explain the next step directly.\n" +
      "- Keep the reply to 2-3 short sentences when there is no KB data and no order context.",
    ],
    systemRules: [
      "Never suggest return_order, create_exchange_request, refund_order, or cancel_order as a first response in the technical support workflow.",
      "Never close with 'Jeg ser frem til at høre fra dig' or any forward-looking hollow phrase.",
      "Never repeat the same limitation or fact twice in the same reply.",
      "When no order data and no KB steps exist, keep the reply to 2-3 sentences maximum.",
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
