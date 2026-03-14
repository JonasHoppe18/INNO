type EmailHeader = { name: string; value: string };

const SUBJECT_PATTERNS = [
  /unsubscribe/i,
  /newsletter/i,
  /\bpromo\b/i,
  /\bpromotion\b/i,
  /\bmarketing\b/i,
  /\bdiscount\b/i,
  /\bsale\b/i,
  /\bemail preferences\b/i,
];

const SENDER_PATTERNS = [
  /mailchimp/i,
  /sendgrid/i,
  /klaviyo/i,
  /campaign-?monitor/i,
  /constantcontact/i,
  /mailerlite/i,
  /mailgun/i,
  /sparkpost/i,
  /postmarkapp/i,
];

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

export function shouldSkipInboxMessage({
  from,
  subject,
  snippet,
  body,
  headers,
}: {
  from: string;
  subject?: string | null;
  snippet?: string | null;
  body?: string | null;
  headers?: EmailHeader[] | Record<string, string> | null;
}): boolean {
  const normalizedHeaders = normalizeHeaders(headers);
  if (normalizedHeaders["list-unsubscribe"]) return true;

  const combined = `${subject ?? ""}\n${snippet ?? ""}\n${body ?? ""}`.toLowerCase();
  if (SUBJECT_PATTERNS.some((pattern) => pattern.test(combined))) return true;

  const fromLower = (from ?? "").toLowerCase();
  if (SENDER_PATTERNS.some((pattern) => pattern.test(fromLower))) return true;

  return false;
}
