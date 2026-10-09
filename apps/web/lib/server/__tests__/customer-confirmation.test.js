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
