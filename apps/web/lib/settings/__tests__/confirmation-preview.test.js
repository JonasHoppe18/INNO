import { describe, expect, it } from "vitest";
import { confirmationDraftStatus, previewDocument, renderConfirmationPreview } from "../confirmation-preview";

describe("renderConfirmationPreview", () => {
  const base = {
    templateHtml: '<div class="brand">{{content}}</div>',
    subjectTemplate: "We've received your message",
    bodyTextTemplate: "Hi {{customer_first_name}},\nThanks! <b>not html</b>\n{{team_name}}",
    bodyHtmlTemplate: "",
    includeTicketNumber: true,
    teamName: "AceZone",
  };

  it("fills tokens and places the escaped message in the layout slot like the sender", () => {
    const { subject, html } = renderConfirmationPreview(base);
    expect(subject).toBe("[T-50001] We've received your message");
    expect(html).toContain('<div class="brand"><p style="white-space:pre-wrap">Hi Alex,\nThanks! &lt;b&gt;not html&lt;/b&gt;\nAceZone</p>');
    expect(html).toContain("Ticket reference: T-50001");
  });

  it("leaves the reference out when it is turned off", () => {
    const { subject, html } = renderConfirmationPreview({ ...base, includeTicketNumber: false });
    expect(subject).toBe("We've received your message");
    expect(html).not.toContain("T-50001");
  });

  it("appends the message when the layout has no content slot", () => {
    const { html } = renderConfirmationPreview({ ...base, templateHtml: "<header>Logo</header>" });
    expect(html.startsWith("<header>Logo</header>\n<p")).toBe(true);
  });

  it("prefers the rich body template when present", () => {
    const { html } = renderConfirmationPreview({ ...base, bodyHtmlTemplate: "<p>Hej {{customer_first_name}}</p>" });
    expect(html).toContain("<p>Hej Alex</p>");
  });
});

describe("confirmationDraftStatus", () => {
  it("reads the draft status the designer stores", () => {
    expect(confirmationDraftStatus(null)).toEqual({ label: "Default design", variant: "neutral" });
    expect(confirmationDraftStatus({ id: null, status: "draft", published_version: null })).toEqual({ label: "Default design", variant: "neutral" });
    expect(confirmationDraftStatus({ id: "d1", status: "draft", published_version: null })).toEqual({ label: "Draft not published", variant: "warning" });
    expect(confirmationDraftStatus({ id: "d1", status: "published", version: 3, published_version: 3 })).toEqual({ label: "Published", variant: "success" });
    expect(confirmationDraftStatus({ id: "d1", status: "draft", version: 3, published_version: 3 })).toEqual({ label: "Unpublished changes", variant: "warning" });
  });
});

describe("previewDocument", () => {
  it("frames a bare layout like an email on a neutral canvas", () => {
    const doc = previewDocument('<div style="color:#111">Hi</div>');
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("max-width:600px");
    expect(doc).toContain('<div style="color:#111">Hi</div>');
  });

  it("leaves a full designed email document as it is", () => {
    const designed = "<!doctype html><html><body style=\"background:#000\">Hi</body></html>";
    expect(previewDocument(designed)).toBe(designed);
    expect(previewDocument("  <html><body>Hi</body></html>")).toBe("  <html><body>Hi</body></html>");
  });
});
