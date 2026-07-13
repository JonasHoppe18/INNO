// supabase/functions/generate-draft-v2/stages/conversation-closing.ts
//
// Pre-writer, PURE assessment: is the customer's latest message a PURE
// closing acknowledgment on a thread whose request was ALREADY handled?
// When it is, the pipeline can skip the writer entirely and suggest the
// thread as ready-to-close instead of generating a (potentially wrong)
// draft reply to a "yes thanks".
//
// Fail-safe by design: any missing/uncertain signal => suggestClose:false.
// Never throws, no I/O, shop-agnostic.

const CLOSING_INTENTS = new Set(["thanks", "update"]);

const MAX_TEXT_LENGTH = 200;

// Word-ish boundary that also treats Danish æ/ø/å as word characters, so
// e.g. "også" (ends in "å") is correctly bounded. A plain `\b` fails on
// these because JS's `\b` is ASCII-only: "å" is NOT in `\w`, so the
// boundary between "å" and a following space/punctuation never fires,
// silently letting "også" slip through an ordinary `\bogså\b` regex.
const DA_WORD_CLASS = "A-Za-z0-9_æøåÆØÅ";
const NOT_WORD_BEHIND = `(?<![${DA_WORD_CLASS}])`;
const NOT_WORD_AHEAD = `(?![${DA_WORD_CLASS}])`;

const NEW_ASK_MARKERS = new RegExp(
  `${NOT_WORD_BEHIND}(but|however|men|dog|også|also|kan i|can you|could you|would you|hvornår|when|where|hvor|still|endnu|desværre|problem|virker ikke|doesn'?t work|not work|wrong|forkert|fejl|issue|mangler|missing|refund|return|cancel|instead)${NOT_WORD_AHEAD}`,
  "i",
);

const NEGATIVE_SENTIMENT = new RegExp(
  `${NOT_WORD_BEHIND}(terrible|awful|useless|disappointed|angry|for nothing|elendig|dårlig|utilfreds|skuffet)${NOT_WORD_AHEAD}`,
  "i",
);

export type ConversationClosingAssessment = {
  suggestClose: boolean;
  reason: string | null;
};

export function assessConversationClosing(input: {
  intent: string;
  latestCustomerText: string;
  priorAgentResolution: boolean;
  openAsksCount: number;
}): ConversationClosingAssessment {
  const fail = (reason: string): ConversationClosingAssessment => ({ suggestClose: false, reason });

  const intent = String(input?.intent ?? "").trim().toLowerCase();
  if (!CLOSING_INTENTS.has(intent)) {
    return fail("intent_not_closing");
  }

  if (input?.priorAgentResolution !== true) {
    return fail("no_prior_resolution");
  }

  const openAsksCount = typeof input?.openAsksCount === "number" ? input.openAsksCount : null;
  if (openAsksCount === null || openAsksCount !== 0) {
    return fail("open_asks");
  }

  const text = String(input?.latestCustomerText ?? "").trim();
  if (!text) {
    return fail("empty_text");
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return fail("too_long");
  }

  if (text.includes("?")) {
    return fail("has_question");
  }

  if (NEW_ASK_MARKERS.test(text)) {
    return fail("new_ask_marker");
  }

  if (NEGATIVE_SENTIMENT.test(text)) {
    return fail("negative_sentiment");
  }

  return { suggestClose: true, reason: "pure_closing_acknowledgment" };
}
