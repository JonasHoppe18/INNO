type EmailHeader = { name: string; value: string };

export type EmailClassification = {
  process: boolean;
  reason: string;
  category?: "support" | "spam" | "notification";
  explanation?: string;
};

type ClassifyEmailInput = {
  from: string;
  subject?: string | null;
  body?: string | null;
  headers?: EmailHeader[] | Record<string, string> | null;
};

const BLOCKED_SENDER_FRAGMENTS = [
  "noreply",
  "no-reply",
  "donotreply",
  "newsletter",
  "billing",
  "invoice",
  "linkedin",
  "facebook",
];

// Domains that are always system/carrier notifications — never customer support.
// Checked against the full sender domain (after @), not just the local part.
const BLOCKED_SENDER_DOMAINS = new Set([
  "postnord.com", "postnord.se", "postnord.dk", "postnord.no", "postnord.fi",
  "gls.com", "gls-group.com", "gls-group.eu", "gls-freight.com", "gls-freight.dk",
  "dhl.com", "dhlexpress.com", "dhl.de", "dhl.dk", "dhl.se", "dhl.no",
  "ups.com", "ups.net",
  "fedex.com", "fedex.dk", "fedex.se",
  "dao.as",
  "bring.com", "posten.no", "posten.se", "posten.dk",
  "dpd.com", "dpd.de", "dpd.dk",
  "budbee.com",
  "trustpilotmail.com",
  "klaviyo-email.com", "klaviyomail.com",
  "list-manage.com", "mailchimpapp.net",
]);

const SUBJECT_BLOCKLIST = ["automatic reply", "out of office", "undeliverable"];

const SYSTEM_PROMPT =
  "You are an email triage assistant for an e-commerce store. Classify the incoming email into one of these categories:\n" +
  "- 'support': A legitimate question from a human customer (e.g., 'Where is my order?', 'I want to return this', 'Product question').\n" +
  "- 'spam': Marketing, SEO offers, B2B sales, scams.\n" +
  "- 'notification': System emails, order confirmations, receipts, platform updates.\n\n" +
  'Output ONLY a JSON object: { "category": "support" | "spam" | "notification", "reason": "short explanation" }';

const OPENAI_MODEL = "gpt-4o-mini";

function extractSenderEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1];
  const emailMatch = from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch ? emailMatch[0] : from;
}

function normalizeHeaders(headers?: EmailHeader[] | Record<string, string> | null) {
  if (!headers) return {} as Record<string, string>;
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, header) => {
      if (!header?.name) return acc;
      acc[header.name.toLowerCase()] = header.value ?? "";
      return acc;
    }, {});
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value ?? ""]),
  );
}

export async function classifyEmail(input: ClassifyEmailInput): Promise<EmailClassification> {
  const fromRaw = input.from ?? "";
  const senderEmail = extractSenderEmail(fromRaw).toLowerCase();
  const subject = (input.subject ?? "").trim();
  const subjectLower = subject.toLowerCase();
  const headers = normalizeHeaders(input.headers);

  const senderDomain = senderEmail.split("@")[1] || "";
  if (BLOCKED_SENDER_DOMAINS.has(senderDomain)) {
    return { process: false, reason: "carrier_notification_domain", category: "notification" };
  }

  if (BLOCKED_SENDER_FRAGMENTS.some((fragment) => senderEmail.includes(fragment))) {
    return { process: false, reason: "blocked_sender" };
  }

  if (headers["list-unsubscribe"]) {
    return { process: false, reason: "list_unsubscribe" };
  }

  if (SUBJECT_BLOCKLIST.some((phrase) => subjectLower.includes(phrase))) {
    return { process: false, reason: "blocked_subject" };
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    // Mangler nøgle – lad mailen passere fremfor at blokere.
    return { process: true, reason: "classifier_unavailable_allow" };
  }

  const body = (input.body ?? "").slice(0, 500);
  const userPrompt = `Subject: ${subject || "(no subject)"}\nBody: ${body || "(empty body)"}`;

  try {
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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { process: true, reason: "classifier_error_allow" };
    }

    const content = json?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return { process: true, reason: "classifier_empty_allow" };
    }

    const parsed = JSON.parse(content);
    const category = parsed?.category;
    const explanation = typeof parsed?.reason === "string" ? parsed.reason : undefined;
    if (category === "support") {
      return { process: true, reason: "support", category, explanation };
    }
    if (category === "spam" || category === "notification") {
      return { process: false, reason: "not_support", category, explanation };
    }
    return { process: true, reason: "classifier_invalid_allow" };
  } catch {
    return { process: true, reason: "classifier_error_allow" };
  }
}
