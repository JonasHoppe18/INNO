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
export const PRODUCT_SUPPORT_SELECTED_REASON = "product_support_selected";

// True when the preview selector abstained and the writer should switch to
// clarification-only mode. Language-agnostic: the same reason fires for every
// language, so de/fr/en/da ambiguous messages all trigger this identically.
export function isProductSupportClarificationReason(
  reason: string | null | undefined,
): boolean {
  return reason === PRODUCT_SUPPORT_LOW_CONFIDENCE_REASON;
}

// True only when a Product Support H2 section was actually selected and injected
// (preview). Drives the topic-lock + progression guardrails. Returns & Refunds
// preview (reason "injected") and ordinary runtime (no diagnostics) are false,
// so neither path receives the Product Support guardrails.
export function shouldApplyProductSupportTopicLock(
  reason: string | null | undefined,
): boolean {
  return reason === PRODUCT_SUPPORT_SELECTED_REASON;
}

// Topic-lock + progression guardrails for a Product Support preview run where an
// H2 section WAS selected. Preview/test only — never injected in ordinary
// runtime or Returns & Refunds preview. Language-agnostic instruction; the reply
// language is handled by the existing resolver. No shop/product hardcoding.
export function buildProductSupportTopicGuardrails(): string {
  return [
    "# PRODUCT SUPPORT PREVIEW — TOPIC & PROGRESSION GUARDRAILS (explicit test/simulation run only)",
    "The customer's LIVE REQUEST is the latest customer message together with the selected Product Support topic above.",
    "Use the selected Product Support section as the PRIMARY guidance source. Treat older thread turns, quoted replies, and any legacy/secondary knowledge as SECONDARY context only.",
    "Do not answer refund, return, shipping, exchange, discount, warranty, or carrier topics that appear only in older context (earlier turns, quoted replies, legacy knowledge) unless the latest customer message explicitly asks about them.",
    "Do not repeat troubleshooting steps the customer has already said they completed. Acknowledge those completed steps and any new facts in the latest message.",
    "Advance the case: respond to what changed in the latest message and give only the next not-yet-tried step. Do not resend a near-duplicate of a previous reply.",
    "If the standard troubleshooting steps are already exhausted, ask for the remaining details needed to review the case.",
    "Do not promise or commit to warranty, repair, replacement, refund, shipment, backorder, carrier contact, or a follow-up unless that action is explicitly verified in the provided facts.",
    'Prefer wording such as "we can review the next step" rather than "we can proceed with the warranty process".',
  ].join("\n");
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
    "Do not answer or resolve an older thread topic.",
    "Do not suggest or use shipping, return, refund, exchange, discount, warranty, repair, replacement, factory reset, firmware update, pairing, carrier contact, or escalation workflows.",
    "Do not promise any action or follow-up.",
    "Do not mention internal logic.",
  ].join("\n");
}
