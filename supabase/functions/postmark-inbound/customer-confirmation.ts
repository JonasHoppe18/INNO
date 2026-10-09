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

export const TICKET_REFERENCE_TOKEN = "{{ticket_reference}}";

// Fills the reference where the message mentions it. With the reference off, the
// lines that mention it are dropped so no half sentence is left behind.
export function applyTicketReference(text: string, ticketReference: string | null): string {
  const source = String(text || "");
  if (!source.includes(TICKET_REFERENCE_TOKEN)) return source;
  if (ticketReference) return source.replaceAll(TICKET_REFERENCE_TOKEN, ticketReference);
  return source
    .split("\n")
    .filter((line) => !line.includes(TICKET_REFERENCE_TOKEN))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Puts the message into the published layout. A design that places
// {{ticket_reference}} itself gets it filled there (or emptied when off).
export function mergeConfirmationLayout(input: {
  templateHtml: string;
  contentHtml: string;
  ticketReference: string | null;
}): string {
  const layout = String(input.templateHtml || "").replaceAll(
    TICKET_REFERENCE_TOKEN,
    input.ticketReference ? input.ticketReference.replace(/[<>&]/g, "") : "",
  );
  return layout.includes("{{content}}")
    ? layout.replace("{{content}}", input.contentHtml)
    : `${layout}\n${input.contentHtml}`;
}

export function addTicketReference(input: {
  subject: string;
  text: string;
  html: string;
  ticketNumber: unknown;
  includeTicketNumber: boolean;
  placedInLayout?: boolean;
  placedInMessage?: boolean;
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
    text: input.placedInMessage ? input.text : [input.text, referenceText].filter(Boolean).join("\n\n"),
    html: input.placedInLayout || input.placedInMessage
      ? input.html
      : `${input.html}<p style="margin-top:24px;color:#64748b;font-size:13px">${referenceText}</p>`,
    ticketReference,
  };
}
