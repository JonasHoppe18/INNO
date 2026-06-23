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

const COMPLETED_ACTION = [
  // shipment created / dispatched
  /\btracking\s*(number|info|link)\b/i,
  /\b(har (lavet|oprettet) forsendelsen|shipment (is )?ready|made the shipment|sent (it )?with|sendt med|afsendt)\b/i,
  /\b(fedex|postnord|gls|dhl|ups|dao|bring)\b/i,
  // refund issued
  /\b(refunded|refund has been (issued|processed)|issued (a|the) refund|beløbet (er )?(tilbageført|refunderet)|via (a )?gift\s?card)\b/i,
  // discount activated
  /\b(code is now active|now active for you|koden er (nu )?aktiv|activated the (code|discount)|er (nu )?aktiveret)\b/i,
  // replacement sent
  /\b(sent you a new|sending (you )?a (new|replacement)|sender dig et nyt|nyt (headset|sæt) (er )?sendt|replacement (is )?on its way)\b/i,
  // bank transfer completed
  /\b(transfer (is )?(done|completed)|overførsel (er )?gennemført|payment sent)\b/i,
  // order / invoice created
  /\b(created the order|oprettet ordren|invoice (is )?(created|attached|sent)|faktura (er )?(oprettet|sendt))\b/i,
];

const NEEDS_OUT_OF_BAND = [
  /\b(swift|iban|bank details|bankoplysninger)\b/i,
  // asks for the identity/shipping fields needed to perform an action the AI can't do
  /\b(provide (me )?(your )?(full name|full address|phone( number)?))\b/i,
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
  if (completed.length) return { anchor_class: "non_comparable_anchor", signals: completed };

  const needs = [];
  for (const re of NEEDS_OUT_OF_BAND) {
    if (re.test(h)) needs.push(`needs:${re.source.slice(0, 28)}`);
  }
  if (needs.length) return { anchor_class: "action_required", signals: needs };

  return { anchor_class: "comparable", signals: [] };
}
