import { describe, expect, it } from "vitest";
import { toDesignerTokens, toStoredTokens } from "../email-template";

describe("confirmation variable syntax", () => {
  it("shows stored tokens in the designer syntax", () => {
    expect(toDesignerTokens("[{{ticket_reference}}] Hi {{customer_first_name}} from {{team_name}}"))
      .toBe("[{{ticket.reference}}] Hi {{customer.first_name}} from {{store.name}}");
  });

  it("stores designer tokens in the sender syntax", () => {
    expect(toStoredTokens("[{{ ticket.reference }}] Hi {{customer.first_name}}"))
      .toBe("[{{ticket_reference}}] Hi {{customer_first_name}}");
  });

  it("leaves unknown variables and plain text alone", () => {
    expect(toStoredTokens("Hello {{order.number}}")).toBe("Hello {{order.number}}");
    expect(toDesignerTokens("Plain subject")).toBe("Plain subject");
  });
});
