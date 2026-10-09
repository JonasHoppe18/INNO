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
// Compiled designs built from ordinary text blocks start with this marker. They
// carry the variables across the whole email instead of in one {{content}} slot.
export const FULL_DESIGN_MARKER = "<!--sona:full-design-->";
const TOKEN_PATTERN = /{{\s*([a-z0-9_]+)\s*}}/gi;

const escapeAttributeSafe = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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
// A full design: subject and text arrive with tokens already filled; the HTML
// gets every token filled here, escaped, so customer input can't add markup.
function composeFullDesign(input: {
  subjectTemplate: string;
  bodyText: string;
  templateHtml: string;
  ticketNumber: unknown;
  tokens: Record<string, string>;
}): { subject: string; text: string; html: string; ticketReference: string | null } {
  const reference = formatTicketReference(input.ticketNumber);
  const usesReference = [input.subjectTemplate, input.bodyText, input.templateHtml].some((value) =>
    String(value || "").includes(TICKET_REFERENCE_TOKEN)
  );
  const values: Record<string, string> = { ...input.tokens, ticket_reference: reference || "" };
  const fill = (template: string, escape: boolean) =>
    String(template || "").replace(TOKEN_PATTERN, (_match, key: string) => {
      const value = String(values[key.toLowerCase()] ?? "");
      return escape ? escapeAttributeSafe(value) : value;
    });
  return {
    subject: fill(applySubjectReference(input.subjectTemplate, reference), false).replace(/\s{2,}/g, " ").trim(),
    text: fill(applyTicketReference(input.bodyText, reference), false).replace(/\n{3,}/g, "\n\n").trim(),
    html: fill(input.templateHtml.slice(FULL_DESIGN_MARKER.length), true),
    ticketReference: usesReference ? reference : null,
  };
}

export function composeConfirmation(input: {
  subjectTemplate: string;
  bodyText: string;
  bodyHtml: string;
  templateHtml: string;
  ticketNumber: unknown;
  includeTicketNumber: boolean;
  tokens?: Record<string, string>;
}): { subject: string; text: string; html: string; ticketReference: string | null } {
  if (String(input.templateHtml || "").startsWith(FULL_DESIGN_MARKER)) {
    return composeFullDesign({ ...input, tokens: input.tokens || {} });
  }
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

// First name for the greeting. A missing name or an email address used as the
// name gives "", so the caller falls back to a neutral greeting.
export function customerFirstName(name: string | null | undefined): string {
  const first = String(name ?? "").trim().split(/\s+/)[0] || "";
  return first.includes("@") ? "" : first;
}
