import { formatTicketReference } from "../tickets/reference.js";

export const CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT = "We've received your message";
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

export function renderCustomerConfirmation({
  subjectTemplate = CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT,
  bodyTextTemplate = CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
  bodyHtmlTemplate = "",
  templateHtml = CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT,
  includeTicketNumber = true,
  ticketNumber = 50001,
  tokens = {},
} = {}) {
  const ticketReference = formatTicketReference(ticketNumber, "");
  const shouldIncludeReference = Boolean(includeTicketNumber && ticketReference);
  const placedReference = shouldIncludeReference ? ticketReference : null;
  const renderedSubject = fillConfirmationTokens(subjectTemplate, tokens);
  const renderedText = applyTicketReference(fillConfirmationTokens(bodyTextTemplate, tokens), placedReference);
  const renderedBodyHtml =
    applyTicketReference(fillConfirmationTokens(bodyHtmlTemplate, tokens), placedReference) ||
    `<p style="white-space:pre-wrap">${escapeConfirmationHtml(renderedText)}</p>`;
  const referenceText = shouldIncludeReference && !String(bodyTextTemplate || "").includes(TICKET_REFERENCE_TOKEN)
    ? `Ticket reference: ${ticketReference}`
    : "";
  // A design can place the reference itself; otherwise it follows the message.
  const layout = String(templateHtml || "{{content}}");
  const placesReference =
    layout.includes(TICKET_REFERENCE_TOKEN) ||
    String(bodyTextTemplate || "").includes(TICKET_REFERENCE_TOKEN) ||
    String(bodyHtmlTemplate || "").includes(TICKET_REFERENCE_TOKEN);
  const referenceHtml = shouldIncludeReference && !placesReference
    ? `<p style="margin-top:24px;color:#64748b;font-size:13px">Ticket reference: ${ticketReference}</p>`
    : "";
  const contentHtml = `${renderedBodyHtml}${referenceHtml}`;
  const filledLayout = layout.replaceAll(
    TICKET_REFERENCE_TOKEN,
    shouldIncludeReference ? escapeConfirmationHtml(ticketReference) : ""
  );
  const mergedHtml = filledLayout.includes("{{content}}")
    ? filledLayout.replace("{{content}}", contentHtml)
    : `${filledLayout}\n${contentHtml}`;

  return {
    subject: shouldIncludeReference
      ? `[${ticketReference}] ${renderedSubject}`
      : renderedSubject,
    text: [renderedText, referenceText].filter(Boolean).join("\n\n"),
    html: mergedHtml,
    ticketReference: shouldIncludeReference ? ticketReference : null,
  };
}
