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
