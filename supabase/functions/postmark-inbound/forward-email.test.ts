import { assert, assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import {
  buildForwardedBodies,
  buildPostmarkAttachments,
  materializeForwardAttachment,
  normalizeForwardSubject,
  isAuthorizedForwardSource,
} from "../_shared/forward-email.ts";

const pdfBase64 = "JVBERi0xLjQK";

Deno.test("auto-forward preserves metadata and PDF attachment payload", () => {
  const source = {
    subject: "Original request",
    body_text: "Please see the attached PDF.",
    body_html: "<p>Please see the attached PDF.</p>",
    from_name: "Customer Example",
    from_email: "customer@example.com",
    to_emails: ["support@example.com"],
    cc_emails: ["billing@example.com"],
    received_at: "2026-09-16T08:00:00.000Z",
  };
  const bodies = buildForwardedBodies(source);
  const attachment = materializeForwardAttachment(
    {
      filename: "invoice.pdf",
      mime_type: "application/pdf",
      size_bytes: 9,
      provider_attachment_id: null,
      storage_path: `inline:application/pdf;base64,${pdfBase64}`,
    },
    0,
    source.body_html,
  );

  assertStringIncludes(bodies.textBody, "Date: Wed, 16 Sep 2026 08:00:00 GMT");
  assertStringIncludes(bodies.textBody, "To: support@example.com");
  assertStringIncludes(bodies.textBody, "Cc: billing@example.com");
  assertEquals(normalizeForwardSubject("Fwd: Original request"), "Fwd: Original request");
  assertStringIncludes(
    buildForwardedBodies({
      ...source,
      body_html: '<p>Inline logo</p><img src="cid:inline-logo">',
    }).htmlBody,
    'src="cid:inline-logo"',
  );
  assertEquals(buildPostmarkAttachments([attachment]), [
    {
      Name: "invoice.pdf",
      Content: pdfBase64,
      ContentType: "application/pdf",
    },
  ]);
});

Deno.test("auto-forward rejects missing persisted attachment bytes", () => {
  assertThrows(() =>
    materializeForwardAttachment(
      {
        filename: "missing.pdf",
        mime_type: "application/pdf",
        storage_path: null,
      },
      0,
      "",
    ),
  );
});

Deno.test("forward source scope rejects a different workspace", () => {
  assert(
    !isAuthorizedForwardSource(
      { id: "message-a", thread_id: "thread-a", mailbox_id: "mailbox-a", user_id: "user-a" },
      { id: "thread-a", workspace_id: "workspace-a" },
      { id: "mailbox-a", user_id: "user-a", workspace_id: "workspace-b" },
    ),
  );
});

Deno.test("forward HTML does not emit data URLs or authenticated attachment URLs", () => {
  const { htmlBody } = buildForwardedBodies({
    subject: "Unsafe body",
    body_text: "safe",
    body_html: '<p>safe</p><img src="data:image/png;base64,abc"><a href="/api/attachments/secret/download">file</a>',
    from_name: "Customer",
    from_email: "customer@example.com",
    to_emails: [],
    cc_emails: [],
    received_at: null,
  });
  assert(!htmlBody.includes("data:image"));
  assert(!htmlBody.includes("/api/attachments/"));
});
