export type EmailCategory =
  | "Order Tracking"
  | "Address Change"
  | "Refund"
  | "Return"
  | "Cancel"
  | "General";

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
    category: "Order Tracking",
    patterns: [
      /order\s*tracking/i,
      /tracking\s*(number|no\.)?/i,
      /shipment/i,
      /shipping\s*status/i,
      /where\s+is\s+my\s+order/i,
      /\btrack\b/i,
      /\bpakke\b/i,
      /\blevering\b/i,
      /\bpostnord\b/i,
      /\bgls\b/i,
      /\bups\b/i,
      /\bdhl\b/i,
      /\busps\b/i,
    ],
  },
  {
    category: "Address Change",
    patterns: [
      /change\s+address/i,
      /address\s+change/i,
      /address\s+update/i,
      /wrong\s+address/i,
      /forkert\s+adresse/i,
      /\badresse\b/i,
      /\bhusnummer\b/i,
      /\bstreet\b/i,
      /\broad\b/i,
      /\bvej\b/i,
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
    ],
  },
  {
    category: "Return",
    patterns: [
      /\breturn\b/i,
      /\bretur\b/i,
      /\breturning\b/i,
      /\bbytte\b/i,
      /\bexchange\b/i,
    ],
  },
  {
    category: "Cancel",
    patterns: [
      /\bcancel\b/i,
      /\bcancel\s+order\b/i,
      /\bannull/i,
      /\bafbestil/i,
      /\bstop\s+order\b/i,
    ],
  },
];

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

async function classifyWithOpenAI(
  subject: string,
  body: string,
  from: string,
): Promise<EmailCategory | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  const systemPrompt =
    "You are an email classifier for a support inbox. Choose exactly one category.\n" +
    "Categories:\n" +
    "- Order Tracking\n" +
    "- Address Change\n" +
    "- Refund\n" +
    "- Return\n" +
    "- Cancel\n" +
    "- General\n\n" +
    'Return ONLY JSON: { "category": "<one of the categories>" }.';

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
    const category = parsed?.category;
    if (typeof category === "string") {
      const trimmed = category.trim();
      const allowed = [
        "Order Tracking",
        "Address Change",
        "Refund",
        "Return",
        "Cancel",
        "General",
      ];
      if (allowed.includes(trimmed)) return trimmed as EmailCategory;
    }
  } catch {
    return null;
  }
  return null;
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
