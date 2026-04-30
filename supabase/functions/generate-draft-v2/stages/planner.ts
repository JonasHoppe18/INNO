// supabase/functions/generate-draft-v2/stages/planner.ts
import { CaseState } from "./case-state-updater.ts";

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
- primary_intent: classify by what the CUSTOMER IS ASKING FOR, not by order status
  - Customer asks to change address → address_change (even if order is already shipped/delivered)
  - Customer asks about missing item → complaint (e.g. "jeg modtog kun 1 i stedet for 2")
  - Customer received wrong item → complaint
  - Customer received defective/damaged item → complaint
  - Customer wants replacement because of shop error (wrong item, missing item, defect) → exchange (NOT return)
  - Customer says "ombytning" because of shop error → exchange
  - Customer wants to return because they changed their mind / don't want it → return
  - Customer asks to cancel → cancel (even if already fulfilled)
- sub_queries: 1-3 search queries to find relevant knowledge. Use DIFFERENT angles:
  - Query 1: Customer's own words (what they describe)
  - Query 2: Operational/product angle (e.g. "[product] defect production warranty replacement" for damage cases, "[product] return policy" for return cases)
  - Query 3 (optional): Procedure angle (e.g. "how to handle [issue] step by step")
  - CRITICAL for physical damage/defect: always include a query about the specific product + "defect" or "production issue" or "warranty replacement"
- required_facts: only what's needed — order_state | tracking | return_eligibility | policy_excerpt | product_specs
  - NEVER include return_eligibility for: complaint, exchange, missing items, wrong items, defective items — return windows NEVER apply to shop errors
- skills_to_consider: only actions relevant to intent — get_order | get_tracking | update_shipping_address | cancel_order | refund_order | create_exchange_request
- language: ISO 639-1 code`;

  const userPrompt = `Customer message: "${body.slice(0, 800)}"

Case state:
- Order numbers found: ${caseState.entities.order_numbers.join(", ") || "none"}
- Language: ${caseState.language}
- Open questions: ${caseState.open_questions.join("; ") || "none"}`;

  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
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
    return { ...parsed, language: parsed.language ?? caseState.language };
  } catch (err) {
    console.error("[planner] Error:", err);
    return FALLBACK_PLAN(caseState.language);
  }
}
