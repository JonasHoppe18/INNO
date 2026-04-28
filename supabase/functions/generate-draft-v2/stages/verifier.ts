// supabase/functions/generate-draft-v2/stages/verifier.ts
import { ResolvedFact } from "./fact-resolver.ts";
import { RetrievedChunk } from "./retriever.ts";

export interface VerifierResult {
  grounded_claims_pct: number;
  contradictions: Array<{ claim: string; conflicting_fact: string }>;
  policy_violations: string[];
  confidence: number;
  block_send: boolean;
  retry_with_stronger_model: boolean;
}

export interface VerifierInput {
  draftText: string;
  proposedActions: unknown[];
  citations: Array<{ claim: string; source_index: number }>;
  facts: { facts: ResolvedFact[] };
  retrievedChunks: RetrievedChunk[];
}

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Returned when verifier itself fails — medium confidence, don't block
const FALLBACK_RESULT: VerifierResult = {
  grounded_claims_pct: 0.7,
  contradictions: [],
  policy_violations: [],
  confidence: 0.7,
  block_send: false,
  retry_with_stronger_model: false,
};

export async function runVerifier(
  { draftText, citations, facts }: VerifierInput,
): Promise<VerifierResult> {
  if (!draftText) {
    return {
      grounded_claims_pct: 0,
      contradictions: [],
      policy_violations: [],
      confidence: 0,
      block_send: true,
      retry_with_stronger_model: false,
    };
  }

  const factsText = facts.facts.length > 0
    ? facts.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n")
    : "Ingen verificerede fakta tilgængelige.";

  const systemPrompt =
    `You are a quality verifier for AI-generated customer support replies. Output ONLY valid JSON.`;

  const userPrompt =
    `Draft reply (first 800 chars): "${draftText.slice(0, 800)}"

Verified facts:
${factsText}

Citations provided: ${citations.length}

Assess and output JSON:
{
  "grounded_claims_pct": 0.9,
  "contradictions": [],
  "policy_violations": [],
  "confidence": 0.85,
  "block_send": false,
  "retry_with_stronger_model": false
}

Rules:
- grounded_claims_pct: fraction of factual claims that have citations or match verified facts (0-1)
- contradictions: list any claim that conflicts with a verified fact
- confidence: overall quality score (0-1). Below 0.6 = set retry_with_stronger_model=true. Below 0.4 = set block_send=true.
- block_send: true only for serious issues (contradictions, harmful content, completely off-topic)`;

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

    if (!resp.ok) throw new Error(`Verifier API error: ${resp.status}`);
    const data = await resp.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (err) {
    console.error("[verifier] Error:", err);
    return FALLBACK_RESULT;
  }
}
