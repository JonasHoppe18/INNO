// supabase/functions/generate-draft-v2/stages/planner.ts
import { CaseState } from "./case-state-updater.ts";
import { resolveReplyLanguage } from "./language.ts";

export interface Plan {
  primary_intent: string;
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

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const FALLBACK_PLAN = (language: string): Plan => ({
  primary_intent: "other",
  sub_queries: [],
  required_facts: ["order_state"],
  skills_to_consider: [],
  confidence: 0.3,
  language,
});

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
  "primary_intent": "tracking|return|refund|exchange|address_change|product_question|complaint|thanks|other",
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
  - primary_intent: use the thread's most relevant open issue from pending_asks/open_questions (NOT the confirmation word itself). E.g. if pending was "address confirmation for cable replacement" → intent = "complaint" or "exchange"
  - sub_queries: generate based on what should happen NEXT after this confirmation. E.g. address confirmed → ["send spare part customer confirmed address", "cable replacement shipment procedure", "how to ship spare part to customer"]
  - required_facts: always ["order_state"] — we need the order to proceed
  - skills_to_consider: what the confirmation enables — e.g. address confirmed → ["create_exchange_request", "add_note"]

- primary_intent (for non-confirmation messages): classify ONLY by the content of the CURRENT customer message.
  - Message is ONLY expressing gratitude ("thanks", "thank you", "appreciate", "tak", "mange tak", "gracias", "merci", "danke", any variant) → ALWAYS "thanks". Do NOT look at order numbers or prior context. A pure thank-you is ALWAYS "thanks".
  - Customer asks to change address → address_change (even if order is already shipped/delivered)
  - Customer asks about missing item → complaint (e.g. "jeg modtog kun 1 i stedet for 2")
  - Customer received wrong item → complaint
  - Customer received defective/damaged item → complaint
  - Customer wants replacement because of shop error (wrong item, missing item, defect) → exchange (NOT return)
  - Customer says "ombytning" because of shop error → exchange
  - Customer wants to return because they changed their mind / don't want it → return
  - Customer asks for money back, refund, reimbursement, or says they want their money back → refund, even if the reason is a defect or complaint
  - Customer asks to cancel → cancel (even if already fulfilled)
- sub_queries: 1-3 search queries to find relevant knowledge. Use DIFFERENT angles:
  - Query 1: Customer's own words (what they describe), in customer's language
  - Query 2: ALWAYS in English — operational/product angle (e.g. "[product] charging cable replacement", "[product] defect production warranty", "[product] return policy"). This ensures English knowledge base content is found regardless of customer language.
  - Query 3 (optional): Procedure angle in English (e.g. "how to handle [issue]", "spare parts [product]")
  - CRITICAL for physical damage/defect: always include a query about the specific product + "defect" or "production issue" or "warranty replacement"
  - CRITICAL for technical symptoms: sub_queries must describe the SYMPTOM precisely, not generic keywords. "headset turns off unexpectedly after charging" not "dongle disconnected". "battery drains in 8 hours instead of 35" not "battery problem". Precise symptom queries surface the right troubleshooting content and avoid retrieving unrelated procedures like pairing guides.
- required_facts: only what's needed — order_state | tracking | return_eligibility | policy_excerpt | product_specs
  - For refund, return, exchange, complaint about a purchased product, cancel, address_change, or tracking: include order_state so the system can look up the customer's order by email/order number
  - NEVER include return_eligibility for: complaint, exchange, missing items, wrong items, defective items — return windows NEVER apply to shop errors
  - For "thanks" intent: required_facts MUST be empty [] — never look up order or tracking for a thank-you message
  - For "thanks" intent: sub_queries MUST be empty [] — no knowledge retrieval needed
- skills_to_consider: only actions relevant to intent — get_order | get_tracking | update_shipping_address | cancel_order | refund_order | create_exchange_request
  - For "thanks" intent: skills_to_consider MUST be empty []
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
      ? `- Open issues in thread (use for sub_queries): ${
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
- Detected language of current message: detect from the current message above, ignore thread history language`;
  const deterministicLanguage = resolveReplyLanguage(body, caseState.language);

  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini",
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) throw new Error(`Planner API error: ${resp.status}`);
    const data = await resp.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return { ...parsed, language: deterministicLanguage || parsed.language };
  } catch (err) {
    console.error("[planner] Error:", err);
    return FALLBACK_PLAN(deterministicLanguage || caseState.language);
  }
}
