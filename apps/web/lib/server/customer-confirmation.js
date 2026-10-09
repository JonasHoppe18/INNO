import { formatTicketReference } from "../tickets/reference.js";

export const CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT = "We've received your message";
export const CUSTOMER_CONFIRMATION_DEFAULT_TEXT =
  "Hi {{customer_first_name}},\n\nThanks for contacting us. We've received your message and our support team will get back to you as soon as possible. You can reply directly to this email if you would like to add more information.\n\nBest,\n{{team_name}}";
export const CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT =
  '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">{{content}}</div>';

export const TICKET_REFERENCE_TOKEN = "{{ticket_reference}}";

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
  const renderedSubject = fillConfirmationTokens(subjectTemplate, tokens);
  const renderedText = fillConfirmationTokens(bodyTextTemplate, tokens);
  const renderedBodyHtml =
    fillConfirmationTokens(bodyHtmlTemplate, tokens) ||
    `<p style="white-space:pre-wrap">${escapeConfirmationHtml(renderedText)}</p>`;
  const referenceText = shouldIncludeReference
    ? `Ticket reference: ${ticketReference}`
    : "";
  // A design can place the reference itself; otherwise it follows the message.
  const layout = String(templateHtml || "{{content}}");
  const placesReference = layout.includes(TICKET_REFERENCE_TOKEN);
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
