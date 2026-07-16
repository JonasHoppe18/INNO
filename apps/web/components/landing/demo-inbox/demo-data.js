// Fiktive demo-scenarier til den interaktive produkt-demo. Feltnavne følger den
// faktiske prop-kontrakt i MessageBubble/ActionCard (se getSenderLabel i
// lib/inbox/sender.js, og getApproveButtonLabel/getRefundAmount/
// getActionValidationError i ActionCard.jsx), ikke antagelser. Ingen rigtige
// kundedata — alt er opdigtet. Copy er bevidst engelsk på begge locales, fordi
// det forestiller produkt-fladen (et skærmbillede), ikke marketing-tekst.

// Delt indbakke-liste. Hvilken række der er markeret afgøres pr. scenarie via
// ticketId — ikke et statisk `selected`-flag.
export const TICKETS = [
  { id: "t4", name: "Sofia Rossi", subject: "Item arrived damaged", ref: "T-40318", time: "12 min", badge: "New" },
  { id: "t3", name: "Lucas Meyer", subject: "Where is my order?", ref: "T-40317", time: "1 h", badge: "New" },
  { id: "t2", name: "Emma Larsen", subject: "Wrong size — can I exchange?", ref: "T-40316", time: "3 h" },
  { id: "t1", name: "Noah Berg", subject: "Change delivery address", ref: "T-40315", time: "5 h" },
];

export const SCENARIOS = [
  {
    id: "refund",
    tabLabel: "Refund a damaged item",
    ticketId: "t4",
    ref: "T-40318",
    tag: "Damaged item",
    activity: "Sona verified order #40318 · damage documented · refund policy §4 applies",
    inbound: {
      id: "demo-refund-in",
      from_me: false,
      from_name: "Sofia Rossi",
      from_email: "sofia.rossi@example.com",
      body_text:
        "Hi,\nMy order arrived today, but the ceramic vase was cracked on one side. Could I get a refund?\n\nOrder #40318.",
      received_at: "2026-07-15T09:12:00Z",
    },
    action: {
      status: "proposed",
      actionType: "refund_order",
      actionName: "Refund",
      detail: "Ceramic vase — damage reported by customer, refund covers full order value.",
      payload: { amount: 89, currency: "EUR", order_number: "40318" },
      orderSummary: null,
    },
    draft: {
      id: "demo-refund-draft",
      from_me: true,
      is_draft: true,
      from_name: "Sona",
      body_text:
        "Hi Sofia,\n\nI'm so sorry the vase arrived damaged — that's not the experience we want you to have. I've issued a full refund of €89.00; you'll see it within 3–5 business days. No need to send the vase back.\n\nBest,\nYour Store",
      created_at: "2026-07-15T09:13:00Z",
    },
  },
  {
    id: "tracking",
    tabLabel: "Answer “Where’s my order?”",
    ticketId: "t3",
    ref: "T-40317",
    tag: "Shipping",
    activity: "Sona found order #40317 · shipped yesterday · tracking pulled live",
    inbound: {
      id: "demo-tracking-in",
      from_me: false,
      from_name: "Lucas Meyer",
      from_email: "lucas.meyer@example.com",
      body_text:
        "Hey, I ordered a week ago and still haven't heard anything. When will my package arrive?\n\nOrder #40317.",
      received_at: "2026-07-15T08:40:00Z",
    },
    action: null,
    draft: {
      id: "demo-tracking-draft",
      from_me: true,
      is_draft: true,
      from_name: "Sona",
      body_text:
        "Hi Lucas,\n\nGood news — your order shipped yesterday with GLS and is on track to arrive Thursday. You can follow it here: track.gls.com/40317.\n\nThanks for your patience!\nYour Store",
      created_at: "2026-07-15T08:41:00Z",
    },
  },
  {
    id: "exchange",
    tabLabel: "Set up a size exchange",
    ticketId: "t2",
    ref: "T-40316",
    tag: "Exchange",
    activity: "Sona checked stock · size 42 available · exchange policy applies",
    inbound: {
      id: "demo-exchange-in",
      from_me: false,
      from_name: "Emma Larsen",
      from_email: "emma.larsen@example.com",
      body_text:
        "Hi, the running shoes I received are a size too small. Could I swap them for a 42?\n\nOrder #40316.",
      received_at: "2026-07-15T06:20:00Z",
    },
    action: {
      status: "proposed",
      actionType: "create_exchange_request",
      actionName: "Exchange",
      detail: "Runner Pro 41 → Runner Pro 42 · prepaid return label included.",
      payload: {
        order_number: "40316",
        exchange_variant_id: "gid://shopify/ProductVariant/42",
        exchange_product_title: "Runner Pro",
        exchange_variant_title: "Size 42",
      },
      orderSummary: null,
    },
    draft: {
      id: "demo-exchange-draft",
      from_me: true,
      is_draft: true,
      from_name: "Sona",
      body_text:
        "Hi Emma,\n\nNo problem — size 42 is in stock, so I've set up an exchange. You'll get a prepaid return label by email, and the new pair ships as soon as the return is scanned.\n\nBest,\nYour Store",
      created_at: "2026-07-15T06:21:00Z",
    },
  },
  {
    id: "address",
    tabLabel: "Fix a delivery address",
    ticketId: "t1",
    ref: "T-40315",
    tag: "Address change",
    activity: "Sona confirmed order #40315 hasn't shipped · address is still editable",
    inbound: {
      id: "demo-address-in",
      from_me: false,
      from_name: "Noah Berg",
      from_email: "noah.berg@example.com",
      body_text:
        "I just realised I used my old address. Can you send it to Nørrebrogade 12, 2200 København N instead?\n\nOrder #40315.",
      received_at: "2026-07-15T04:10:00Z",
    },
    action: {
      status: "proposed",
      actionType: "update_shipping_address",
      actionName: "Address update",
      detail: "Ship to Nørrebrogade 12, 2200 København N — order not yet fulfilled.",
      payload: { order_number: "40315" },
      orderSummary: null,
    },
    draft: {
      id: "demo-address-draft",
      from_me: true,
      is_draft: true,
      from_name: "Sona",
      body_text:
        "Hi Noah,\n\nDone — I've updated the delivery address to Nørrebrogade 12, 2200 København N. Your order hadn't shipped yet, so it'll go straight to the new address.\n\nBest,\nYour Store",
      created_at: "2026-07-15T04:11:00Z",
    },
  },
];
