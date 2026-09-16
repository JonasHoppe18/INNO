import { describe, expect, it } from "vitest";
import { buildRawEmail } from "../email-transport.js";

function decodeRaw(raw) {
  return Buffer.from(
    String(raw || "").replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

describe("email transport attachment behavior", () => {
  it("puts a forwarded PDF in Gmail multipart MIME without reply headers", () => {
    const raw = decodeRaw(
      buildRawEmail({
        from: "AceZone Support <support@acezone.io>",
        to: ["recipient@example.com"],
        cc: [],
        bcc: [],
        subject: "Fwd: Original request",
        bodyText: "---------- Forwarded message ---------\nPDF attached",
        bodyHtml: "<p>---------- Forwarded message ---------</p>",
        inReplyTo: null,
        attachments: [
          {
            filename: "invoice.pdf",
            mime_type: "application/pdf",
            content_base64: "JVBERi0xLjQK",
            is_inline: false,
          },
        ],
      }),
    );

    expect(raw).toContain("From: AceZone Support <support@acezone.io>");
    expect(raw).toContain("Subject: Fwd: Original request");
    expect(raw).toContain("Content-Type: application/pdf; name=\"invoice.pdf\"");
    expect(raw).toContain("Content-Disposition: attachment; filename=\"invoice.pdf\"");
    expect(raw).toContain("JVBERi0xLjQK");
    expect(raw).not.toContain("In-Reply-To:");
  });
});
