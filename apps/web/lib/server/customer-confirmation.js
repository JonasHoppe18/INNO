import { formatTicketReference } from "../tickets/reference.js";

export const CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT = "[{{ticket_reference}}] We've received your message";
export const CUSTOMER_CONFIRMATION_DEFAULT_TEXT =
  "Hi {{customer_first_name}},\n\nThanks for contacting us. We've received your message and our support team will get back to you as soon as possible.\n\nYour ticket number: {{ticket_reference}}\n\nYou can reply directly to this email if you would like to add more information.\n\nBest,\n{{team_name}}";
export const CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT =
  '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">{{content}}</div>';

export const TICKET_REFERENCE_TOKEN = "{{ticket_reference}}";

// Fills the reference where the message mentions it. With the reference off, the
// lines that mention it are dropped so no half sentence is left behind.
export function applyTicketReference(text, ticketReference) {
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

export function fillConfirmationTokens(template, values = {}) {
  let result = String(template || "");
  Object.entries(values).forEach(([key, value]) => {
    result = result.replaceAll(`{{${key}}}`, String(value ?? ""));
  });
  return result;
}

export function escapeConfirmationHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Removes the reference from a subject, including an empty "[ ]" wrapper.
export function applySubjectReference(subject, ticketReference) {
  const source = String(subject || "");
  if (!source.includes(TICKET_REFERENCE_TOKEN)) return source;
  if (ticketReference) return source.replaceAll(TICKET_REFERENCE_TOKEN, ticketReference);
  return source
    .replace(/[[(]\s*\{\{ticket_reference\}\}\s*[\])]/g, "")
    .replaceAll(TICKET_REFERENCE_TOKEN, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function renderCustomerConfirmation({
  subjectTemplate = CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT,
  bodyTextTemplate = CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
  bodyHtmlTemplate = "",
  templateHtml = CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT,
  includeTicketNumber = true,
  ticketNumber = 50001,
  tokens = {},
} = {}) {
  const reference = formatTicketReference(ticketNumber, "") || null;
  const layout = String(templateHtml || "{{content}}");
  // A design that uses the variable decides where the reference appears. Older
  // saved designs without it keep the include switch: subject prefix + footer line.
  const usesVariable = [subjectTemplate, bodyTextTemplate, bodyHtmlTemplate, layout].some((value) =>
    String(value || "").includes(TICKET_REFERENCE_TOKEN)
  );
  const placed = usesVariable ? reference : null;
  const legacy = !usesVariable && includeTicketNumber ? reference : null;

  const filledSubject = applySubjectReference(fillConfirmationTokens(subjectTemplate, tokens), placed);
  const renderedText = applyTicketReference(fillConfirmationTokens(bodyTextTemplate, tokens), placed);
  const renderedBodyHtml =
    applyTicketReference(fillConfirmationTokens(bodyHtmlTemplate, tokens), placed) ||
    `<p style="white-space:pre-wrap">${escapeConfirmationHtml(renderedText)}</p>`;
  const referenceText = legacy ? `Ticket reference: ${legacy}` : "";
  const referenceHtml = legacy
    ? `<p style="margin-top:24px;color:#64748b;font-size:13px">Ticket reference: ${legacy}</p>`
    : "";
  const contentHtml = `${renderedBodyHtml}${referenceHtml}`;
  const filledLayout = layout.replaceAll(TICKET_REFERENCE_TOKEN, placed ? escapeConfirmationHtml(placed) : "");
  const mergedHtml = filledLayout.includes("{{content}}")
    ? filledLayout.replace("{{content}}", contentHtml)
    : `${filledLayout}\n${contentHtml}`;

  return {
    subject: legacy ? `[${legacy}] ${filledSubject}` : filledSubject,
    text: [renderedText, referenceText].filter(Boolean).join("\n\n"),
    html: mergedHtml,
    ticketReference: placed || legacy,
  };
}
