import { describe, expect, it } from "vitest";
import { renderCustomerConfirmation } from "../customer-confirmation.js";

describe("renderCustomerConfirmation", () => {
  it("adds the system-controlled ticket reference", () => {
    const result = renderCustomerConfirmation({
      ticketNumber: 50001,
      tokens: { customer_first_name: "Anna", team_name: "AceZone" },
    });
    expect(result.subject).toBe("[T-50001] We've received your message");
    expect(result.text).toContain("Hi Anna");
    expect(result.text).toContain("Ticket reference: T-50001");
    expect(result.html).toContain("Ticket reference: T-50001");
  });

  it("omits the ticket reference everywhere when disabled", () => {
    const result = renderCustomerConfirmation({
      ticketNumber: 50001,
      includeTicketNumber: false,
    });
    expect(result.subject).toBe("We've received your message");
    expect(result.text).not.toContain("T-50001");
    expect(result.html).not.toContain("T-50001");
  });
});

describe("ticket reference placed in the design", () => {
  const layout = '<main>{{content}}</main><footer>Ref {{ticket_reference}}</footer>';

  it("fills the placed reference instead of appending the default line", () => {
    const rendered = renderCustomerConfirmation({ templateHtml: layout, includeTicketNumber: true, ticketNumber: 50001 });
    expect(rendered.html).toContain("<footer>Ref T-50001</footer>");
    expect(rendered.html).not.toContain("Ticket reference: T-50001");
    expect(rendered.subject.startsWith("[T-50001] ")).toBe(true);
  });

  it("empties the placed reference when the reference is turned off", () => {
    const rendered = renderCustomerConfirmation({ templateHtml: layout, includeTicketNumber: false, ticketNumber: 50001 });
    expect(rendered.html).toContain("<footer>Ref </footer>");
    expect(rendered.html).not.toContain("T-50001");
  });

  it("keeps the default line for designs without a placed reference", () => {
    const rendered = renderCustomerConfirmation({ templateHtml: "<main>{{content}}</main>", includeTicketNumber: true, ticketNumber: 50001 });
    expect(rendered.html).toContain("Ticket reference: T-50001");
  });
});
