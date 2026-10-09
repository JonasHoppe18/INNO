import { renderCustomerConfirmation } from "@/lib/server/customer-confirmation";

// Settings preview of the live confirmation email, rendered like the sender with sample values.
export function renderConfirmationPreview({
  templateHtml,
  subjectTemplate,
  bodyTextTemplate,
  bodyHtmlTemplate,
  includeTicketNumber,
  teamName,
}) {
  const { subject, html } = renderCustomerConfirmation({
    subjectTemplate,
    bodyTextTemplate,
    bodyHtmlTemplate,
    templateHtml,
    includeTicketNumber,
    ticketNumber: 50001,
    tokens: {
      customer_name: "Alex Jensen",
      customer_first_name: "Alex",
      team_name: String(teamName || "").trim() || "Sona",
      subject: "Question about my order",
    },
  });
  return { subject, html };
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
