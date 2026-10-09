import { describe, expect, it } from "vitest";
import { renderCustomerConfirmation } from "../customer-confirmation.js";

const LEGACY_TEXT = "Hi {{customer_first_name}},\n\nThanks.\n\nBest,\n{{team_name}}";
const tokens = { customer_first_name: "Anna", team_name: "AceZone" };

describe("default confirmation", () => {
  it("shows the reference in the subject and the message", () => {
    const result = renderCustomerConfirmation({ ticketNumber: 50001, tokens });
    expect(result.subject).toBe("[T-50001] We've received your message");
    expect(result.text).toContain("Hi Anna");
    expect(result.text).toContain("Your ticket number: T-50001");
    expect(result.html).toContain("Your ticket number: T-50001");
    expect(result.html).not.toContain("Ticket reference: T-50001");
  });
});

describe("designs that use the reference variable decide where it goes", () => {
  it("fills it wherever it is placed and adds nothing else", () => {
    const rendered = renderCustomerConfirmation({
      subjectTemplate: "Thanks!",
      bodyTextTemplate: LEGACY_TEXT,
      templateHtml: "<main>{{content}}</main><footer>Ref {{ticket_reference}}</footer>",
      ticketNumber: 50001,
      tokens,
    });
    expect(rendered.html).toContain("<footer>Ref T-50001</footer>");
    expect(rendered.html).not.toContain("Ticket reference: T-50001");
    expect(rendered.subject).toBe("Thanks!");
  });

  it("ignores the old switch once the design uses the variable", () => {
    const rendered = renderCustomerConfirmation({
      bodyTextTemplate: "Hi\n\nYour ticket number: {{ticket_reference}}",
      subjectTemplate: "[{{ticket_reference}}] Hello",
      includeTicketNumber: false,
      ticketNumber: 50001,
    });
    expect(rendered.subject).toBe("[T-50001] Hello");
    expect(rendered.text).toBe("Hi\n\nYour ticket number: T-50001");
  });

  it("drops lines and subject brackets when there is no ticket number", () => {
    const rendered = renderCustomerConfirmation({
      bodyTextTemplate: "Hi\n\nYour ticket number: {{ticket_reference}}\n\nBest",
      subjectTemplate: "[{{ticket_reference}}] Hello",
      ticketNumber: null,
    });
    expect(rendered.subject).toBe("Hello");
    expect(rendered.text).toBe("Hi\n\nBest");
  });
});

describe("older saved designs without the variable keep the old switch", () => {
  it("adds the subject prefix and footer line when it is on", () => {
    const rendered = renderCustomerConfirmation({
      subjectTemplate: "We've received your message",
      bodyTextTemplate: LEGACY_TEXT,
      templateHtml: "<main>{{content}}</main>",
      includeTicketNumber: true,
      ticketNumber: 50001,
      tokens,
    });
    expect(rendered.subject).toBe("[T-50001] We've received your message");
    expect(rendered.text).toContain("Ticket reference: T-50001");
    expect(rendered.html).toContain("Ticket reference: T-50001");
  });

  it("leaves the reference out everywhere when it is off", () => {
    const rendered = renderCustomerConfirmation({
      subjectTemplate: "We've received your message",
      bodyTextTemplate: LEGACY_TEXT,
      includeTicketNumber: false,
      ticketNumber: 50001,
      tokens,
    });
    expect(rendered.subject).toBe("We've received your message");
    expect(rendered.text).not.toContain("T-50001");
    expect(rendered.html).not.toContain("T-50001");
  });
});

describe("full designs fill the variables across the whole email", () => {
  const html =
    '<!--sona:full-design--><h2>Thanks, {{customer_first_name}}</h2><p>Your ticket number: <span style="color:#e11d48">{{ticket_reference}}</span></p><p>{{team_name}}</p>';
  const text = "Thanks, {{customer_first_name}}\n\nYour ticket number: {{ticket_reference}}\n\n{{team_name}}";

  it("escapes values in the HTML, keeps formatting and fills the text version", () => {
    const mail = renderCustomerConfirmation({
      subjectTemplate: "[{{ticket_reference}}] Hi",
      bodyTextTemplate: text,
      templateHtml: html,
      ticketNumber: 50001,
      tokens: { customer_first_name: "<script>x</script>", team_name: "Example & Co" },
    });
    expect(mail.html).toContain("Thanks, &lt;script&gt;x&lt;/script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain('<span style="color:#e11d48">T-50001</span>');
    expect(mail.html).toContain("<p>Example &amp; Co</p>");
    expect(mail.html).not.toContain("sona:full-design");
    expect(mail.text).toBe("Thanks, <script>x</script>\n\nYour ticket number: T-50001\n\nExample & Co");
    expect(mail.subject).toBe("[T-50001] Hi");
    expect(mail.ticketReference).toBe("T-50001");
  });

  it("drops the reference cleanly when there is no ticket number", () => {
    const mail = renderCustomerConfirmation({
      subjectTemplate: "[{{ticket_reference}}] Hi",
      bodyTextTemplate: text,
      templateHtml: html,
      ticketNumber: null,
      tokens: { customer_first_name: "Anna", team_name: "Shop" },
    });
    expect(mail.subject).toBe("Hi");
    expect(mail.html).not.toContain("{{");
    expect(mail.text).toBe("Thanks, Anna\n\nShop");
  });

  it("leaves unknown tokens out instead of showing braces", () => {
    const mail = renderCustomerConfirmation({ templateHtml: "<!--sona:full-design--><p>{{customer_name}}</p>", bodyTextTemplate: "{{customer_name}}", ticketNumber: 1 });
    expect(mail.html).toBe("<p></p>");
    expect(mail.text).toBe("");
  });
});
