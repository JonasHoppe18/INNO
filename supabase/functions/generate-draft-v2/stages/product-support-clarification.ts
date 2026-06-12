// Product Support PREVIEW — clarification-only mode helpers.
//
// When the section selector abstains (no matching section), the writer is put
// into "clarification-only" mode: it must ask exactly ONE clarification
// question in the customer's already-resolved language, with all troubleshooting
// knowledge suppressed.
//
// IMPORTANT: there is NO hardcoded reply text per language. This builds a single
// language-agnostic INSTRUCTION that tells the writer to answer in the resolved
// language (passed as an ISO code). Multilingual behavior therefore comes from
// the existing writer language resolver — not from canned per-language strings,
// and with no shop/product hardcoding.

export const PRODUCT_SUPPORT_LOW_CONFIDENCE_REASON = "product_support_low_confidence";

// True when the preview selector abstained and the writer should switch to
// clarification-only mode. Language-agnostic: the same reason fires for every
// language, so de/fr/en/da ambiguous messages all trigger this identically.
export function isProductSupportClarificationReason(
  reason: string | null | undefined,
): boolean {
  return reason === PRODUCT_SUPPORT_LOW_CONFIDENCE_REASON;
}

// Builds the strict clarification-only writer directive. `replyLanguage` is the
// resolved ISO code (e.g. "en", "da", "de", "fr") — embedded so the model
// replies in the customer's language. No canned answer text, no shop names.
export function buildClarificationDirective(replyLanguage: string): string {
  const lang = String(replyLanguage || "en").trim() || "en";
  return [
    "# CLARIFICATION-ONLY MODE (mandatory — overrides everything else)",
    "The customer's issue is too unclear to select a troubleshooting guide.",
    `Reply with exactly one concise clarification question in the customer's language (${lang}).`,
    "Do not provide troubleshooting steps.",
    "Do not suggest factory reset, firmware update, pairing, replacement, refund or escalation.",
    "Do not mention internal logic.",
  ].join("\n");
}
