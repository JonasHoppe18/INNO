export function formatTicketReference(ticketNumber: unknown): string | null {
  const numeric = Number(String(ticketNumber ?? "").replace(/\D/g, ""));
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  return `T-${numeric}`;
}

type ConfirmationHeader = { Name?: string; Value?: string };

function headerValue(headers: ConfirmationHeader[], name: string): string {
  return String(
    headers.find((header) => String(header?.Name || "").toLowerCase() === name.toLowerCase())?.Value || "",
  ).trim();
}

export function isAutomatedSender(input: {
  fromEmail: string | null;
  headers: ConfirmationHeader[];
}): boolean {
  const sender = String(input.fromEmail || "").toLowerCase();
  if (/no[-_.]?reply|donotreply|mailer-daemon|postmaster|noreply/.test(sender)) return true;

  const autoSubmitted = headerValue(input.headers, "Auto-Submitted").toLowerCase();
  const precedence = headerValue(input.headers, "Precedence").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (/bulk|list|junk/.test(precedence)) return true;
  if (headerValue(input.headers, "X-Auto-Response-Suppress")) return true;
  if (headerValue(input.headers, "X-Autoreply") || headerValue(input.headers, "X-Autorespond")) return true;
  if (headerValue(input.headers, "List-Id") || headerValue(input.headers, "List-Unsubscribe")) return true;
  return false;
}

export function shouldSendCustomerConfirmation(input: {
  createdNewThread: boolean;
  isEffectiveSupport: boolean;
  isBlockedSender: boolean;
  hasCustomerEmail: boolean;
  isLikelyAutoSender: boolean;
}): boolean {
  return Boolean(
    input.createdNewThread &&
      input.isEffectiveSupport &&
      !input.isBlockedSender &&
      input.hasCustomerEmail &&
      !input.isLikelyAutoSender
  );
}

export function addTicketReference(input: {
  subject: string;
  text: string;
  html: string;
  ticketNumber: unknown;
  includeTicketNumber: boolean;
}): { subject: string; text: string; html: string; ticketReference: string | null } {
  const ticketReference = formatTicketReference(input.ticketNumber);
  if (!input.includeTicketNumber || !ticketReference) {
    return {
      subject: input.subject,
      text: input.text,
      html: input.html,
      ticketReference: null,
    };
  }
  const referenceText = `Ticket reference: ${ticketReference}`;
  return {
    subject: `[${ticketReference}] ${input.subject}`,
    text: [input.text, referenceText].filter(Boolean).join("\n\n"),
    html: `${input.html}<p style="margin-top:24px;color:#64748b;font-size:13px">${referenceText}</p>`,
    ticketReference,
  };
}
