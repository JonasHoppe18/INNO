// supabase/functions/generate-draft-v2/stages/planner.ts
import { CaseState } from "./case-state-updater.ts";
import { resolveReplyLanguage } from "./language.ts";
import { callOpenAIJson } from "./openai-json.ts";

export type ResolutionStage =
  | "troubleshoot_first"
  | "request_evidence"
  | "initiate_warranty_repair"
  | "cancel_order"
  | "refund_or_exchange"
  | "info_only"
  | "escalate_human";

export interface Plan {
  primary_intent: string;
  resolution_stage: ResolutionStage;
  sub_queries: string[];
  required_facts: string[];
  skills_to_consider: string[];
  confidence: number;
  language: string;
}

export interface PlannerInput {
  caseState: CaseState;
  latestMessage: Record<string, unknown>;
  shop: Record<string, unknown>;
}

const FALLBACK_PLAN = (language: string): Plan => ({
  primary_intent: "other",
  resolution_stage: "info_only",
  sub_queries: [],
  required_facts: ["order_state"],
  skills_to_consider: [],
  confidence: 0.3,
  language,
});

const PLANNER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    primary_intent: {
      type: "string",
      enum: [
        "tracking",
        "return",
        "refund",
        "exchange",
        "cancel",
        "address_change",
        "product_question",
        "complaint",
        "thanks",
        "update",
        "other",
      ],
    },
    resolution_stage: {
      type: "string",
      enum: [
        "troubleshoot_first",
        "request_evidence",
        "initiate_warranty_repair",
        "cancel_order",
        "refund_or_exchange",
        "info_only",
        "escalate_human",
      ],
    },
    sub_queries: { type: "array", items: { type: "string" } },
    required_facts: { type: "array", items: { type: "string" } },
    skills_to_consider: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    language: {
      type: "string",
      enum: ["da", "en", "sv", "de", "fr", "nl", "no", "fi", "es", "it"],
    },
  },
  required: [
    "primary_intent",
    "resolution_stage",
    "sub_queries",
    "required_facts",
    "skills_to_consider",
    "confidence",
    "language",
  ],
};

export async function runPlanner(
  { caseState, latestMessage, shop }: PlannerInput,
): Promise<Plan> {
  const body =
    (latestMessage as { clean_body_text?: string }).clean_body_text ?? "";
  const shopName = (shop as { name?: string }).name ?? "shop";

  const systemPrompt =
    `You are a support ticket planning AI for ${shopName}. Output ONLY valid JSON.

Schema:
{
  "primary_intent": "tracking|return|refund|exchange|address_change|product_question|complaint|thanks|update|other",
  "resolution_stage": "troubleshoot_first|request_evidence|initiate_warranty_repair|cancel_order|refund_or_exchange|info_only|escalate_human",
  "sub_queries": ["query 1"],
  "required_facts": ["order_state"],
  "skills_to_consider": ["get_order"],
  "confidence": 0.9,
  "language": "da"
}

Rules:
- SHORT CONFIRMATION DETECTION (check this FIRST before classifying intent):
  If the current message is ≤60 characters AND is a simple confirmation or acknowledgement (e.g. "ja", "yes", "ok", "jep", "det er korrekt", "ja tak", "confirmed", "sounds good", "præcist", "det passer", "ja det er de", "perfekt", or any short affirmative in any language) — this is a CONFIRMATION RESPONSE to the previous agent question.
  For confirmation messages:
  KRITISK EXCEPTION: If the confirmation is about "verifying personal details / address for a warranty or replacement already offered" — i.e. the customer says something like "ja det er stadig de oplysninger", "yes those details are still correct", "ja det passer", "those are still my details" — then set primary_intent = "other". The replacement was already arranged by the previous agent; the writer only needs to confirm we are proceeding. Do NOT set intent to "complaint" or "exchange" — that would trigger a new exchange action proposal which is wrong since we already committed.
  For all other confirmation messages:
  - primary_intent: use the thread's most relevant open issue from pending_asks/open_questions (NOT the confirmation word itself). E.g. if pending was "address confirmation for cable replacement" → intent = "complaint" or "exchange"
  - sub_queries: generate based on what should happen NEXT after this confirmation. E.g. address confirmed → ["send spare part customer confirmed address", "cable replacement shipment procedure", "how to ship spare part to customer"]
  - required_facts: always ["order_state"] — we need the order to proceed
  - skills_to_consider: what the confirmation enables — e.g. address confirmed → ["update_shipping_address"]

- primary_intent (for non-confirmation messages): classify ONLY by the content of the CURRENT customer message.
  - Message is ONLY expressing gratitude ("thanks", "thank you", "appreciate", "tak", "mange tak", "gracias", "merci", "danke", any variant) → ALWAYS "thanks". Do NOT look at order numbers or prior context. A pure thank-you is ALWAYS "thanks".
  - Message is a pure status update with no open problem — customer confirms package arrived, issue resolved itself, or just provides a heads-up with nothing to act on → ALWAYS "update". Like "thanks", do NOT look at order context. A pure update is always "update".
  - Customer asks for invoice, receipt, order confirmation, faktura, kvittering, or asks to have an email/confirmation resent → ALWAYS "other". Even if they mention an order number. This is NEVER "refund".
  - Customer asks to change address → address_change (even if order is already shipped/delivered)
  - Customer asks about missing item → complaint (e.g. "jeg modtog kun 1 i stedet for 2")
  - Customer received wrong item → complaint
  - Customer received defective/damaged item → complaint
  - Customer wants replacement because of shop error (wrong item, missing item, defect) → exchange (NOT return)
  - Customer says "ombytning" because of shop error → exchange
  - Customer wants to return because they changed their mind / don't want it → return
  - Customer asks for money back, refund, reimbursement, or says they want their money back → refund, even if the reason is a defect or complaint. NEVER classify as refund if the customer only asks for an invoice/receipt/faktura.
  - Customer asks to cancel → cancel (even if already fulfilled)
- sub_queries: 1-3 search queries to find relevant knowledge. Use DIFFERENT angles:
  - Query 1: Customer's own words (what they describe), in customer's language
  - Query 2: ALWAYS in English — operational/product angle (e.g. "[product] charging cable replacement", "[product] defect production warranty", "[product] return policy"). This ensures English knowledge base content is found regardless of customer language.
  - Query 3 (optional): Procedure angle in English (e.g. "how to handle [issue]", "spare parts [product]")
  - CRITICAL for physical damage/defect: always include (1) a query about the specific product + "defect" or "warranty" or "warranty replacement", AND (2) a separate query for "[product] repair procedure" or "[product] send in repair" to surface product-specific repair workflows. Physical damage almost always requires a documented repair/return procedure — retrieve it explicitly.
  - CRITICAL for technical symptoms: sub_queries must describe the SYMPTOM precisely, not generic keywords. "headset turns off unexpectedly after charging" not "dongle disconnected". "battery drains in 8 hours instead of 35" not "battery problem". Precise symptom queries surface the right troubleshooting content and avoid retrieving unrelated procedures like pairing guides.
- required_facts: only what's needed — order_state | tracking | return_eligibility | policy_excerpt | product_specs
  - For refund, return, exchange, complaint about a purchased product, cancel, address_change, or tracking: include order_state so the system can look up the customer's order by email/order number
  - NEVER include return_eligibility for: complaint, exchange, missing items, wrong items, defective items — return windows NEVER apply to shop errors
  - For "thanks" intent: required_facts MUST be empty [] — never look up order or tracking for a thank-you message
  - For "thanks" intent: sub_queries MUST be empty [] — no knowledge retrieval needed
  - For "update" intent: required_facts MUST be empty [] — no order lookup needed
  - For "update" intent: sub_queries MUST be empty [] — no knowledge retrieval needed
- skills_to_consider: only actions relevant to intent — get_order | get_tracking | update_shipping_address | cancel_order | refund_order | create_exchange_request
  - For "thanks" intent: skills_to_consider MUST be empty []
  - For "update" intent: skills_to_consider MUST be empty []
- resolution_stage (CRITICAL — defines what the reply must DO, separate from intent which is what it is ABOUT). Pick exactly one:
  - "troubleshoot_first": Customer reports a technical/functional issue (won't pair, won't charge, won't power on, no sound, dropouts, software glitch) and has NOT stated they already tried troubleshooting. The reply must give product-specific steps from knowledge — NEVER offer warranty/return/replacement yet, even if customer asks for it. Applies to most "complaint" intents about technical symptoms.
  - "request_evidence": Customer reports physical damage / defect (broken part, dangling microphone, cracked shell, missing piece) OR is requesting warranty/replacement but evidence is missing (no photos/video, no order number when needed). The reply must ask for the missing evidence before offering a resolution path. Applies to many "complaint" and "exchange" intents on first contact.
  - "initiate_warranty_repair": Customer explicitly states they HAVE tried the troubleshooting steps, OR damage is already documented in the thread (photos/video provided earlier, repair-path already acknowledged). The reply must outline the warranty / send-in-for-repair procedure per knowledge. Do NOT propose more troubleshooting.
  - "cancel_order": Customer asks to cancel. Pair with "cancel" intent.
  - "refund_or_exchange": Customer wants money back or product swap, and we are at the point of executing it (not still gathering evidence). Pair with "refund", "return", or "exchange" intents when prerequisites are met.
  - "info_only": Pure informational response — tracking status, FAQ, product question, thanks, update, address change confirmation, invoice/receipt resend. No multi-step procedure to execute. This is the default for "thanks", "update", "tracking", "product_question", "address_change", and most "other".
  - "escalate_human": Truly beyond AI scope (legal threat, multi-party dispute, ambiguous identity, shop policy explicitly requires human). Use sparingly.

  CRITICAL decision rules:
  - intent="complaint" + technical symptom + customer has NOT said they tried steps → resolution_stage = "troubleshoot_first" (never jump to warranty/return on first contact)
  - intent="complaint" + technical symptom + customer says "I tried X/Y/Z and it still doesn't work" → resolution_stage = "initiate_warranty_repair"
  - intent="complaint" or "exchange" + physical damage + first contact, no images in thread → resolution_stage = "request_evidence"
  - intent="complaint" or "exchange" + physical damage + images/video already provided → resolution_stage = "initiate_warranty_repair"
  - intent="cancel" → resolution_stage = "cancel_order"
  - intent="thanks" or "update" → resolution_stage = "info_only" (ALWAYS)
  - intent="tracking", "product_question", "address_change", "other" → resolution_stage = "info_only" unless a clear action is being executed

- language: ISO 639-1 code. Supported: da, en, sv, de, fr, nl, no, fi, es, it`;

  const threadContextLines = [
    `- Order numbers in thread: ${
      caseState.entities.order_numbers.join(", ") || "none"
    }`,
    caseState.entities.products_mentioned.length > 0
      ? `- Products discussed in thread: ${
        caseState.entities.products_mentioned.join(", ")
      }`
      : null,
    caseState.open_questions.length > 0
      ? `- Unresolved customer issues (CRITICAL: use these as primary basis for sub_queries — the customer's follow-up message may be short or vague but refers to these ongoing problems): ${
        caseState.open_questions.join("; ")
      }`
      : null,
    caseState.pending_asks.length > 0
      ? `- Pending context in thread: ${caseState.pending_asks.join("; ")}`
      : null,
  ].filter(Boolean).join("\n");

  const userPrompt =
    `Classify the CURRENT customer message ONLY — ignore prior thread context for intent.

Current customer message: "${body.slice(0, 800)}"

Thread context (for sub_queries and facts ONLY — do NOT use for intent classification):
${threadContextLines}
- Detected language of current message: detect from the current message above, ignore thread history language

IMPORTANT for sub_queries: If the current message is short or vague (e.g. "it still doesn't work", "won't do anything", "same issue", "still broken") AND there are unresolved customer issues listed above, generate sub_queries that target those specific unresolved issues — not the vague wording of the current message. The customer is referring to their ongoing problem.`;
  const deterministicLanguage = resolveReplyLanguage(body, caseState.language);
  const model = Deno.env.get("OPENAI_EXTRACT_MODEL") ?? "gpt-4o-mini";

  try {
    const parsed = await callOpenAIJson<Plan>({
      model,
      systemPrompt,
      userPrompt,
      maxTokens: 500,
      schema: PLANNER_SCHEMA,
      schemaName: "draft_v2_plan",
    });
    return { ...parsed, language: deterministicLanguage || parsed.language };
  } catch (err) {
    console.error("[planner] Error:", err);
    return FALLBACK_PLAN(deterministicLanguage || caseState.language);
  }
}
