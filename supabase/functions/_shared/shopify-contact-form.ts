type ShopifyContactMatchInput = {
  fromEmail?: string | null;
  fromName?: string | null;
  replyToEmail?: string | null;
  subject?: string | null;
  bodyText?: string | null;
};

type ShopifyContactFieldMap = Record<string, string>;

export type ShopifyContactIdentity = {
  detected: boolean;
  confidence: "low" | "medium" | "high";
  customerName: string | null;
  customerEmail: string | null;
  fields: ShopifyContactFieldMap;
  reasons: string[];
};

function normalizeWhitespace(value: unknown): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

function normalizeEmail(value: unknown): string | null {
  const text = normalizeWhitespace(value);
  if (!text) return null;
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] ? match[0].trim().toLowerCase() : null;
}

function normalizeName(value: unknown): string | null {
  const text = normalizeWhitespace(value);
  return text || null;
}

function hasStructuredShopifyBody(bodyText: string): boolean {
  const fieldPattern =
    /^(name|email|phone|message|what is your request regarding\??|what do you need help with\??)\s*:/gim;
  const matches = bodyText.match(fieldPattern);
  return Array.isArray(matches) && matches.length >= 2;
}

function extractStructuredFields(bodyText: string): ShopifyContactFieldMap {
  const fields: ShopifyContactFieldMap = {};
  const normalized = bodyText.replace(/\r\n/g, "\n");
  const regex = /^([A-Za-z][A-Za-z0-9&/'(),?. \-]{0,80}):\s*(.+)$/gm;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(normalized))) {
    const label = normalizeWhitespace(match[1]).replace(/\s+/g, " ");
    const value = normalizeWhitespace(match[2]);
    if (!label || !value) continue;
    const nextIndex = regex.lastIndex;
    const nextMatch = normalized.slice(nextIndex).match(/^\n(?![A-Za-z][A-Za-z0-9&/'(),?. \-]{0,80}:)(.+)$/m);
    const finalValue = nextMatch?.[1]
      ? `${value}\n${normalizeWhitespace(nextMatch[1])}`
      : value;
    fields[label] = finalValue;
  }
  return fields;
}

function pickFieldValue(fields: ShopifyContactFieldMap, candidates: string[]): string | null {
  const entries = Object.entries(fields);
  for (const candidate of candidates) {
    const lowered = candidate.toLowerCase();
    const exact = entries.find(([key]) => key.toLowerCase() === lowered);
    if (exact?.[1]) return exact[1];
  }
  for (const candidate of candidates) {
    const lowered = candidate.toLowerCase();
    const partial = entries.find(([key]) => key.toLowerCase().includes(lowered));
    if (partial?.[1]) return partial[1];
  }
  return null;
}

export function parseShopifyContactIdentity(
  input: ShopifyContactMatchInput,
): ShopifyContactIdentity {
  const fromEmail = normalizeEmail(input.fromEmail);
  const replyToEmail = normalizeEmail(input.replyToEmail);
  const subject = normalizeWhitespace(input.subject);
  const bodyText = normalizeWhitespace(input.bodyText);
  const reasons: string[] = [];

  const isShopifySender =
    fromEmail === "mailer@shopify.com" || replyToEmail === "mailer@shopify.com";
  if (isShopifySender) reasons.push("shopify_sender");

  const isShopifySubject = /new customer message on/i.test(subject);
  if (isShopifySubject) reasons.push("shopify_subject");

  const hasStructuredBody = hasStructuredShopifyBody(bodyText);
  if (hasStructuredBody) reasons.push("structured_body");

  const fields = hasStructuredBody ? extractStructuredFields(bodyText) : {};
  const extractedEmail = normalizeEmail(
    pickFieldValue(fields, ["email", "e-mail", "customer email"]),
  );
  const extractedName = normalizeName(
    pickFieldValue(fields, ["name", "customer name", "full name"]),
  );

  if (extractedEmail) reasons.push("body_email");
  if (extractedName) reasons.push("body_name");

  const detected = Boolean(
    (isShopifySender && (isShopifySubject || hasStructuredBody)) ||
      (isShopifySubject && hasStructuredBody) ||
      (isShopifySender && extractedEmail),
  );

  const confidence =
    detected && extractedEmail && extractedName
      ? "high"
      : detected && extractedEmail
      ? "medium"
      : detected
      ? "low"
      : "low";

  return {
    detected,
    confidence,
    customerName: extractedName,
    customerEmail: extractedEmail,
    fields,
    reasons,
  };
}
