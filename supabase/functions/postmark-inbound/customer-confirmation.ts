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

// Removes the reference from a subject, including an empty "[ ]" wrapper.
export function applySubjectReference(subject: string, ticketReference: string | null): string {
  const source = String(subject || "");
  if (!source.includes(TICKET_REFERENCE_TOKEN)) return source;
  if (ticketReference) return source.replaceAll(TICKET_REFERENCE_TOKEN, ticketReference);
  return source
    .replace(/[[(]\s*\{\{ticket_reference\}\}\s*[\])]/g, "")
    .replaceAll(TICKET_REFERENCE_TOKEN, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Builds subject, text and merged HTML from token-filled templates. A design that
// uses {{ticket_reference}} decides where the reference appears; older saved
// designs without it keep the include switch (subject prefix + footer line).
export function composeConfirmation(input: {
  subjectTemplate: string;
  bodyText: string;
  bodyHtml: string;
  templateHtml: string;
  ticketNumber: unknown;
  includeTicketNumber: boolean;
}): { subject: string; text: string; html: string; ticketReference: string | null } {
  const reference = formatTicketReference(input.ticketNumber);
  const usesVariable = [input.subjectTemplate, input.bodyText, input.bodyHtml, input.templateHtml].some(
    (value) => String(value || "").includes(TICKET_REFERENCE_TOKEN),
  );
  const placed = usesVariable ? reference : null;
  const subject = applySubjectReference(input.subjectTemplate, placed);
  const text = applyTicketReference(input.bodyText, placed);
  const bodyHtml =
    applyTicketReference(input.bodyHtml || "", placed) ||
    `<p style="white-space:pre-wrap">${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
  const rendered = usesVariable
    ? { subject, text, html: bodyHtml, ticketReference: placed }
    : addTicketReference({
        subject,
        text,
        html: bodyHtml,
        ticketNumber: input.ticketNumber,
        includeTicketNumber: input.includeTicketNumber,
      });
  return {
    subject: rendered.subject,
    text: rendered.text,
    html: mergeConfirmationLayout({
      templateHtml: input.templateHtml,
      contentHtml: rendered.html,
      ticketReference: placed,
    }),
    ticketReference: rendered.ticketReference,
  };
}
