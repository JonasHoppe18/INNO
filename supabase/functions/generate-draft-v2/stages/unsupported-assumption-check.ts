// supabase/functions/generate-draft-v2/stages/unsupported-assumption-check.ts
//
// Pure, deterministic post-writer safety check. NO DB / NO API / NO LLM.
//
// The writer occasionally invents a "gift" / "original purchaser" scenario in
// warranty / third-party-purchase cases: it asks the customer for the details
// of "the person who gifted it to you" even though the customer never said the
// product was a gift. This is seeded by warranty knowledge that stresses
// non-transferability / original-purchaser rules, which the model conflates
// with a gift. Prompt-only guardrails do not reliably prevent it.
//
// This module flags a draft that references a gift/gifter/original-purchaser
// when the conversation contains NO explicit gift wording, so the draft is
// routed to human review instead of being sent.
//
// This module NEVER rewrites the draft, NEVER executes actions, and is
// shop-agnostic — no shop ids, no per-shop branching.

export type UnsupportedAssumptionViolationType = "ungrounded_gift_assumption";

export type UnsupportedAssumptionCheckInput = {
  draft_text: string;
  // The full conversation context to test for explicit gift wording: the
  // current customer message plus any prior customer-authored text.
  conversation_text: string;
};

export type UnsupportedAssumptionCheckResult = {
  compliant: boolean;
  violations: Array<{
    type: UnsupportedAssumptionViolationType;
    excerpt: string;
  }>;
  requires_review: boolean;
};

// Draft phrases that assert/assume a gift or someone-else-purchased scenario,
// or ask for the original purchaser / gifter's details. EN + DA, conservative.
const GIFT_ASSUMPTION_PATTERNS: RegExp[] = [
  /\bgifted\s+to\s+you\b/i,
  /\bperson\s+who\s+gifted\s+it\b/i,
  /\bthe\s+gifter\b/i,
  /\bwho\s+gifted\s+(?:it|the|you)\b/i,
  /\bperson\s+who\s+(?:bought|purchased|gave)\s+(?:it|the|you)\b/i,
  /\boriginal\s+purchaser\b/i,
  // DA
  /\bden\s+der\s+(?:gav|forærede|købte)\s+dig\b/i,
  /\boprindelige?\s+køber\b/i,
  /\bden\s+der\s+gav\s+dig\s+(?:den|produktet|headsettet)\b/i,
];

// Explicit gift / bought-by-someone-else wording in the customer conversation.
// Only when ONE of these is present is the gift framing considered grounded.
// "gift card" is excluded — that is a different topic, not a gifted product.
const EXPLICIT_GIFT_CONTEXT_PATTERNS: RegExp[] = [
  /\bgift(?!\s*card)\b/i,
  /\bgifted\b/i,
  /\bpresent\b/i,
  /\b(?:my|a)\s+(?:friend|partner|husband|wife|mother|father|parent|son|daughter|brother|sister|boyfriend|girlfriend|colleague)\s+(?:bought|gave|purchased|got)\b/i,
  /\bbought\s+(?:it\s+)?for\s+me\b/i,
  /\bsomeone\s+else\s+(?:bought|purchased|gave)\b/i,
  // DA
  /\bgave\b/i,
  /\bforæret\b/i,
  /\bforærede\b/i,
  /\bi\s+gave\b/i, // "i gave" = "as a gift" in Danish
  /\bkøbt\s+(?:til\s+mig|af\s+(?:min|en\s+anden))\b/i,
];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildExcerpt(sentence: string): string {
  const MAX_LEN = 140;
  if (sentence.length <= MAX_LEN) return sentence;
  return `${sentence.slice(0, MAX_LEN).trim()}…`;
}

export function hasExplicitGiftContext(conversationText: string): boolean {
  const text = conversationText ?? "";
  if (!text.trim()) return false;
  return EXPLICIT_GIFT_CONTEXT_PATTERNS.some((re) => re.test(text));
}

export function checkUnsupportedAssumptions(
  input: UnsupportedAssumptionCheckInput,
): UnsupportedAssumptionCheckResult {
  const draftText = input.draft_text ?? "";
  if (!draftText.trim()) {
    return { compliant: true, violations: [], requires_review: false };
  }

  // If the customer explicitly framed the purchase as a gift / bought by
  // someone else, gift wording in the draft is grounded — do not flag.
  if (hasExplicitGiftContext(input.conversation_text ?? "")) {
    return { compliant: true, violations: [], requires_review: false };
  }

  const violations: UnsupportedAssumptionCheckResult["violations"] = [];
  for (const sentence of splitSentences(draftText)) {
    if (GIFT_ASSUMPTION_PATTERNS.some((re) => re.test(sentence))) {
      violations.push({
        type: "ungrounded_gift_assumption",
        excerpt: buildExcerpt(sentence),
      });
    }
  }

  return {
    compliant: violations.length === 0,
    violations,
    requires_review: violations.length > 0,
  };
}
