// Deterministic, high-precision safety net for the eval judge's hard caps.
//
// The LLM judge is instructed to set `fabrication` / `unsupported_availability`
// and cap the score, but at temperature 0 it under-recalls these — especially in
// action_required cases where it is told not to penalize missing actions. These
// detectors run on the stored draft text and are OR-ed with the model's flags so
// a missed safety issue is still capped.
//
// Design rules (kept GENERAL — never ticket-id specific):
//   - Fabrication fires only inside an explicit handoff context AND only for a
//     named person or a brand/code-like team not present in the ticket/human
//     reply — generic "support team" must NOT fire.
//   - Unsupported availability fires only when the draft asserts availability/
//     purchasability AND the customer expressed stock doubt (sold out / "in
//     stock?" / "where can I buy") — so replies where availability is explicitly
//     confirmed without customer doubt do NOT false-positive.

const AVAIL_CLAIM =
  /\b(in stock|currently available|available (in|to|for|from)\b|you can (buy|purchase|order)|purchasable|add to cart|reserve a set|spare[- ]?parts page|på lager|kan købes|tilgængelig)\b/i;
const OFFER_CLAIM =
  /\bwe (do |also )?(offer|sell)\b[\s\S]{0,60}\b(spare parts|ear ?pads|earpads|replacement|filters?)\b/i;
const PURCHASE_LINK = /https?:\/\/\S+\/(products|collections|spare-parts)\b/i;
const CUSTOMER_DOUBT =
  /\b(sold out|out of stock|in stock|are these[^.\n]*available|is (it|this) available|can i (buy|purchase|order|get)|where (can|do) i (buy|purchase)|link to purchase|restock|udsolgt|på lager|kan jeg købe)\b/i;

/**
 * The draft asserts a product/part is available/purchasable while the customer
 * expressed stock doubt — and no fact backs it. Customer-doubt gate avoids
 * false positives on ordinary confirmed-availability replies.
 */
export function detectUnsupportedAvailability(draftText, { ticketBody = "" } = {}) {
  const draft = String(draftText || "");
  const claim = AVAIL_CLAIM.test(draft) || OFFER_CLAIM.test(draft) || PURCHASE_LINK.test(draft);
  return claim && CUSTOMER_DOUBT.test(String(ticketBody || ""));
}

const HANDOFF =
  /\b(notify|inform|forward (?:this|it)|escalate (?:this|it)|loop\s+in|pass (?:this|it) on)\b([\s\S]{0,80})/i;
// brand/code-like token (internal caps, hyphenated, or contains a digit) — e.g.
// "A-LIVE". A plain lowercase "support team" is intentionally not distinctive.
const DISTINCTIVE = (phrase) => /[A-Z][\w-]*[A-Z]|[A-Za-z]-[A-Za-z]|\d/.test(phrase);

/**
 * The draft invents a person/team/department to hand off to that does not appear
 * in the ticket or the human reply. Only fires inside a handoff context.
 */
export function detectFabrication(draftText, { ticketBody = "", humanReply = "" } = {}) {
  const draft = String(draftText || "");
  const m = draft.match(HANDOFF);
  if (!m) return false;
  const window = m[2] || "";
  const ctx = `${ticketBody || ""}\n${humanReply || ""}`.toLowerCase();
  const notInCtx = (s) => Boolean(s) && !ctx.includes(s.trim().toLowerCase());

  const persons = window.match(/\b[A-ZÆØÅ][a-zæøå]+\s+[A-ZÆØÅ][a-zæøå]+\b/g) || [];
  if (persons.some(notInCtx)) return true;

  const teams = window.match(/\b[A-Za-z0-9][\w-]*(?:\s+[\w-]+){0,2}\s+(?:team|leads|department)\b/gi) || [];
  return teams.some((t) => DISTINCTIVE(t) && notInCtx(t));
}

/**
 * Combined deterministic hard-cap signals for OR-ing with the model's flags.
 * @param {string} draftText
 * @param {{ ticketBody?: string, humanReply?: string }} ctx
 */
export function detectHardCapSignals(draftText, ctx = {}) {
  return {
    fabrication: detectFabrication(draftText, ctx),
    unsupported_availability: detectUnsupportedAvailability(draftText, ctx),
  };
}
