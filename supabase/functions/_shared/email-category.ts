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
      /wrong\s+item/i,
      /received\s+wrong/i,
      /beskadiget/i,
      /defekt/i,
      /i stykker/i,
      /forkert vare/i,
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
    "- Exchange: Customer wants to swap for a different size/color, or received the wrong item. Goal is replacement, not fixing.\n" +
    "- Technical support: Product is not working and customer wants help fixing it. Examples: won't power on, factory reset loop, Bluetooth won't connect, not charging, firmware issue. Customer is NOT requesting a return or swap — they want the product to work.\n" +
    "- Product question: Pre-purchase or general product information question.\n" +
    "- Payment: Billing, invoice, receipt, failed or double charge.\n" +
    "- Cancellation: Customer wants to cancel their order.\n" +
    "- Refund: Customer wants their money back.\n" +
    "- Address change: Customer needs to update the shipping address on an existing order.\n" +
    "- General: Anything that does not fit the above categories.\n\n" +
    "IMPORTANT: If a product is malfunctioning, not powering on, or has a hardware/firmware problem, classify as 'Technical support' — not 'Exchange' or 'Return'.\n\n" +
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
