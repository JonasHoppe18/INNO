// supabase/functions/generate-draft-v2/stages/planner.ts
import { CaseState } from "./case-state-updater.ts";
import { resolveReplyLanguage } from "./language.ts";
import { callOpenAIJson } from "./openai-json.ts";

// The LLM call is injectable so unit tests can run deterministically against
// stubbed plans with no live API (same pattern as snippet-matcher.ts).
type CallJson = typeof callOpenAIJson;

export type ResolutionStage =
  | "clarify_symptom"
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
        "clarify_symptom",
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

const RECEIPT_OR_INVOICE_RE =
  /\b(?:invoice|receipt|order\s+confirmation|faktura|kvittering|ordrebekr(?:æ|ae)ftelse)\b/iu;
const PURE_ACKNOWLEDGEMENT_RE =
  /^(?:many\s+thanks|thank\s+you|thanks|tak|mange\s+tak|perfekt|perfect|great|super|okay|ok|yes|ja)[.!\s🙂😊👍]*$/iu;

/**
 * Resolve only high-confidence, explicit customer asks. The model still owns
 * ambiguous classification, but a stated outcome such as "I want a refund"
 * must outrank the dissatisfaction that explains why. This is ecommerce-wide
 * behavior and deliberately contains no merchant or product names.
 */
export function explicitIntentFromMessage(message: string): string | null {
  const text = String(message ?? "").replace(/\s+/g, " ").trim();
  if (!text || PURE_ACKNOWLEDGEMENT_RE.test(text)) return null;

  // A shipment shown as delivered but missing is still a tracking case. The
  // customer's frustration must not turn the operational question (where is
  // the parcel?) into a generic complaint.
  const deliveredButMissing =
    /\b(?:package|parcel|shipment|order)\b.{0,80}\b(?:marked|shown?|says?|claimed)\b.{0,30}\bdelivered\b/iu
        .test(text) &&
      /\b(?:not\s+(?:here|received|arrived)|isn['’]?t\s+(?:here|there)|wrong\s+(?:place|location|address)|where\s+is\s+it)\b/iu
        .test(text) ||
    (
      /\b(?:pakke|pakke\w*|forsendelse|ordre)\b.{0,80}\b(?:står|markeret|vist)\b.{0,20}\b(?:som\s+)?leveret\b/iu
        .test(text) &&
      /\b(?:ikke\s+(?:modtaget|ankommet|her)|forkert\s+(?:sted|adresse)|hvor\s+er\s+den)\b/iu
        .test(text)
    );
  if (deliveredButMissing) return "tracking";

  // Checkout availability is a shop/market configuration question, not a
  // product question. "other" is the runtime taxonomy's generic commerce
  // bucket until checkout has a dedicated intent.
  if (
    /\b(?:checkout|check\s*out|kassen)\b/iu.test(text) &&
    /\b(?:country(?:\s*\/\s*region)?|region|delivery\s+country|shipping\s+country|land|leveringsland)\b/iu
      .test(text) &&
    /\b(?:not\s+(?:an\s+)?option|can(?:not|'t)\s+(?:select|choose)|unable\s+to\s+(?:select|choose)|missing|ikke\s+(?:en\s+)?mulighed|kan\s+ikke\s+(?:vælge|vaelge))\b/iu
      .test(text)
  ) return "other";

  const strongRefundRequested =
    /\b(?:refund|money\s+back|full\s+refund|partial\s+refund)\b/iu.test(text) ||
    /\b(?:refusion|refundering|tilbagebetal[\p{L}]*|pengene\s+(?:tilbage|retur))\b/iu
      .test(text);
  const refundRequested = strongRefundRequested ||
    /\b(?:reimburse(?:ment|d|able)?)\b/iu.test(text);
  const returnRequested =
    /\b(?:i\s+(?:want|need|would\s+like|plan)\s+to|can\s+i|could\s+i|may\s+i|how\s+(?:can|do)\s+i|if\s+i)\s+(?:return\b|send\s+(?:it|this|the\s+product)\s+back\b)/iu
      .test(text) ||
    /\b(?:jeg\s+(?:vil|ønsker|oensker)\s+gerne|kan\s+jeg|hvordan\s+kan\s+jeg|hvis\s+jeg)\b.{0,18}\b(?:returnere|sende\s+(?:den|varen)\s+retur)\b/iu
      .test(text);
  const returnNegated =
    /\b(?:do\s+not|don['’]?t|dont|not)\s+(?:want|need|plan)\b.{0,18}\breturn\b/iu
      .test(text);
  if (RECEIPT_OR_INVOICE_RE.test(text) && !refundRequested) return null;

  if (
    !/\b(?:do\s+not|don['’]?t|dont|please\s+do\s+not)\b.{0,25}\b(?:change|update|correct|edit)\b/iu
      .test(text) &&
    (
      /\b(?:change|update|correct|edit)\b.{0,45}\b(?:shipping|delivery)?\s*address\b/iu
        .test(text) ||
      /\b(?:ændr|aendr|ret|opdat)[\p{L}]*\b.{0,45}\b(?:leverings)?adresse\b/iu
        .test(text)
    )
  ) return "address_change";

  if (
    (
      /\b(?:please|can\s+you|could\s+you|would\s+you|i\s+(?:want|need|would\s+like)\s+to)\b.{0,45}\bcancel\b/iu
        .test(text) ||
      /\b(?:kan\s+(?:i|du)|jeg\s+(?:vil|ønsker|oensker)\s+gerne|venligst)\b.{0,45}\b(?:annull[ée]r|afbestil)[\p{L}]*\b/iu
        .test(text) ||
      /^(?:cancel|annull[ée]r|afbestil)[\p{L}]*\b/iu.test(text)
    ) &&
    !/\b(?:do\s+not|don['’]?t|dont|not\s+want\s+to|please\s+do\s+not)\b.{0,25}\bcancel\b/iu
      .test(text) &&
    !/\b(?:ikke)\b.{0,20}\b(?:annull[ée]r|afbestil)[\p{L}]*\b/iu.test(text)
  ) {
    return "cancel";
  }

  // "If I return it, will you reimburse me?" is a return-policy request. A
  // direct refund/money-back ask still wins when both outcomes are present.
  if (returnRequested && !returnNegated && !strongRefundRequested) {
    return "return";
  }

  if (
    refundRequested &&
    !/\b(?:do\s+not|don['’]?t|dont|not)\s+(?:want|need|request|ask(?:ing)?\s+for)\b.{0,20}\b(?:refund|reimbursement|money\s+back)\b/iu
      .test(text) &&
    !/\b(?:ønsker|oensker|vil|skal)\s+ikke\b.{0,20}\b(?:refusion|refundering|pengene\s+tilbage)\b/iu
      .test(text)
  ) return "refund";

  // Questions about buying, compatibility, specifications or firmware are
  // informational product questions even when the accessory is described as
  // a replacement. Do not turn those into an exchange workflow.
  if (
    /\b(?:can|could|may|where|how)\s+(?:i|we)\s+(?:buy|purchase|order)\b/iu
      .test(text) ||
    /\b(?:kan|hvor)\s+(?:jeg|vi)\s+(?:købe|koebe|bestille)\b/iu.test(text) ||
    /\b(?:er\s+det\s+muligt|er\s+der\s+mulighed\s+for)(?:\s+for\s+\w+)?\s+at\s+(?:købe|koebe|bestille)\b/iu
      .test(text) ||
    /\b(?:is\s+it\s+possible|is\s+there\s+a\s+way)\s+to\s+(?:buy|purchase|order)\b/iu
      .test(text) ||
    /\b(?:compatible|compatibility|kompatibel|kompatibilitet|latest\s+(?:firmware|version)|newest\s+(?:firmware|version)|battery\s+life|dimensions|specifications?|what\s+options)\b/iu
      .test(text)
  ) return "product_question";

  if (
    /\b(?:i\s+(?:want|need|would\s+like)|can\s+i\s+get|could\s+you|please)\b.{0,55}\b(?:exchange|replacement|replace|swap|new\s+(?:unit|one|headset|product))\b/iu
      .test(text) ||
    /\b(?:jeg\s+(?:ønsker|oensker|vil\s+gerne)|kan\s+jeg\s+få|faa|venligst)\b.{0,55}\b(?:ombyt[\p{L}]*|erstat[\p{L}]*|nyt\s+(?:produkt|headset))\b/iu
      .test(text) ||
    /\b(?:request(?:ing)?|anmod[\p{L}]*)\b.{0,35}\b(?:exchange|replacement|ombyt[\p{L}]*)\b/iu
      .test(text)
  ) return "exchange";

  if (
    returnRequested &&
    !returnNegated
  ) return "return";

  return null;
}

export function applyDeterministicIntentPrecedence(
  plan: Plan,
  message: string,
): Plan {
  const explicitIntent = explicitIntentFromMessage(message);
  if (!explicitIntent || explicitIntent === plan.primary_intent) return plan;

  const requiredFacts = [...plan.required_facts];
  const needsOrder = [
    "tracking",
    "refund",
    "return",
    "exchange",
    "cancel",
    "address_change",
  ].includes(explicitIntent);
  if (needsOrder && !requiredFacts.includes("order_state")) {
    requiredFacts.push("order_state");
  }

  if (explicitIntent === "product_question") {
    const productFacts = requiredFacts.filter((fact) =>
      !["order_state", "tracking", "return_eligibility"].includes(fact)
    );
    if (!productFacts.includes("product_specs")) {
      productFacts.push("product_specs");
    }
    return {
      ...plan,
      primary_intent: explicitIntent,
      resolution_stage: "info_only",
      required_facts: productFacts,
      skills_to_consider: [],
      confidence: Math.max(plan.confidence, 0.9),
    };
  }

  if (explicitIntent === "tracking") {
    if (!requiredFacts.includes("tracking")) requiredFacts.push("tracking");
    return {
      ...plan,
      primary_intent: explicitIntent,
      resolution_stage: "info_only",
      required_facts: requiredFacts,
      confidence: Math.max(plan.confidence, 0.9),
    };
  }

  if (explicitIntent === "other") {
    return {
      ...plan,
      primary_intent: explicitIntent,
      resolution_stage: "info_only",
      skills_to_consider: [],
      confidence: Math.max(plan.confidence, 0.9),
    };
  }

  return {
    ...plan,
    primary_intent: explicitIntent,
    resolution_stage: explicitIntent === "cancel"
      ? "cancel_order"
      : explicitIntent === "address_change"
      ? "info_only"
      : plan.resolution_stage,
    required_facts: requiredFacts,
    confidence: Math.max(plan.confidence, 0.9),
  };
}

export async function runPlanner(
  { caseState, latestMessage, shop }: PlannerInput,
  deps: { callJson?: CallJson } = {},
): Promise<Plan> {
  const callJson = deps.callJson ?? callOpenAIJson;
  const body =
    (latestMessage as { clean_body_text?: string }).clean_body_text ?? "";
  const shopName = (shop as { name?: string }).name ?? "shop";

  const systemPrompt =
    `You are a support ticket planning AI for ${shopName}. Output ONLY valid JSON.

Schema:
{
  "primary_intent": "tracking|return|refund|exchange|address_change|product_question|complaint|thanks|update|other",
  "resolution_stage": "clarify_symptom|troubleshoot_first|request_evidence|initiate_warranty_repair|cancel_order|refund_or_exchange|info_only|escalate_human",
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
  - When resolution_stage = "clarify_symptom": sub_queries MUST be empty [] — there is nothing concrete to search for yet, and injecting knowledge here risks the writer guessing from it instead of asking. required_facts MUST be empty [] too — do not look up the order before we even know what the customer's actual issue is.
- skills_to_consider: only actions relevant to intent — get_order | get_tracking | update_shipping_address | cancel_order | refund_order | create_exchange_request
  - For "thanks" intent: skills_to_consider MUST be empty []
  - For "update" intent: skills_to_consider MUST be empty []
  - When resolution_stage = "clarify_symptom": skills_to_consider MUST be empty []
- resolution_stage (CRITICAL — defines what the reply must DO, separate from intent which is what it is ABOUT). Pick exactly one:
  - "clarify_symptom": Customer expresses malfunction/dissatisfaction/a problem ("det virker ikke", "it doesn't work", "broken", "problem med min ordre") but names NO concrete symptom, feature, product, order detail, or actionable specific — AND the thread context above (order numbers, products discussed, unresolved customer issues, pending context) does NOT already establish what the issue/product is. The reply must ask exactly one short clarification question (which product, and what exactly is wrong) — NEVER guess a symptom, NEVER give troubleshooting steps, NEVER offer warranty/return. This is ecommerce-generic — it applies to ANY vertical, not just technical/audio products. If the thread context already names the product/symptom (e.g. from an earlier message in the same thread), do NOT use this stage — use the stage that fits the now-known issue instead.
  - "troubleshoot_first": Customer reports a technical/functional issue with enough detail to act on (won't pair, won't charge, won't power on, no sound, dropouts, software glitch, or any other named symptom) and has NOT stated they already tried troubleshooting. The reply must give product-specific steps from knowledge — NEVER offer warranty/return/replacement yet, even if customer asks for it. Applies to most "complaint" intents about technical symptoms where a concrete symptom is actually named. Do NOT use this stage when no concrete symptom is named — use "clarify_symptom" instead.
  - "request_evidence": Customer reports physical damage / defect (broken part, dangling microphone, cracked shell, missing piece) OR is requesting warranty/replacement but evidence is missing (no photos/video, no order number when needed). The reply must ask for the missing evidence before offering a resolution path. Applies to many "complaint" and "exchange" intents on first contact.
  - "initiate_warranty_repair": Customer explicitly states they HAVE tried the troubleshooting steps, OR damage is already documented in the thread (photos/video provided earlier, repair-path already acknowledged). The reply must outline the warranty / send-in-for-repair procedure per knowledge. Do NOT propose more troubleshooting.
  - "cancel_order": Customer asks to cancel. Pair with "cancel" intent.
  - "refund_or_exchange": Customer wants money back or product swap, and we are at the point of executing it (not still gathering evidence). Pair with "refund", "return", or "exchange" intents when prerequisites are met.
  - "info_only": Pure informational response — tracking status, FAQ, product question, thanks, update, address change confirmation, invoice/receipt resend. No multi-step procedure to execute. This is the default for "thanks", "update", "tracking", "product_question", "address_change", and most "other".
  - "escalate_human": Truly beyond AI scope (legal threat, multi-party dispute, ambiguous identity, shop policy explicitly requires human). Use sparingly.

  CRITICAL decision rules:
  - intent="complaint" (or "other" when the message is just "it doesn't work"/"problem with my order" with nothing else) + NO concrete symptom/product/order detail named + thread context does not already name one → resolution_stage = "clarify_symptom" (ask before guessing — never invent a symptom)
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
    const parsed = await callJson<Plan>({
      model,
      systemPrompt,
      userPrompt,
      maxTokens: 500,
      schema: PLANNER_SCHEMA,
      schemaName: "draft_v2_plan",
    });
    return applyDeterministicIntentPrecedence(
      { ...parsed, language: deterministicLanguage || parsed.language },
      body,
    );
  } catch (err) {
    console.error("[planner] Error:", err);
    return FALLBACK_PLAN(deterministicLanguage || caseState.language);
  }
}
