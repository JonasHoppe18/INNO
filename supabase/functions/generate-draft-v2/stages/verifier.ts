// supabase/functions/generate-draft-v2/stages/verifier.ts
import { ResolvedFact } from "./fact-resolver.ts";
import { RetrievedChunk } from "./retriever.ts";
import { ActionProposal } from "./action-decision.ts";
import { mixedLanguageCheck } from "./language.ts";
import { callOpenAIJson } from "./openai-json.ts";

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

const VERIFIER_MODEL = Deno.env.get("OPENAI_VERIFIER_MODEL") ??
  Deno.env.get("OPENAI_MODEL") ??
  "gpt-5-mini";

const VERIFIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answers_question: { type: "boolean" },
    language_correct: { type: "boolean" },
    contradictions: { type: "array", items: { type: "string" } },
    hallucinations: { type: "array", items: { type: "string" } },
    return_window_misapplied: { type: "boolean" },
    commits_to_next_step: { type: "boolean" },
    grounded_claims_pct: { type: "number" },
    confidence: { type: "number" },
    issues: { type: "array", items: { type: "string" } },
    block_send: { type: "boolean" },
    retry_with_stronger_model: { type: "boolean" },
  },
  required: [
    "answers_question",
    "language_correct",
    "contradictions",
    "hallucinations",
    "return_window_misapplied",
    "commits_to_next_step",
    "grounded_claims_pct",
    "confidence",
    "issues",
    "block_send",
    "retry_with_stronger_model",
  ],
};

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
  {
    draftText,
    proposedActions,
    citations,
    facts,
    retrievedChunks,
    customerMessage,
    language,
  }: VerifierInput,
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
True ONLY for: direct contradiction of facts, harmful/offensive content, completely wrong topic, OR when commits_to_next_step=false AND the draft is clearly about a warranty replacement / exchange / refund situation where the customer has already confirmed their details and no concrete order creation or refund timeline is stated (e.g., draft says "Vi sender dig et nyt" without "Vi opretter en ordre").

**commits_to_next_step** (boolean)
Does the reply commit to a CONCRETE next action or clearly describe what happens now?
TRUE: "Vi opretter en ordre til dig", "Vi sender tracking-link", "Vi kontakter dig i juli med faktura", "Vi returnerer beløbet inden for X dage"
FALSE: "vi vender tilbage", "du vil høre fra os", "I'll review this and follow up", "vi undersøger sagen internt"
Only applies when the customer's situation calls for a concrete next step (warranty, exchange, refund, confirmed address). For informational replies (tracking status, product questions) this can be true even without a commitment.
Deduct 0.1 from confidence if commits_to_next_step=false and the intent is clearly warranty/exchange/return/refund/complaint.

**retry_with_stronger_model** (boolean)
True if confidence < 0.65 or mixed_language is present.

**issues** (array of short strings)
Machine-readable list of what went wrong. Use: answers_question_missing, wrong_language, mixed_language, contradiction, hallucination, return_window_misapplied, low_grounding, no_commitment`;

  try {
    const parsed = await callOpenAIJson<{
      grounded_claims_pct?: number;
      contradictions?: string[];
      hallucinations?: string[];
      return_window_misapplied?: boolean;
      commits_to_next_step?: boolean;
      confidence?: number;
      block_send?: boolean;
      retry_with_stronger_model?: boolean;
      issues?: string[];
    }>({
      model: VERIFIER_MODEL,
      systemPrompt,
      userPrompt,
      maxTokens: 700,
      schema: VERIFIER_SCHEMA,
      schemaName: "draft_v2_verifier",
    });

    let confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.7;

    // Apply commitment penalty if verifier flagged it (catches vague "vi vender tilbage" replies)
    if (parsed.commits_to_next_step === false) {
      confidence = Math.max(0, confidence - 0.2);
    }

    const languageCheck = mixedLanguageCheck(draftText, language);
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    if (!languageCheck.ok && !issues.includes("mixed_language")) {
      issues.push("mixed_language");
    }
    if (parsed.commits_to_next_step === false && !issues.includes("no_commitment")) {
      issues.push("no_commitment");
    }
    const finalConfidence = languageCheck.ok
      ? confidence
      : Math.min(confidence, 0.62);

    const commitmentRequiredActions = new Set([
      "refund_order",
      "create_exchange_request",
      "initiate_return",
      "send_return_instructions",
      "create_return_with_label",
    ]);
    const hasCommitmentRequiredAction = proposedActions?.some((a) =>
      commitmentRequiredActions.has(a.type)
    ) ?? false;
    const needsRetryForCommitment = issues.includes("no_commitment") &&
      hasCommitmentRequiredAction;

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
        finalConfidence < 0.65 || !languageCheck.ok || needsRetryForCommitment,
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
