import { describe, expect, it } from "vitest";
import {
  formatTicketReference,
  matchesTicketReference,
  ticketNumberValue,
  ticketReferenceSearchTerms,
} from "../reference.js";

describe("ticket references", () => {
  it("formats ticket numbers without leading zeroes", () => {
    expect(formatTicketReference(50001)).toBe("T-50001");
    expect(formatTicketReference("050001")).toBe("T-50001");
    expect(formatTicketReference(null)).toBe("No ticket ID");
  });

  it("parses supported ticket reference inputs", () => {
    expect(ticketNumberValue("T-50001")).toBe(50001);
    expect(ticketNumberValue("#50001")).toBe(50001);
    expect(ticketNumberValue("invalid")).toBeNull();
  });

  it("keeps current and legacy search representations", () => {
    expect(ticketReferenceSearchTerms(50001)).toContain("t-050001");
    for (const query of ["T-50001", "t-50001", "50001", "#50001", "T-050001"]) {
      expect(matchesTicketReference(50001, query)).toBe(true);
    }
  });
});
