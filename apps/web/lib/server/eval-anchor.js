// Read-only classification of an eval ground-truth anchor (the human reply).
// Pure + dependency-free so the sampler, worker, and golden script all agree.
//
// Why: many "human replies" used as eval ground truth are not comparable customer
// service replies — they are the agent performing or requesting an out-of-band
// action (creating a shipment, issuing a refund, asking for SWIFT/IBAN). The AI
// has no tool/fact access to take those paths, so judging its draft directly
// against such a reply deflates scores and pollutes root-cause analysis.
//
// Classes:
//   comparable            → human reply is a normal CS reply → judge vs human as today.
//   action_required       → human asks for info/credentials or performs an action the
//                           AI has no tool/fact for (SWIFT/IBAN, "send me name+address
//                           to create the shipment"). Judge CS quality only; do NOT
//                           penalize the AI for not performing the action.
//   non_comparable_anchor → human reply IS a completed action confirmation
//                           (shipment created, refund issued, code activated,
//                           replacement sent, transfer done, order/invoice created).
//                           Exclude from the quality aggregate; report separately.
//
// Conservative by design: only the strongest cues flag a case, so `comparable`
// stays the default and a genuine CS reply is never silently dropped.

import { assessHistoricalExampleQuality } from "../../../../supabase/functions/_shared/historical-example-quality.js";

const COMPLETED_ACTION = [
  // A terse, declarative "all fixed" reply is an action confirmation, not a
  // reproducible support answer. Keep this deliberately sentence-scoped so
  // questions such as "is it all fixed?" and troubleshooting prose stay
  // comparable.
  /(?:^|[\n.!?]\s*)(?:(?:hi|hello|hey|hej|hejsa)(?:\s+(?:again|there|igen))?[,!.]?\s*)?(?:then\s+)?(?:it(?:'|’)?s\s+)?all fixed(?:\s+for you)?[.!](?=\s|$)/i,
  // shipment created / dispatched. Note: a bare carrier name is deliberately NOT
  // a signal on its own — words like "bring"/"ups" are too common and would
  // false-positive. Real confirmations carry a tracking ref or a "sent with …".
  /\btracking\s*(number|info|link)\b/i,
  /\b(har (lavet|oprettet) forsendelsen|shipment (is )?ready|made the shipment|sent (it )?with|sendt med|afsendt)\b/i,
  // Danish shipment / dispatch confirmations (object + sendt/afsendt, or "sendt afsted",
  // or a tracking reference). Scoped to an object so a bare "sendt" can't false-positive.
  /\b(dongle|pakken?|varen|ordren|den)\s+(er\s+)?(sendt|afsendt)\b/i,
  /\bsendt\s+afsted\b/i,
  /\btracking(en|et)?\b/i,
  // refund issued
  /\b(refunded|refund has been (issued|processed)|issued (a|the) refund|beløbet (er )?(tilbageført|refunderet)|via (a )?gift\s?card)\b/i,
  // Danish refund / gift card (whole words; agent replies mentioning these are
  // overwhelmingly action confirmations, while comparable stays the default).
  /\b(gavekort|refundering(en)?)\b/i,
  // discount activated
  /\b(code is now active|now active for you|koden er (nu )?aktiv|activated the (code|discount)|er (nu )?aktiveret)\b/i,
  // replacement sent
  /\b(sent you a new|sending (you )?a (new|replacement)|sender dig et nyt|nyt (headset|sæt) (er )?sendt|replacement (is )?on its way)\b/i,
  // bank transfer (completed or in progress — the AI has no tool for either)
  /\b(transfer (is )?(done|completed)|overførs(el|len)|overførsel (er )?gennemført|payment sent)\b/i,
  // order / invoice created
  /\b(created the order|oprettet ordren|invoice (is )?(created|attached|sent)|faktura (er )?(oprettet|sendt))\b/i,
  // return-label / waitlist actions completed outside Sona
  /\b(?:(?:i|we) have now|i(?:'|’)ve|we(?:'|’)ve|jeg|vi)\s+(?:nu\s+)?(?:created|made|lavet|oprettet)\s+(?:a|an|et|en)?\s*(?:return\s*|retur)?label\b/i,
  /\b(?:marked|tagged|added)\s+(?:this|the|your)?\s*(?:ticket|order|request)\s+(?:as|to)\s+(?:a\s+)?(?:back\s*order|waitlist)\b/i,
  /\bmarkeret\s+(?:denne|din|sagen|ordren|ticketen)?\s*(?:som\s+)?(?:back\s*order|venteliste)\b/i,
];

const NEEDS_OUT_OF_BAND = [
  /\b(swift|iban|bank details|bankoplysninger)\b/i,
  // asks for the identity/shipping fields needed to perform an action the AI can't do
  /\b(provide (me )?(your )?(full name|full address|phone( number)?))\b/i,
  // an explicit identity block (full name + full address) is an out-of-band
  // shipment/invoice request the AI cannot fulfil, even when phrased as a list.
  /\bfull name\b[\s\S]{0,60}\bfull address\b/i,
  /\b(need (a |an )?(phone|address|email)[^.\n]{0,30}\b(for|to)\b[^.\n]{0,30}\b(shipment|order|transfer)\b)/i,
  /\b(send me your (name|address|details))\b/i,
  /\b(oplys|udfyld)[^.\n]{0,40}(navn|adresse|telefon)[^.\n]{0,40}(forsendelse|ordre|overførsel)\b/i,
];

/**
 * Classify an eval anchor from the human (ground-truth) reply.
 * @param {{ humanReply?: string }} input
 * @returns {{ anchor_class: "comparable"|"action_required"|"non_comparable_anchor", signals: string[] }}
 */
export function classifyAnchor({ humanReply = "" } = {}) {
  const h = String(humanReply || "");
  if (!h.trim()) return { anchor_class: "comparable", signals: [] };

  const completed = [];
  for (const re of COMPLETED_ACTION) {
    if (re.test(h)) completed.push(`completed:${re.source.slice(0, 28)}`);
  }
  if (completed.length)
    return { anchor_class: "non_comparable_anchor", signals: completed };

  const needs = [];
  for (const re of NEEDS_OUT_OF_BAND) {
    if (re.test(h)) needs.push(`needs:${re.source.slice(0, 28)}`);
  }
  if (needs.length) return { anchor_class: "action_required", signals: needs };

  const quality = assessHistoricalExampleQuality({ agentReply: h });
  if (!quality.usable) {
    return {
      anchor_class: "non_comparable_anchor",
      signals: [`low_quality:${quality.reason}`],
    };
  }

  return { anchor_class: "comparable", signals: [] };
}
