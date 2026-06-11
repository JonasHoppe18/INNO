// supabase/functions/generate-draft-v2/stages/unsupported-commitment-check.ts
//
// Pure, deterministic post-writer safety check. NO DB / NO API / NO LLM.
//
// The writer occasionally promises a high-risk outcome (refund, prepaid return
// label, replacement, exchange) before any corresponding action has been
// approved. Prompt-only guardrails do not reliably prevent this on every model.
// This module catches the four highest-risk commitment families with
// conservative, precision-first phrase patterns (English + Danish) and reports
// whether the draft should be routed to human review.
//
// This module NEVER rewrites the draft, NEVER executes actions, and is
// shop-agnostic — no shop ids, no per-shop branching.

export type UnsupportedCommitmentViolationType =
  | "unsupported_refund_promise"
  | "unsupported_prepaid_label_promise"
  | "unsupported_replacement_promise"
  | "unsupported_exchange_promise";

export type UnsupportedCommitmentCheckInput = {
  draft_text: string;
  approved_actions?: Array<{
    type: string;
    lifecycle_stage?: string;
  }>;
  suggested_actions?: Array<{
    type: string;
    lifecycle_stage?: string;
  }>;
  language?: string | null;
};

export type UnsupportedCommitmentCheckResult = {
  compliant: boolean;
  violations: Array<{
    type: UnsupportedCommitmentViolationType;
    excerpt: string;
  }>;
  requires_review: boolean;
};

type CommitmentFamily = {
  violationType: UnsupportedCommitmentViolationType;
  // Action-type matcher: an approved action whose `type` matches this regex
  // authorizes a commitment in this family.
  authorizingActionType: RegExp;
  // Conservative, definite-commitment phrase patterns (EN + DA). Hedged /
  // conditional / passive phrasings ("may be eligible", "may be provided if")
  // deliberately do NOT match these — they use "will"/"'ll"/Danish "vil" +
  // an active first-person verb, never "may"/"might"/"could"/"kan".
  commitmentPatterns: RegExp[];
};

// Hedge / conditional markers. If present in the same sentence as an otherwise
// matching commitment phrase, the sentence is treated as a conditional policy
// statement rather than an unconditional promise, and is NOT flagged.
const HEDGE_RE =
  /\b(?:if (?:approved|the case is approved|eligible)|once approved|subject to approval|after approval|may be eligible|hvis (?:godkendt|sagen (?:bliver |er )?godkendt)|efter godkendelse)\b/i;

const FAMILIES: CommitmentFamily[] = [
  {
    violationType: "unsupported_refund_promise",
    authorizingActionType: /refund/i,
    commitmentPatterns: [
      // EN future: "we will issue/give/send/make/provide ... a refund"
      /\b(?:we|i)(?:'ll| will)\s+(?:[a-z]+\s+){0,2}(?:issue|give|send|make|provide)\s+(?:you\s+)?(?:a\s+|an\s+|the\s+|your\s+)?refund\b/i,
      // EN future: "we will refund you/it" / "we will process your/the refund"
      /\b(?:we|i)(?:'ll| will)\s+refund\s+(?:you|it)\b/i,
      /\b(?:we|i)(?:'ll| will)\s+process\s+(?:your|the)\s+refund\b/i,
      // EN already-done claims
      /\b(?:we(?:'ve| have))\s+(?:[a-z]+\s+){0,4}refund(?:ed)?\b/i,
      /\b(?:the|your)\s+refund\s+has\s+been\s+(?:issued|processed)\b/i,
      // DA future
      /\bvi\s+(?:vil\s+)?(?:refunderer|refundere|tilbagebetaler|tilbagebetale)\b/i,
      /\bvi\s+(?:vil\s+)?sender?\s+dig\s+(?:en\s+)?refundering\b/i,
      // DA already-done claims
      /\bvi\s+har\s+(?:refunderet|tilbagebetalt)\b/i,
      /\bbeløbet\s+er\s+(?:blevet\s+)?refunderet\b/i,
    ],
  },
  {
    violationType: "unsupported_prepaid_label_promise",
    authorizingActionType: /label|prepaid|initiate_return|create_return|return_instructions/i,
    commitmentPatterns: [
      // EN future: "we will send/create/email/provide ... (prepaid) return label"
      /\b(?:we|i)(?:'ll| will)\s+(?:[a-z]+\s+){0,4}(?:prepaid\s+)?(?:return\s+)?(?:shipping\s+)?label\b/i,
      // EN present-tense delivery framing ("here is your return label")
      /\bhere\s+is\s+your\s+(?:prepaid\s+)?(?:return\s+)?label\b/i,
      // EN already-done claims
      /\b(?:we(?:'ve| have))\s+(?:[a-z]+\s+){0,4}(?:prepaid\s+)?(?:return\s+)?label\b/i,
      // DA future
      /\b(?:vi|jeg)\s+(?:vil\s+)?(?:sender?|opretter?)\s+(?:dig\s+)?(?:en\s+)?(?:forudbetalt\s+)?returlabel\b/i,
      // DA already-done claims
      /\b(?:vi|jeg)\s+har\s+(?:sendt|oprettet)\s+(?:dig\s+)?(?:en\s+)?(?:forudbetalt\s+)?returlabel\b/i,
    ],
  },
  {
    violationType: "unsupported_replacement_promise",
    authorizingActionType: /replac/i,
    commitmentPatterns: [
      // EN future: "we will replace ..." / "we will send (you) a replacement"
      /\b(?:we|i)(?:'ll| will)\s+replace\b/i,
      /\b(?:we|i)(?:'ll| will)\s+send\s+(?:you\s+)?(?:a\s+|an\s+)?replacement\b/i,
      // EN already-done claims
      /\b(?:we(?:'ve| have))\s+(?:already\s+)?(?:replaced|sent\s+(?:you\s+)?(?:a\s+|an\s+)?replacement)\b/i,
      /\ba\s+replacement\s+has\s+been\s+sent\b/i,
      // DA future — "et nyt"/"en ny" excluded when followed by tracking/label/
      // number wording (those refer to tracking info, not a product replacement).
      /\b(?:vi|jeg)\s+(?:vil\s+)?(?:sender?|erstatter?)\s+(?:dig\s+)?(?:en\s+)?erstatning\b/i,
      /\b(?:vi|jeg)\s+(?:vil\s+)?sender?\s+(?:dig\s+)?(?:et\s+nyt|en\s+ny)\b(?!\s*(?:track|link|nummer|label))/i,
      // DA already-done claims
      /\bvi\s+har\s+sendt\s+(?:dig\s+)?(?:en\s+)?erstatning\b/i,
    ],
  },
  {
    violationType: "unsupported_exchange_promise",
    authorizingActionType: /exchange/i,
    commitmentPatterns: [
      // EN future: "we will exchange ..." / "we will arrange/process the/an exchange"
      /\b(?:we|i)(?:'ll| will)\s+exchange\b/i,
      /\b(?:we|i)(?:'ll| will)\s+(?:arrange|process|set up)\s+(?:an?\s+|the\s+)?exchange\b/i,
      // EN already-done claims
      /\b(?:we(?:'ve| have))\s+(?:already\s+)?(?:exchanged|started\s+the\s+exchange)\b/i,
      /\bthe\s+exchange\s+has\s+been\s+(?:started|processed)\b/i,
      // DA future
      /\b(?:vi|jeg)\s+(?:vil\s+)?ombytter?\b/i,
      // DA already-done claims
      /\bvi\s+har\s+(?:ombyttet|startet\s+ombytningen)\b/i,
    ],
  },
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

export function checkUnsupportedCommitments(
  input: UnsupportedCommitmentCheckInput,
): UnsupportedCommitmentCheckResult {
  const draftText = input.draft_text ?? "";
  if (!draftText.trim()) {
    return { compliant: true, violations: [], requires_review: false };
  }

  const approvedTypes = (input.approved_actions ?? []).map((a) => a.type);

  const sentences = splitSentences(draftText);
  const violations: UnsupportedCommitmentCheckResult["violations"] = [];

  for (const sentence of sentences) {
    if (HEDGE_RE.test(sentence)) continue;

    for (const family of FAMILIES) {
      const matches = family.commitmentPatterns.some((re) => re.test(sentence));
      if (!matches) continue;

      const isAuthorized = approvedTypes.some((type) =>
        family.authorizingActionType.test(type)
      );
      if (isAuthorized) continue;

      violations.push({
        type: family.violationType,
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
