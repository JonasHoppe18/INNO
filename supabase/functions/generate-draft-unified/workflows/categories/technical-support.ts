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
      "- Your PRIMARY goal is to RESOLVE the issue. You are the expert — act like one.\n" +
      "- Do NOT summarize or restate the customer's problem back to them — they know what their problem is. Go straight to the response or next step.\n" +
      "- Acknowledge the exact symptom the customer described.\n" +
      "- If the knowledge base contains troubleshooting steps, firmware update procedures, setup guides, or diagnostic instructions relevant to the issue, provide them directly in a numbered list. Do NOT ask the customer for more info when you already have the answer.\n" +
      "- CRITICAL: When the knowledge base contains a numbered list of steps, include EVERY step in that list — do not skip, merge, combine, or abbreviate any step, even if it seems obvious or redundant. A customer following your instructions must be able to execute each step exactly. If step 1 is 'reset the dongle by holding the button until the LED turns purple', that step must appear in your reply.\n" +
      "- The knowledge base may be in English even if the customer writes in Danish — always check for relevant knowledge regardless of language mismatch, and deliver the steps in the customer's language.\n" +
      "- Reference specific software tools, settings, or firmware versions from the knowledge context when available.\n" +
      "- PRODUCT ACCURACY: Use ONLY knowledge base entries that match the exact product variant the customer names. If a knowledge entry explicitly identifies itself as being for a DIFFERENT product variant than what the customer has (e.g. the entry says 'A-Spire Wireless' but the customer has 'A-Spire'), DO NOT use any steps from that entry — skip it entirely, even if it is the only detailed guide in the context. Different variants have completely different hardware and procedures. If no matching steps exist in the knowledge base, give only universal basic steps and offer warranty replacement.\n" +
      "- KNOWLEDGE ONLY: When knowledge base steps are available, use ONLY those steps — do not mix in generic troubleshooting from your training data. Generic steps (charging, Bluetooth pairing, restarts) are only acceptable if the knowledge base has no relevant content AND the product type makes them applicable.\n" +
      "- ALWAYS give the troubleshooting steps immediately. Do NOT ask the customer what they have already tried. Just give the steps — they can skip any they have already done.\n" +
      "- If the knowledge base has no relevant steps, offer only product-appropriate universal troubleshooting (e.g. try different cable for wired, check charge level for wireless) and offer warranty replacement if the problem persists.\n" +
      "- NEVER refer the customer to 'a professional', 'a technician', or 'have it inspected'. You ARE the support team. If remote troubleshooting fails, offer RMA/replacement/return under warranty.\n" +
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
      "Never close with 'Jeg ser frem til at høre fra dig', 'Giv besked om fejlfindingen', or any forward-looking hollow phrase.",
      "Never repeat the same limitation or fact twice in the same reply.",
      "When no order data and no KB steps exist, keep the reply to 2-3 sentences maximum.",
      "Never ask the customer what troubleshooting steps they have already tried. Always give the steps directly — they can skip steps already attempted.",
      "Never ask about LED behavior, power button behavior, or other diagnostic questions when the knowledge base already has troubleshooting steps.",
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
