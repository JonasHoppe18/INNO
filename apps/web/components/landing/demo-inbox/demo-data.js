// Fiktivt demo-scenarie (spec §3): Sofia Rossi, beskadiget vase, refund-approval.
// Feltnavne er valgt ud fra den faktiske prop-kontrakt i MessageBubble/ActionCard
// (se getSenderLabel/getEffectiveSenderEmail i components/inbox/inbox-utils.js →
// lib/inbox/sender.js, og getApproveButtonLabel/getRefundAmount i ActionCard.jsx),
// ikke ud fra antagelser. Ingen rigtige kundedata — alt er opdigtet.

export const DEMO_INBOUND_MESSAGE = {
  id: "demo-inbound-1",
  from_me: false,
  // getSenderLabel() reads from_name / from_email (not sender_name/sender_email).
  from_name: "Sofia Rossi",
  from_email: "sofia.rossi@example.com",
  body_text:
    "Hi,\nMy order arrived today, but the ceramic vase was cracked on one side. Could I get a refund?\n\nOrder #40318.",
  received_at: "2026-07-15T09:12:00Z",
};

export const DEMO_DRAFT_MESSAGE = {
  id: "demo-draft-1",
  from_me: true,
  is_draft: true,
  // from_name "Sona" makes getSenderLabel() resolve to "Sona", which then
  // trips the isAiMessage check in MessageBubble (senderLower === "sona").
  from_name: "Sona",
  body_text:
    "Hi Sofia,\n\nI'm so sorry the vase arrived damaged — that's not the experience we want you to have. I've issued a full refund of €89.00; you'll see it within 3–5 business days. No need to send the vase back.\n\nBest,\nYour Store",
  created_at: "2026-07-15T09:13:00Z",
};

export const DEMO_ACTION = {
  status: "proposed",
  // actionType must match one of ActionCard's known switch cases to get the
  // real "Approve refund (amount)" label and impact-summary copy — the plan
  // brief's "process_refund" isn't a recognized actionType in ActionCard.jsx,
  // "refund_order" is.
  actionType: "refund_order",
  actionName: "Refund",
  detail: "Ceramic vase — damage reported by customer, refund covers full order value.",
  // amount must be numeric (parseAmount does Number(String(value).replace(",", "."))
  // which fails on a pre-formatted "€89.00" string) — ActionCard formats the
  // currency itself via Intl.NumberFormat, so we just pass the raw number + ISO code.
  payload: { amount: 89, currency: "EUR", order_number: "40318" },
  orderSummary: null,
};

export const DEMO_TICKET_LIST = [
  { id: "t4", name: "Sofia Rossi", subject: "Item arrived damaged", ref: "T-40318", time: "12 min", badge: "New", selected: true },
  { id: "t3", name: "Lucas Meyer", subject: "Where is my order?", ref: "T-40317 · Draft ready", time: "1 h" },
  { id: "t2", name: "Emma Larsen", subject: "Wrong size — can I exchange?", ref: "T-40316 · Draft ready", time: "3 h" },
  { id: "t1", name: "Noah Berg", subject: "Change delivery address", ref: "T-40315 · Sent", time: "5 h" },
];
