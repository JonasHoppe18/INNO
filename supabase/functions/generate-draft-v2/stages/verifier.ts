// supabase/functions/generate-draft-v2/stages/verifier.ts
import { ResolvedFact } from "./fact-resolver.ts";
import { RetrievedChunk } from "./retriever.ts";
import { ActionProposal } from "./action-decision.ts";
import { mixedLanguageCheck } from "./language.ts";
import { callOpenAIJson } from "./openai-json.ts";
import { detectPrematureReplacementShipment } from "./replacement-flow.ts";
import {
  containsLinkPlaceholder,
  detectOrdinaryProductLinkCheckoutViolation,
} from "./purchase-link.ts";
import {
  detectFabricatedReturnAddress,
  groundedReturnAddresses,
  isReturnRefundIntent,
  selectReturnsPolicyContents,
} from "./returns-grounding.ts";

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
  conversationHistory?: Array<{ role?: string; text?: string | null }>;
  primaryIntent?: string;
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
  // Fail closed. A verifier outage is not evidence that a draft is safe to
  // auto-send; the pipeline must route it to human review.
  block_send: true,
  retry_with_stronger_model: true,
  issues: ["verifier_api_error"],
};

const STOCK_AVAILABLE_RE =
  /\b(?:på lager|in stock|currently available|available in (?:our|the) store|tilgængelig i (?:vores|web)?shoppen|kan købes)\b/i;
const STOCK_OUT_RE =
  /\b(?:ikke på lager|udsolgt|out of stock|sold out|currently unavailable|not currently available)\b/i;
const RESTOCK_PROMISE_RE =
  /\b(?:back in stock|restock(?:ed)?|tilbage på lager|kommer på lager igen|restockes).{0,100}(?:\d{1,2}|tomorrow|next week|next month|within|by|on|i næste uge|næste måned|den\s+\d{1,2})\b/i;
const PREORDER_PROMISE_RE =
  /\b(?:preorder|pre-order|forudbestil|forudbestilling|restordre).{0,100}\b(?:available|yes|can|possible|muligt|kan|tilgængelig)\b/i;
const EXACT_STOCK_QUANTITY_RE =
  /\b\d+\s*(?:stk\.?|styk\.?|pcs?\.?|units?)\s*(?:på lager|tilbage|left|available|in stock)\b/i;

function stockFactStates(facts: ResolvedFact[]): Set<string> {
  const states = new Set<string>();
  for (const fact of facts) {
    if (fact.label !== "Live stock availability") continue;
    const match = /(?:^|;\s*)state=([^;]+)/.exec(fact.value);
    if (match?.[1]) states.add(match[1].trim());
  }
  return states;
}

export function detectUnsupportedStockClaims(
  draftText: string,
  facts: ResolvedFact[],
): string[] {
  const states = stockFactStates(facts);
  const issues: string[] = [];
  if (STOCK_AVAILABLE_RE.test(draftText) && !states.has("in_stock")) {
    issues.push("unsupported_stock_claim");
  }
  if (
    STOCK_OUT_RE.test(draftText) &&
    !states.has("out_of_stock") &&
    !states.has("unavailable") &&
    !states.has("discontinued")
  ) {
    issues.push("unsupported_stock_claim");
  }
  if (RESTOCK_PROMISE_RE.test(draftText)) {
    issues.push("unsupported_restock_promise");
  }
  if (PREORDER_PROMISE_RE.test(draftText) && !states.has("preorder")) {
    issues.push("unsupported_preorder_promise");
  }
  if (EXACT_STOCK_QUANTITY_RE.test(draftText)) {
    issues.push("unsupported_stock_quantity");
  }
  return [...new Set(issues)];
}

export async function runVerifier(
  {
    draftText,
    proposedActions,
    citations,
    facts,
    retrievedChunks,
    customerMessage,
    conversationHistory,
    primaryIntent,
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
    const stockIssues = detectUnsupportedStockClaims(draftText, facts.facts);
    for (const issue of stockIssues) {
      if (!issues.includes(issue)) issues.push(issue);
    }
    const orderKnown = facts.facts.some((f) => f.label === "Ordre fundet");
    const replacementIssues = detectPrematureReplacementShipment(draftText, {
      orderKnown,
    });
    for (const issue of replacementIssues) {
      if (!issues.includes(issue)) issues.push(issue);
    }
    // Deterministic placeholder guard: a draft must never ship a link
    // placeholder like "[indsæt link her]" / "[link]" / "insert link here".
    const placeholderViolation = containsLinkPlaceholder(draftText);
    if (placeholderViolation && !issues.includes("link_placeholder")) {
      issues.push("link_placeholder");
    }
    // Deterministic ordinary-product-link guard: an ordinary product-page link
    // request (not an explicit checkout-link request, not the manual-checkout
    // flow) must not use checkout/payment/cart-link wording.
    const checkoutWordingViolation = detectOrdinaryProductLinkCheckoutViolation(
      draftText,
      { customerMessage, conversationHistory },
    );
    if (checkoutWordingViolation && !issues.includes("ordinary_product_link_checkout_wording")) {
      issues.push("ordinary_product_link_checkout_wording");
    }
    // Deterministic returns-address guard: a return/refund draft must not
    // contain a fabricated/placeholder return address (only the grounded
    // Denmark/US addresses from the canonical Returns & Refunds doc are allowed).
    const returnAddressViolation = detectFabricatedReturnAddress(draftText, {
      isReturnRefundIntent: isReturnRefundIntent(primaryIntent, customerMessage),
      groundedAddresses: groundedReturnAddresses(
        selectReturnsPolicyContents(retrievedChunks),
      ),
    });
    if (returnAddressViolation && !issues.includes("fabricated_return_address")) {
      issues.push("fabricated_return_address");
    }
    const stockViolation = stockIssues.length > 0;
    const replacementViolation = replacementIssues.length > 0;
    const finalConfidence = languageCheck.ok && !stockViolation &&
        !replacementViolation && !placeholderViolation &&
        !checkoutWordingViolation && !returnAddressViolation
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
      block_send: parsed.block_send === true || replacementViolation ||
        placeholderViolation || checkoutWordingViolation ||
        returnAddressViolation,
      retry_with_stronger_model: parsed.retry_with_stronger_model === true ||
        finalConfidence < 0.65 || !languageCheck.ok || needsRetryForCommitment ||
        stockViolation || replacementViolation || placeholderViolation ||
        checkoutWordingViolation || returnAddressViolation,
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
