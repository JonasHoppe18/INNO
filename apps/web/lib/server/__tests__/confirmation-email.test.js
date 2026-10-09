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
    expect(mail.html).toContain("Your ticket number: T-50001");
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
  it("rejects unsafe input, unsupported variables and a duplicate message", async () => {
    const source = createConfirmationContent();
    source.blocks[0].children[0][0].fieldValues.message =
      "<script>bad</script>";
    expect(() => normalizeConfirmationContent(source)).toThrow();
    source.blocks[0].children[0][0].fieldValues.message = "{{customer.secret}}";
    expect(() => normalizeConfirmationContent(source)).toThrow("Unsupported");
    const duplicate = createConfirmationContent();
    duplicate.blocks.push(...structuredClone(duplicate.blocks));
    expect(() => normalizeConfirmationContent(duplicate)).toThrow(
      "at most one",
    );
    const unknown = createConfirmationContent();
    unknown.blocks[0].children[0].push({ type: "paragraph", content: "<p>{{order.number}}</p>" });
    expect(() => normalizeConfirmationContent(unknown)).toThrow("can't be used");
    const inButton = createConfirmationContent();
    inButton.blocks[0].children[0].push({ type: "button", text: "Hi {{customer.first_name}}", url: "https://shop.test" });
    expect(() => normalizeConfirmationContent(inButton)).toThrow("text and headline");
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
  it("lets the message mention the ticket reference", async () => {
    const source = createConfirmationContent("Hi\nYour ticket number is {{ticket.reference}}.");
    const compiled = await compileConfirmationEmail({ content: source, subject: "Hi" });
    expect(compiled.text).toBe("Hi\nYour ticket number is {{ticket_reference}}.");
    const mail = renderCustomerConfirmation({
      templateHtml: compiled.html,
      bodyTextTemplate: compiled.text,
      subjectTemplate: compiled.subject,
      ticketNumber: 50001,
    });
    expect(mail.html).toContain("Your ticket number is T-50001.");
    expect(mail.html).not.toContain("Ticket reference: T-50001");
  });
  it("starts new designs with the reference in the message", () => {
    const message = createConfirmationContent().blocks[0].children[0][0].fieldValues.message;
    expect(message).toContain("{{ticket.reference}}");
  });
  it("keeps CSAT rating requirements intact", () => {
    expect(() =>
      normalizeCsatTemplateContent(createConfirmationContent()),
    ).toThrow();
  });
});

const fullDesign = () => ({
  settings: { width: 600, backgroundColor: "#ffffff" },
  blocks: [
    {
      id: "s",
      type: "section",
      columns: "1",
      styles: {},
      children: [[
        { id: "t", type: "title", level: 2, content: "Thanks, {{customer.first_name}}", textAlign: "center", styles: {} },
        {
          id: "p",
          type: "paragraph",
          content: '<p>Your ticket number: <span style="color: #e11d48">{{ticket.reference}}</span></p><p>Best,<br>{{ store.name }}</p>',
          styles: {},
        },
      ]],
    },
  ],
});

describe("full designs without the message block", () => {
  it("allows the confirmation variables in text and headlines", () => {
    const normalized = normalizeConfirmationContent(fullDesign());
    expect(JSON.stringify(normalized)).toContain("{{customer.first_name}}");
    expect(JSON.stringify(normalized)).toContain("{{store.name}}");
  });

  it("allows at most one legacy message block", () => {
    const two = createConfirmationContent();
    two.blocks[0].children[0].push(structuredClone(two.blocks[0].children[0][0]));
    expect(() => normalizeConfirmationContent(two)).toThrow("at most one");
  });

  it("compiles the whole email with sender tokens and a text version", async () => {
    const compiled = await compileConfirmationEmail({ content: fullDesign(), subject: "[{{ticket.reference}}] Hi" });
    expect(compiled.html.startsWith("<!--sona:full-design-->")).toBe(true);
    expect(compiled.html).not.toContain("{{content}}");
    expect(compiled.html).toContain("{{customer_first_name}}");
    expect(compiled.html).toContain("{{team_name}}");
    expect(compiled.html).toContain("{{ticket_reference}}");
    expect(compiled.html).not.toMatch(/SONAVAR|SONATICKET/);
    expect(compiled.html).toMatch(/color:\s*#e11d48/);
    expect(compiled.text).toBe("Thanks, {{customer_first_name}}\n\nYour ticket number: {{ticket_reference}}\n\nBest,\n{{team_name}}");
    expect(compiled.subject).toBe("[{{ticket_reference}}] Hi");
  });
});
