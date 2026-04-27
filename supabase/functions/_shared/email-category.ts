export const EMAIL_CATEGORIES = [
  "Tracking",
  "Return",
  "Exchange",
  "Product question",
  "Technical support",
  "Payment",
  "Cancellation",
  "Refund",
  "Address change",
  "Wrong item",
  "Missing item",
  "Complaint",
  "Fraud / dispute",
  "Warranty",
  "Gift card",
  "General",
] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

type CategoryInput = {
  subject?: string | null;
  body?: string | null;
  from?: string | null;
};

const OPENAI_MODEL = "gpt-4o-mini";

const CATEGORY_KEYWORDS: Array<{
  category: EmailCategory;
  patterns: Array<RegExp>;
}> = [
  // Most specific categories first to avoid collisions with generic keywords like "pakke"
  {
    category: "Wrong item",
    patterns: [
      /wrong\s+item/i,
      /received\s+wrong/i,
      /wrong\s+product/i,
      /sent\s+me\s+the\s+wrong/i,
      /incorrect\s+item/i,
      /incorrect\s+product/i,
      /not\s+what\s+i\s+ordered/i,
      /forkert\s+vare/i,
      /forkert\s+produkt/i,
      /forkert\s+størrelse/i,
      /fik\s+forkert/i,
      /modtaget\s+forkert/i,
    ],
  },
  {
    category: "Missing item",
    patterns: [
      /missing\s+item/i,
      /missing\s+product/i,
      /item\s+missing/i,
      /not\s+in\s+(the\s+)?package/i,
      /not\s+in\s+(the\s+)?box/i,
      /only\s+received\s+part/i,
      /incomplete\s+order/i,
      /manglende\s+vare/i,
      /vare\s+mangler/i,
      /mangler\s+i\s+pakken/i,
      /ikke\s+inkluderet/i,
      /pakken\s+manglede/i,
    ],
  },
  {
    category: "Warranty",
    patterns: [
      /\bwarranty\b/i,
      /\bgaranti\b/i,
      /under\s+warranty/i,
      /warranty\s+claim/i,
      /warranty\s+replacement/i,
      /covered\s+by\s+warranty/i,
      /inden\s+for\s+garanti/i,
      /garantikrav/i,
      /garantiperiode/i,
    ],
  },
  {
    category: "Gift card",
    patterns: [
      /gift\s+card/i,
      /gift\s+voucher/i,
      /\bgavekort\b/i,
      /gift\s+card\s+balance/i,
      /gift\s+card\s+code/i,
      /redeem\s+(gift|voucher)/i,
      /gift\s+card\s+not\s+working/i,
      /gavekort\s+virker\s+ikke/i,
      /gavekort\s+kode/i,
      /indløse\s+gavekort/i,
    ],
  },
  {
    category: "Fraud / dispute",
    patterns: [
      /\bfraud\b/i,
      /\bchargeback\b/i,
      /unauthorized\s+(charge|payment|purchase)/i,
      /didn'?t\s+(place|make)\s+this\s+order/i,
      /not\s+my\s+(order|purchase)/i,
      /stolen\s+(card|credit)/i,
      /\bdispute\b/i,
      /svindel/i,
      /uautoriseret\s+(betaling|køb|træk)/i,
      /har\s+ikke\s+bestilt/i,
      /ikke\s+min\s+ordre/i,
    ],
  },
  {
    category: "Complaint",
    patterns: [
      /\bcomplaint\b/i,
      /very\s+disappointed/i,
      /extremely\s+frustrated/i,
      /unacceptable/i,
      /terrible\s+(service|experience)/i,
      /worst\s+(service|experience)/i,
      /\bklage\b/i,
      /meget\s+skuffet/i,
      /dybt\s+utilfreds/i,
      /uacceptabelt/i,
    ],
  },
  // Generic categories after specific ones
  {
    category: "Tracking",
    patterns: [
      /order\s*tracking/i,
      /tracking\s*(number|no\.)?/i,
      /shipment/i,
      /shipping\s*status/i,
      /where\s+is\s+my\s+order/i,
      /where is my package/i,
      /hvornår\s+kommer\s+min\s+pakke/i,
      /hvor\s+er\s+min\s+ordre/i,
      /hvor\s+er\s+min\s+pakke/i,
      /\btrack\b/i,
      /\bpakke\b/i,
      /\blevering\b/i,
      /\bpostnord\b/i,
      /\bgls\b/i,
      /\bups\b/i,
      /\bdhl\b/i,
      /\busps\b/i,
      /not\s+delivered/i,
      /delivery\s+issue/i,
      /delivery\s+problem/i,
      /lost\s+package/i,
      /forsinket\s+levering/i,
      /leveringsproblem/i,
      /ikke\s+leveret/i,
      /ikke\s+modtaget/i,
      /modtaget\s+min\s+(ordre|pakke)/i,
      /min\s+ordre\s+er\s+ikke\s+kommet/i,
      /ikke\s+ankommet/i,
      /stadig\s+ikke\s+(kommet|modtaget|ankommet)/i,
      /hvornår\s+kommer/i,
      /hvornår\s+leveres/i,
      /forventet\s+levering/i,
    ],
  },
  {
    category: "Address change",
    patterns: [
      /change\s+address/i,
      /address\s+change/i,
      /address\s+update/i,
      /wrong\s+address/i,
      /change\s+my\s+shipping\s+address/i,
      /forkert\s+adresse/i,
      /ret\s+adresse/i,
      /ændr\s+adresse/i,
      /\badresse\b/i,
      /\bhusnummer\b/i,
      /\bstreet\b/i,
      /\broad\b/i,
      /\bvej\b/i,
    ],
  },
  {
    category: "Cancellation",
    patterns: [
      /cancel\s+order/i,
      /cancel\b/i,
      /annull/i,
      /afbestil/i,
      /stop\s+order/i,
      /stop\s+my\s+order/i,
    ],
  },
  {
    category: "Refund",
    patterns: [
      /\brefund\b/i,
      /money\s+back/i,
      /charge\s*back/i,
      /refunder/i,
      /refundere/i,
      /kredit/i,
      /få\s+pengene\s+tilbage/i,
    ],
  },
  {
    category: "Exchange",
    patterns: [
      /\bexchange\b/i,
      /\bswap\b/i,
      /\bbytte\b/i,
      /byt\s+til/i,
      /change\s+size/i,
      /change\s+color/i,
      /anden\s+størrelse/i,
      /damaged/i,
      /defective/i,
      /broken/i,
      /beskadiget/i,
      /defekt/i,
      /i stykker/i,
    ],
  },
  {
    category: "Return",
    patterns: [
      /\breturn\b/i,
      /\bretur\b/i,
      /\breturning\b/i,
      /send\s+back/i,
      /tilbage\s+sende/i,
    ],
  },
  {
    category: "Payment",
    patterns: [
      /\bpayment\b/i,
      /\bbilling\b/i,
      /\binvoice\b/i,
      /\breceipt\b/i,
      /card\s+declined/i,
      /payment\s+failed/i,
      /failed\s+payment/i,
      /charged\s+twice/i,
      /double\s+charged/i,
      /problem\s+with\s+payment/i,
      /\bbetaling\b/i,
      /\bfaktura\b/i,
      /kort\s+afvist/i,
      /betalingsproblem/i,
    ],
  },
  {
    category: "Technical support",
    patterns: [
      /won'?t\s+(turn|power)\s+on/i,
      /not\s+(turning|powering)\s+on/i,
      /won'?t\s+connect/i,
      /won'?t\s+pair/i,
      /can'?t\s+(connect|pair|charge)/i,
      /not\s+charging/i,
      /\bfirmware\b/i,
      /factory\s+reset/i,
      /\breset\b.*headset/i,
      /headset.*\breset\b/i,
      /bluetooth.*problem/i,
      /bluetooth.*virker\s+ikke/i,
      /\bparre\b/i,
      /\bparring\b/i,
      /virker\s+ikke/i,
      /fungerer\s+ikke/i,
      /lader\s+ikke/i,
      /lyd.*problem/i,
      /problem.*lyd/i,
      /crackling/i,
      /\bknitre\b/i,
      /\bknirke\b/i,
      /mikrofon.*virker\s+ikke/i,
      /mic\s+not\s+working/i,
      /dongle.*problem/i,
      /problem.*dongle/i,
      /\bfejl\b.*headset/i,
      /headset.*\bfejl\b/i,
    ],
  },
  {
    category: "Product question",
    patterns: [
      /product\s+question/i,
      /question\s+about\s+(the\s+)?product/i,
      /is\s+this\s+in\s+stock/i,
      /stock\s+status/i,
      /size\s+guide/i,
      /materiale/i,
      /produktspørgsmål/i,
      /spørgsmål\s+om\s+produkt/i,
      /hvilken\s+størrelse/i,
      /hvad\s+er\s+forskellen/i,
      /compatible\s+with/i,
      /kompatibel\s+med/i,
      /virker\s+det\s+med/i,
      /understøtter/i,
      /supports?\s+(usb|xbox|ps\d|playstation|mac|ios|android)/i,
      /pre.?order/i,
      /forudbestil/i,
      /hvornår\s+er\s+den\s+i\s+lager/i,
    ],
  },
];

export const LEGACY_EMAIL_CATEGORY_MAP: Record<string, EmailCategory> = {
  "Order Tracking": "Tracking",
  "Address Change": "Address change",
  Cancel: "Cancellation",
  General: "General",
  Return: "Return",
  Cancellation: "Cancellation",
  Refund: "Refund",
  Payment: "Payment",
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function keywordCategory(subject: string, body: string): EmailCategory | null {
  const combined = `${subject}\n${body}`.toLowerCase();
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.patterns.some((pattern) => pattern.test(combined))) {
      return entry.category;
    }
  }
  return null;
}

function normalizeCategory(value: unknown): EmailCategory | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (EMAIL_CATEGORIES.includes(trimmed as EmailCategory)) return trimmed as EmailCategory;
  return LEGACY_EMAIL_CATEGORY_MAP[trimmed] ?? null;
}

async function classifyWithOpenAI(
  subject: string,
  body: string,
  from: string,
): Promise<EmailCategory | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  const systemPrompt =
    "You are an email classifier for a customer support inbox.\n" +
    "Choose exactly one category. Use descriptions to distinguish ambiguous cases.\n\n" +
    "Categories:\n" +
    "- Tracking: Customer asks where their shipment is, wants tracking number, or reports a delivery problem.\n" +
    "- Return: Customer explicitly wants to send a product back.\n" +
    "- Exchange: Customer wants to swap for a different size/color. Goal is a replacement variant, not correcting a fulfillment error.\n" +
    "- Wrong item: Customer received a completely different product than what they ordered (fulfillment error). Different from Exchange — customer did not choose the wrong item, the shop shipped the wrong one.\n" +
    "- Missing item: Customer's parcel arrived but one or more items were missing from the package. Different from Tracking — the parcel was delivered, something was just not inside.\n" +
    "- Technical support: Product is not working and customer wants help fixing it. Examples: won't power on, factory reset loop, Bluetooth won't connect, not charging, firmware issue. Customer is NOT requesting a return or swap — they want the product to work.\n" +
    "- Product question: Pre-purchase or general product information question.\n" +
    "- Payment: Billing, invoice, receipt, failed or double charge.\n" +
    "- Cancellation: Customer wants to cancel their order.\n" +
    "- Refund: Customer wants their money back (and has not yet initiated a return).\n" +
    "- Address change: Customer needs to update the shipping address on an existing order.\n" +
    "- Complaint: General dissatisfaction or frustration with no specific actionable request (not a return, refund, or exchange request — just expressing disappointment).\n" +
    "- Fraud / dispute: Customer suspects unauthorized purchase, has filed or is threatening a chargeback, or reports that someone else made the purchase.\n" +
    "- Warranty: Customer is claiming a product defect under warranty and expects coverage (replacement or repair under warranty terms). Different from Technical support — customer explicitly invokes warranty or asks about coverage.\n" +
    "- Gift card: Gift card balance, activation, redemption, or code issue.\n" +
    "- General: Anything that does not fit the above categories.\n\n" +
    "IMPORTANT: If a product is malfunctioning, not powering on, or has a hardware/firmware problem and the customer wants it fixed (not returned), classify as 'Technical support'.\n" +
    "IMPORTANT: If the customer received a different product than ordered, classify as 'Wrong item', not 'Exchange'.\n" +
    "IMPORTANT: If the parcel arrived but something was missing inside, classify as 'Missing item', not 'Tracking'.\n\n" +
    'Return ONLY JSON: { "category": "<one of the categories above, verbatim>" }.';

  const userPrompt = `From: ${from || "(unknown)"}\nSubject: ${
    subject || "(no subject)"
  }\nBody: ${(body || "").slice(0, 1200)}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) return null;
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content);
    return normalizeCategory(parsed?.category);
  } catch {
    return null;
  }
}

export function normalizeEmailCategory(value: unknown): EmailCategory {
  return normalizeCategory(value) ?? "General";
}

export async function categorizeEmail(input: CategoryInput): Promise<EmailCategory> {
  const subject = normalizeText(input.subject);
  const body = normalizeText(input.body);
  const from = input.from ?? "";

  const keywordMatch = keywordCategory(subject, body);
  if (keywordMatch) return keywordMatch;

  const aiCategory = await classifyWithOpenAI(subject, body, from);
  return aiCategory ?? "General";
}
