// supabase/functions/generate-draft-v2/stages/unsupported-commitment-check.ts
//
// Pure, deterministic post-writer safety check. NO DB / NO API / NO LLM.
//
// The writer occasionally promises a high-risk outcome (refund, prepaid return
// label, replacement, exchange, document delivery) before any corresponding
// action has been approved. Prompt-only guardrails do not reliably prevent
// this on every model. This module catches these high-risk commitment
// families with conservative, precision-first phrase patterns (English +
// Danish) and reports whether the draft should be routed to human review.
//
// This module NEVER rewrites the draft, NEVER executes actions, and is
// shop-agnostic — no shop ids, no per-shop branching.

export type UnsupportedCommitmentViolationType =
  | "unsupported_refund_promise"
  | "unsupported_prepaid_label_promise"
  | "unsupported_replacement_promise"
  | "unsupported_exchange_promise"
  | "unsupported_document_promise";

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
  // Optional whole-draft context gate. Pronoun-form promises ("vi sørger for,
  // at du får den tilsendt") only count for this family when the draft
  // mentions the family's subject noun somewhere — the sentence-scoped
  // patterns can't resolve the pronoun's antecedent, the draft-level gate can.
  draftContextRequirement?: RegExp;
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
      // READINESS-6c: variant-swap promise phrased as "sende dig den <farve/
      // anden> model/vare" — an exchange promise without the word "ombytte".
      // Anchored on a product noun so "vi sender dig et link" never matches.
      /\b(?:vi|jeg)\s+vil\s+(?:derefter\s+|så\s+)?sende\s+(?:dig\s+)?(?:den|det|en|et)\s+\w+\s+(?:model|vare|produkt|farve|størrelse|version)\b/i,
      /\bvil\s+(?:vi|jeg)\s+sende\s+(?:dig\s+)?(?:den|det|en|et)\s+\w+\s+(?:model|vare|produkt|farve|størrelse|version)\b/i,
      // EN variant-swap promise: "we'll (then) send you the black model"
      /\b(?:we|i)(?:['’]ll| will)\s+(?:then\s+)?send\s+(?:you\s+)?the\s+\w+\s+(?:model|colou?r|size|version|one)\b/i,
      // DA already-done claims
      /\bvi\s+har\s+(?:ombyttet|startet\s+ombytningen)\b/i,
    ],
  },
  // READINESS-4: document-delivery promises (invoice / receipt / order
  // confirmation). resend_confirmation_or_invoice is a real, executable
  // action, so a promise in this narrow scope may be authorized by it —
  // but only this scope. Split from the credit-note/label/warranty family
  // below so an approved resend_confirmation_or_invoice can never authorize
  // those unsupported document types (no action exists for them at all).
  {
    violationType: "unsupported_document_promise",
    authorizingActionType: /resend_confirmation_or_invoice/i,
    commitmentPatterns: [
      // EN future
      /\b(?:i|we)(?:['’]ll| will)\s+send\s+(?:you\s+)?(?:the\s+|your\s+|an?\s+)?(?:invoice|receipt|order confirmation)\b/i,
      /\b(?:i|we)(?:['’]ll| will)\s+make sure\s+(?:the\s+|your\s+|an?\s+)?(?:invoice|receipt|order confirmation)\s+(?:is|gets)\s+sent\b/i,
      /\b(?:the\s+|your\s+)?(?:invoice|receipt|order confirmation)\s+will\s+be\s+sent\b/i,
      // DA future — active
      /\b(?:jeg|vi)\s+sender\s+(?:dig\s+)?(?:fakturaen|din\s+faktura|en\s+faktura|kvitteringen|din\s+kvittering|en\s+kvittering|ordrebekræftelsen|en\s+(?:ny\s+)?ordrebekræftelse)\b/i,
      /\b(?:jeg|vi)\s+sørger\s+for,?\s+at\s+du\s+får\s+(?:fakturaen|din\s+faktura|en\s+faktura|kvitteringen|ordrebekræftelsen)\s+(?:tilsendt|sendt)\b/i,
      // DA future — passive ("du får ... sendt/tilsendt")
      /\bdu\s+får\s+(?:fakturaen|din\s+faktura|kvitteringen|ordrebekræftelsen)\s+(?:tilsendt|sendt)\b/i,
    ],
  },
  // READINESS-6b: pronoun-form document-delivery promises ("vi sørger for,
  // at du får den tilsendt", "we'll send it to you") where the document noun
  // lives in a NEIGHBOURING sentence. The sentence-scoped noun patterns above
  // can't see the antecedent, so these pronoun patterns are gated on a
  // document noun appearing anywhere in the draft.
  {
    violationType: "unsupported_document_promise",
    authorizingActionType: /resend_confirmation_or_invoice/i,
    draftContextRequirement:
      /\b(?:faktura(?:en)?|kvittering(?:en)?|ordrebekræftelse(?:n)?|invoice|receipt|order\s+confirmation)\b/i,
    commitmentPatterns: [
      // DA active: "jeg/vi sørger for, at du får den/det/dem tilsendt/sendt"
      /\b(?:jeg|vi)\s+sørger\s+for,?\s+at\s+du\s+får\s+(?:den|det|dem)\s+(?:tilsendt|sendt|fremsendt)\b/i,
      // DA passive: "du får den/det/dem tilsendt/sendt"
      /\bdu\s+får\s+(?:den|det|dem)\s+(?:tilsendt|sendt|fremsendt)\b/i,
      // DA active: "jeg/vi sender den/det/dem (til dig)"
      /\b(?:jeg|vi)\s+sender\s+(?:den|det|dem)\s+(?:til\s+dig|hurtigst|snarest)\b/i,
      // EN: "I/we will send it (to you / over / shortly)"
      /\b(?:i|we)(?:['’]ll| will)\s+send\s+it\s+(?:to\s+you|over|shortly|right\s+away|as\s+soon\s+as)\b/i,
      // EN: "we'll make sure you get/receive it"
      /\b(?:i|we)(?:['’]ll| will)\s+make\s+sure\s+you\s+(?:get|receive)\s+it\b/i,
    ],
  },
  // READINESS-4: document-delivery promises for document types with no
  // backing action today (credit note, return/shipping label, warranty
  // document). Never authorized — the authorizingActionType intentionally
  // matches no real action type so these always require review.
  {
    violationType: "unsupported_document_promise",
    authorizingActionType: /^no_supported_action_exists$/,
    commitmentPatterns: [
      // EN future
      /\b(?:i|we)(?:['’]ll| will)\s+send\s+(?:you\s+)?(?:a\s+|an\s+|the\s+|your\s+)?(?:credit note|warranty document)\b/i,
      /\b(?:a\s+|the\s+|your\s+)?(?:credit note|return label|shipping label|warranty document)\s+will\s+be\s+sent\b/i,
      // DA future — active (kreditnota / garantidokument; returlabel/fragtlabel
      // active-voice already covered by unsupported_prepaid_label_promise above)
      /\b(?:jeg|vi)\s+sender\s+(?:dig\s+)?(?:en\s+)?(?:kreditnota|garantidokument\w*)\b/i,
      // DA future — passive ("du får ... sendt/tilsendt")
      /\bdu\s+får\s+(?:en\s+)?(?:returlabel|kreditnota|fragtlabel|garantidokument\w*)\s+(?:sendt|tilsendt)\b/i,
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
      if (
        family.draftContextRequirement &&
        !family.draftContextRequirement.test(draftText)
      ) {
        continue;
      }
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
