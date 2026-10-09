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

// Saving in the designer marks the draft "draft"; publishing marks it "published".
export function confirmationDraftStatus(draft) {
  if (!draft?.id) return { label: "Default design", variant: "neutral" };
  if (draft.published_version == null) return { label: "Draft not published", variant: "warning" };
  return draft.status === "published"
    ? { label: "Published", variant: "success" }
    : { label: "Unpublished changes", variant: "warning" };
}

// Designed emails are full documents with their own canvas; a bare layout gets
// an email-like frame so the preview reads like a received message.
export function previewDocument(html) {
  const source = String(html || "");
  if (/^\s*(<!doctype|<html)/i.test(source)) return source;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f4f4f5}body{padding:24px 16px;font-family:Arial,sans-serif}</style></head><body><div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px 28px">${source}</div></body></html>`;
}
