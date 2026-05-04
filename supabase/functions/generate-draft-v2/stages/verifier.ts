// supabase/functions/generate-draft-v2/stages/verifier.ts
import { ResolvedFact } from "./fact-resolver.ts";
import { RetrievedChunk } from "./retriever.ts";
import { ActionProposal } from "./action-decision.ts";
import { mixedLanguageCheck } from "./language.ts";

export interface VerifierResult {
  grounded_claims_pct: number;
  contradictions: Array<{ claim: string; conflicting_fact: string }>;
  policy_violations: string[];
  confidence: number;
  block_send: boolean;
  retry_with_stronger_model: boolean;
  issues: string[];
}

export interface VerifierInput {
  draftText: string;
  proposedActions: ActionProposal[];
  citations: Array<{ claim: string; source_index: number }>;
  facts: { facts: ResolvedFact[] };
  retrievedChunks: RetrievedChunk[];
  customerMessage?: string;
  language?: string;
}

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const FALLBACK_RESULT: VerifierResult = {
  grounded_claims_pct: 0,
  contradictions: [],
  policy_violations: [],
  confidence: 0,
  block_send: false,
  retry_with_stronger_model: true,
  issues: ["verifier_api_error"],
};

export async function runVerifier(
  { draftText, citations, facts, retrievedChunks, customerMessage, language }:
    VerifierInput,
): Promise<VerifierResult> {
  if (!draftText) {
    return {
      grounded_claims_pct: 0,
      contradictions: [],
      policy_violations: [],
      confidence: 0,
      block_send: true,
      retry_with_stronger_model: false,
      issues: ["empty_draft"],
    };
  }

  const factsText = facts.facts.length > 0
    ? facts.facts.map((f) => `${f.label}: ${f.value}`).join("\n")
    : "No order/tracking facts retrieved (knowledge-base-only response).";

  const knowledgeText = retrievedChunks.length > 0
    ? retrievedChunks
      .slice(0, 5)
      .map((c, i) => `[KB${i}] ${c.source_label}: ${c.content.slice(0, 400)}`)
      .join("\n\n")
    : "No knowledge base chunks retrieved.";

  const customerSnippet = customerMessage
    ? customerMessage.slice(0, 400)
    : null;

  const systemPrompt =
    `You are a strict quality auditor for AI-generated customer support replies. Output ONLY valid JSON. Be critical — your job is to catch issues before they reach the customer.`;

  const userPrompt = `## Customer message (what they asked)
${customerSnippet ?? "(not provided)"}

## Verified order/tracking facts
${factsText}

## Knowledge base content used (treat as trusted source)
${knowledgeText}

## Draft reply to audit (first 900 chars)
"${draftText.slice(0, 900)}"

## Citations provided: ${citations.length}

## Expected language: ${language ?? "auto-detect from customer message"}

---

Audit the draft on these dimensions and output JSON:

{
  "answers_question": true,
  "language_correct": true,
  "contradictions": [],
  "hallucinations": [],
  "return_window_misapplied": false,
  "grounded_claims_pct": 0.9,
  "confidence": 0.85,
  "issues": [],
  "block_send": false,
  "retry_with_stronger_model": false
}

### Scoring rules

**answers_question** (boolean)
Does the reply directly address what the customer asked? A reply that only states order status when the customer asked WHY their package hasn't arrived = false.

**language_correct** (boolean)
Does the ENTIRE reply language match the customer's message language? Danish reply to an English question = false. A mostly English reply with a Danish closing sentence like "Undskyld for ulejligheden..." = false and must add issue "mixed_language". If no customer message provided, set true.

**contradictions** (array of strings)
List any claim in the draft that directly contradicts a verified fact.
Example: draft says "order is on its way" but fact says "fulfilled/delivered" = contradiction.

**hallucinations** (array of strings)
List any specific factual claim in the draft (dates, tracking numbers, addresses, product names) that is NOT supported by the verified facts OR the knowledge base content. Claims that come from the knowledge base are NOT hallucinations.

**return_window_misapplied** (boolean)
True if the draft mentions a return window/deadline in a context where it does NOT apply:
- Customer received wrong item
- Customer received defective/damaged item
- Customer received missing items from an order
- Customer wants an exchange due to shop error
The return window only applies when the customer voluntarily wants to return an item they simply don't want.

**grounded_claims_pct** (0-1)
Fraction of factual claims in the draft that are supported by verified facts, knowledge base content, or citations.

**confidence** (0-1)
Overall quality confidence. Deduct:
- 0.3 if answers_question=false
- 0.2 if language_correct=false
- 0.15 per contradiction
- 0.1 per hallucination
- 0.2 if return_window_misapplied=true
Start from 1.0 and subtract.

**block_send** (boolean)
True ONLY for: direct contradiction of facts, harmful/offensive content, completely wrong topic.

**retry_with_stronger_model** (boolean)
True if confidence < 0.65 or mixed_language is present.

**issues** (array of short strings)
Machine-readable list of what went wrong. Use: answers_question_missing, wrong_language, mixed_language, contradiction, hallucination, return_window_misapplied, low_grounding`;

  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        temperature: 0,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) throw new Error(`Verifier API error: ${resp.status}`);
    const data = await resp.json();
    const parsed = JSON.parse(data.choices[0].message.content);

    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.7;

    const languageCheck = mixedLanguageCheck(draftText, language);
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    if (!languageCheck.ok && !issues.includes("mixed_language")) {
      issues.push("mixed_language");
    }
    const finalConfidence = languageCheck.ok
      ? confidence
      : Math.min(confidence, 0.62);

    const result: VerifierResult = {
      grounded_claims_pct: parsed.grounded_claims_pct ?? 0.7,
      contradictions: (parsed.contradictions ?? []).map((c: string) => ({
        claim: c,
        conflicting_fact: "",
      })),
      policy_violations: parsed.return_window_misapplied
        ? ["return_window_misapplied"]
        : [],
      confidence: finalConfidence,
      block_send: parsed.block_send === true,
      retry_with_stronger_model: parsed.retry_with_stronger_model === true ||
        finalConfidence < 0.65 || !languageCheck.ok,
      issues,
    };

    if (result.issues.length > 0 || confidence < 0.8) {
      console.log(
        `[verifier] confidence=${confidence} issues=${
          result.issues.join(",")
        } contradictions=${parsed.contradictions?.length ?? 0} hallucinations=${
          parsed.hallucinations?.length ?? 0
        }`,
      );
    }

    return result;
  } catch (err) {
    console.error("[verifier] Error:", err);
    return FALLBACK_RESULT;
  }
}
