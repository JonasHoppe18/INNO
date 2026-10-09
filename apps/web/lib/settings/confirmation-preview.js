// Mirrors how postmark-inbound renders the customer confirmation, with sample values,
// so Settings can preview the published email.
const SAMPLE_REFERENCE = "T-50001";

const escapeHtml = (value) =>
  String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fillTokens(template, values) {
  let result = String(template || "");
  Object.entries(values).forEach(([key, value]) => {
    result = result.replaceAll(`{{${key}}}`, String(value ?? ""));
  });
  return result;
}

export function renderConfirmationPreview({
  templateHtml,
  subjectTemplate,
  bodyTextTemplate,
  bodyHtmlTemplate,
  includeTicketNumber,
  teamName,
}) {
  const tokens = {
    customer_name: "Alex Jensen",
    customer_first_name: "Alex",
    team_name: String(teamName || "").trim() || "Sona",
    subject: "Question about my order",
  };
  const subject = fillTokens(subjectTemplate, tokens);
  const text = fillTokens(bodyTextTemplate, tokens);
  let body =
    fillTokens(bodyHtmlTemplate || "", tokens) ||
    `<p style="white-space:pre-wrap">${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
  if (includeTicketNumber) {
    body += `<p style="margin-top:24px;color:#64748b;font-size:13px">${escapeHtml(`Ticket reference: ${SAMPLE_REFERENCE}`)}</p>`;
  }
  const layout = String(templateHtml || "");
  const html = layout.includes("{{content}}") ? layout.replace("{{content}}", body) : `${layout}\n${body}`;
  return {
    subject: includeTicketNumber ? `[${SAMPLE_REFERENCE}] ${subject}` : subject,
    html,
  };
}

export function confirmationDraftStatus(draft) {
  const version = Number(draft?.version) || 0;
  const published = draft?.published_version == null ? null : Number(draft.published_version);
  if (published == null) {
    return version > 0
      ? { label: "Draft not published", variant: "warning" }
      : { label: "Default design", variant: "neutral" };
  }
  return version > published
    ? { label: "Unpublished changes", variant: "warning" }
    : { label: "Published", variant: "success" };
}
