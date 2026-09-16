import { describe, expect, it } from "vitest";
import {
  buildForwardedBodies,
  buildOutlookAttachment,
  buildPostmarkAttachments,
  extractForwardedCidReferences,
  isAuthorizedForwardSource,
  materializeForwardAttachment,
  normalizeForwardSubject,
} from "../forward-email.js";

const pdfBase64 = "JVBERi0xLjQK";

const source = {
  subject: "Fwd: Original request",
  body_text: "Please see the attached PDF.",
  body_html: '<p>Please see the attached PDF.</p><img src="cid:inline-logo">',
  from_name: "Customer Example",
  from_email: "customer@example.com",
  to_emails: ["support@example.com"],
  cc_emails: ["billing@example.com"],
  received_at: "2026-09-16T08:00:00.000Z",
};

describe("forward email", () => {
  it("builds a customer-facing forward with metadata and safe original HTML", () => {
    const rendered = buildForwardedBodies({
      agentBodyText: "I am forwarding this for review.",
      source: {
        ...source,
        body_html:
          '<p>Please see the attached PDF.</p><script>alert(1)</script><img src="data:image/png;base64,abc">',
      },
    });

    expect(rendered.textBody).toContain("I am forwarding this for review.");
    expect(rendered.textBody).toContain("From: Customer Example <customer@example.com>");
    expect(rendered.textBody).toContain("Date: Wed, 16 Sep 2026 08:00:00 GMT");
    expect(rendered.textBody).toContain("Subject: Fwd: Original request");
    expect(rendered.textBody).toContain("To: support@example.com");
    expect(rendered.textBody).toContain("Cc: billing@example.com");
    expect(rendered.textBody).toContain("Please see the attached PDF.");
    expect(rendered.htmlBody).not.toContain("<script");
    expect(rendered.htmlBody).not.toContain("data:image");
  });

  it("normalizes forward subjects without stacking forward prefixes", () => {
    expect(normalizeForwardSubject("Fwd: Fw: Original request")).toBe(
      "Fwd: Original request",
    );
    expect(normalizeForwardSubject("Original request")).toBe("Fwd: Original request");
  });

  it("requires the source message to belong to the exact thread, mailbox, user, and workspace", () => {
    const sourceRow = {
      id: "message-a",
      thread_id: "thread-a",
      mailbox_id: "mailbox-a",
      user_id: "user-a",
    };
    const thread = { id: "thread-a", workspace_id: "workspace-a" };
    const mailbox = { id: "mailbox-a", user_id: "user-a", workspace_id: "workspace-a" };

    expect(isAuthorizedForwardSource({ source: sourceRow, thread, mailbox })).toBe(true);
    expect(
      isAuthorizedForwardSource({
        source: { ...sourceRow, thread_id: "thread-b" },
        thread,
        mailbox,
      }),
    ).toBe(false);
    expect(
      isAuthorizedForwardSource({
        source: sourceRow,
        thread,
        mailbox: { ...mailbox, workspace_id: "workspace-b" },
      }),
    ).toBe(false);
  });

  it("preserves PDF bytes, MIME type, inline metadata, and duplicate filenames", () => {
    const rows = [
      {
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        size_bytes: 9,
        provider_attachment_id: null,
        storage_path: `inline:application/pdf;base64,${pdfBase64}`,
      },
      {
        filename: "invoice.pdf",
        mime_type: "image/png",
        size_bytes: 9,
        provider_attachment_id: "inline-logo",
        storage_path: "inline:image/png;base64,aW1hZ2U=",
      },
    ];
    const attachments = rows.map((row, index) =>
      materializeForwardAttachment(row, index, { sourceHtml: source.body_html }),
    );

    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      filename: "invoice.pdf",
      mime_type: "application/pdf",
      content_base64: pdfBase64,
      is_inline: false,
    });
    expect(attachments[1]).toMatchObject({
      filename: "invoice.pdf",
      mime_type: "image/png",
      content_base64: "aW1hZ2U=",
      is_inline: true,
      content_id: "inline-logo",
    });
    expect(buildForwardedBodies({ source }).htmlBody).toContain(
      'src="cid:inline-logo"',
    );
    expect(extractForwardedCidReferences(source.body_html)).toEqual(["inline-logo"]);
  });

  it("fails instead of silently forwarding an attachment without persisted bytes", () => {
    expect(() =>
      materializeForwardAttachment(
        {
          filename: "missing.pdf",
          mime_type: "application/pdf",
          storage_path: null,
        },
        0,
      ),
    ).toThrow(/unavailable|missing/i);
  });

  it("maps the same materialized attachments to Postmark and Outlook", () => {
    const attachment = materializeForwardAttachment(
      {
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        size_bytes: 9,
        provider_attachment_id: null,
        storage_path: `inline:application/pdf;base64,${pdfBase64}`,
      },
      0,
    );

    expect(buildPostmarkAttachments([attachment])).toEqual([
      {
        Name: "invoice.pdf",
        Content: pdfBase64,
        ContentType: "application/pdf",
      },
    ]);
    expect(buildOutlookAttachment(attachment)).toEqual({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "invoice.pdf",
      contentType: "application/pdf",
      contentBytes: pdfBase64,
      isInline: false,
    });
  });
});
