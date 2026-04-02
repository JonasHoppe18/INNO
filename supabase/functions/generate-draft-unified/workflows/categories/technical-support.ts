import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildTechnicalSupportDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "technical_support",
    promptHint:
      "WORKFLOW: Technical support. The customer has a hardware or software problem and wants help fixing it. " +
      "Use ALL relevant knowledge base entries — combine them if multiple apply. " +
      "Present the knowledge faithfully: if the source is prose, write prose; if the source has a numbered list, reproduce it as a numbered list.",
    systemHint:
      "Workflow er Technical support: fokus på fejlfinding og løsning. Foreslå ALDRIG retur, bytte eller refusion som første svar.",
    promptBlocks: [
      "TECHNICAL SUPPORT RULES:\n" +
      "- Use ALL relevant knowledge entries for the customer's issue — include every piece of relevant advice.\n" +
      "- Present knowledge faithfully in the format it appears in the source. Prose stays prose. Numbered lists stay numbered lists. Do NOT invent steps that are not in the source.\n" +
      "- CRITICAL: When the knowledge base contains a numbered step-by-step procedure (e.g. re-pairing, factory reset, firmware update), include ALL steps verbatim. NEVER replace a detailed procedure with vague references like 'follow the user manual', 'see the pairing guide', or 'check the instructions'. The steps ARE the reply.\n" +
      "- When multiple knowledge entries cover the same issue at different levels of detail, prefer the MOST detailed entry — include its full procedure, then add supplementary tips from simpler entries afterward.\n" +
      "- PRODUCT ACCURACY: Prefer knowledge entries that match the exact product the customer names. If an entry is marked as being for a different variant (e.g. Wireless vs wired), use it only if no matching entry exists.\n" +
      "- The knowledge base may be in English even if the customer writes in Danish — translate the advice into the customer's language.\n" +
      "- WARRANTY/REPLACEMENT: Do NOT mention warranty replacement or RMA in a first reply. Give all available troubleshooting first. Only offer replacement in a follow-up after the customer confirms the steps failed.\n" +
      "- You ARE the support team. Never refer the customer to 'a professional' or 'a technician'. If remote troubleshooting fails, offer warranty replacement.\n" +
      "- Do NOT add a signature.",
      "NO-ORDER / THIRD-PARTY PURCHASE RULES:\n" +
      "- If there is no order data and the product was purchased elsewhere (e.g. ProShop, retailer), do NOT pretend you can look up the order.\n" +
      "- Be concise: state once what you cannot do, then state the single next step (e.g. send proof of purchase).\n" +
      "- Keep the reply to 2-3 short sentences when there is no KB data and no order context.",
    ],
    systemRules: [
      "Never suggest return_order, create_exchange_request, refund_order, or cancel_order as a first response in the technical support workflow.",
      "NEVER end a first-reply with a warranty replacement offer. Only offer replacement in follow-up replies after the customer confirms troubleshooting failed.",
      "Never close with hollow troubleshooting follow-up phrases like 'Giv besked om fejlfindingen' or 'Lad mig vide om du har prøvet trinene'. A warm close like 'Jeg ser frem til at høre fra dig' is fine.",
      "Never ask the customer what troubleshooting steps they have already tried. Always give the steps directly.",
      "NEVER replace a detailed numbered procedure from the knowledge base with a vague reference to 'the user manual', 'the pairing guide', or 'our instructions'. Always include the full steps inline in the reply.",
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
