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
- sub_queries: 1-3 search queries in customer's language to find relevant knowledge
- required_facts: only what's needed — order_state | tracking | return_eligibility | policy_excerpt | product_specs
  - NEVER include return_eligibility for complaint, exchange, or missing/defective item cases — return windows do not apply
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
