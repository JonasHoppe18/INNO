import { describe, expect, it } from "vitest";
import { createConfirmationContent } from "@/lib/confirmation/email-template";
import {
  compileConfirmationEmail,
  normalizeConfirmationContent,
  previewConfirmationEmail,
} from "../confirmation-email";
import { renderCustomerConfirmation } from "../customer-confirmation";
import { normalizeCsatTemplateContent } from "../csat-email";
describe("confirmation email design", () => {
  it("renders the new layout using the unchanged confirmation sender contract", async () => {
    const source = createConfirmationContent();
    source.blocks[0].children[0].unshift({
      id: "logo",
      type: "image",
      src: "https://example.com/logo.png",
      alt: "Store",
      width: 140,
    });
    const compiled = await compileConfirmationEmail({
      content: source,
      subject: "Hello {{customer.first_name}}",
    });
    expect(compiled.html.match(/{{content}}/g)).toHaveLength(1);
    const mail = renderCustomerConfirmation({
      templateHtml: compiled.html,
      bodyTextTemplate: compiled.text,
      subjectTemplate: compiled.subject,
      tokens: {
        customer_first_name: "<script>alert(1)</script>",
        team_name: "Example",
      },
      ticketNumber: 50001,
    });
    expect(mail.html).toContain("logo.png");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("Ticket reference: T-50001");
    expect(mail.text).toContain("Example");
    expect(mail.html).not.toContain("{{content}}");
  });
  it("preserves legacy tokens, optional ticket references and plaintext fallback", async () => {
    const result = await previewConfirmationEmail(
      {
        content: createConfirmationContent(
          "Hi {{customer_first_name}}\nThanks from {{team_name}}",
        ),
        subject: "Hello {{customer_first_name}}",
      },
      false,
    );
    expect(result.subject).toBe("Hello Alex");
    expect(result.text).toContain("Demo Store");
    expect(result.html).not.toContain("Ticket reference:");
  });
  it("rejects unsafe input, unsupported variables and a missing/duplicate message", async () => {
    const source = createConfirmationContent();
    source.blocks[0].children[0][0].fieldValues.message =
      "<script>bad</script>";
    expect(() => normalizeConfirmationContent(source)).toThrow();
    source.blocks[0].children[0][0].fieldValues.message = "{{customer.secret}}";
    expect(() => normalizeConfirmationContent(source)).toThrow("Unsupported");
    source.blocks[0].children[0] = [];
    expect(() => normalizeConfirmationContent(source)).toThrow("exactly one");
    const duplicate = createConfirmationContent();
    duplicate.blocks.push(...structuredClone(duplicate.blocks));
    expect(() => normalizeConfirmationContent(duplicate)).toThrow(
      "exactly one",
    );
    const wrongPlace = createConfirmationContent();
    wrongPlace.blocks[0].children[0].push({
      type: "paragraph",
      content: "{{customer.first_name}}",
    });
    expect(() => normalizeConfirmationContent(wrongPlace)).toThrow("belong");
  });
  it("lets the design place the ticket reference outside the message", async () => {
    const source = createConfirmationContent();
    source.blocks[0].children[0].push({
      id: "footer-ref",
      type: "paragraph",
      content: "Your reference: {{ticket.reference}}",
    });
    const compiled = await compileConfirmationEmail({ content: source, subject: "Hi" });
    expect(compiled.html).toContain("{{ticket_reference}}");
    expect(compiled.html).not.toContain("{{ticket.reference}}");
    const mail = renderCustomerConfirmation({
      templateHtml: compiled.html,
      bodyTextTemplate: compiled.text,
      subjectTemplate: compiled.subject,
      ticketNumber: 50001,
    });
    expect(mail.html).toContain("Your reference: T-50001");
    expect(mail.html).not.toContain("Ticket reference: T-50001");
  });
  it("keeps the ticket reference out of the message block", () => {
    const source = createConfirmationContent();
    source.blocks[0].children[0][0].fieldValues.message = "Hi\nRef {{ticket.reference}}";
    expect(() => normalizeConfirmationContent(source)).toThrow("ticket reference");
  });
  it("keeps CSAT rating requirements intact", () => {
    expect(() =>
      normalizeCsatTemplateContent(createConfirmationContent()),
    ).toThrow();
  });
});
