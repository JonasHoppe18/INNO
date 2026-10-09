import { describe, expect, it } from "vitest";
import { confirmationDraftStatus, renderConfirmationPreview } from "../confirmation-preview";

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
  it("describes the design state", () => {
    expect(confirmationDraftStatus(null)).toEqual({ label: "Default design", variant: "neutral" });
    expect(confirmationDraftStatus({ version: 0, published_version: null })).toEqual({ label: "Default design", variant: "neutral" });
    expect(confirmationDraftStatus({ version: 3, published_version: 3 })).toEqual({ label: "Published", variant: "success" });
    expect(confirmationDraftStatus({ version: 4, published_version: 3 })).toEqual({ label: "Unpublished changes", variant: "warning" });
    expect(confirmationDraftStatus({ version: 2, published_version: null })).toEqual({ label: "Draft not published", variant: "warning" });
  });
});
