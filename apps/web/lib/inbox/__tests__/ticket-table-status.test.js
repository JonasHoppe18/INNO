import { describe, expect, it } from "vitest";
import {
  isWaitingTicketStatus,
  normalizeTicketStatusLabel,
} from "../ticket-table-status.js";

describe("View All ticket status mapping", () => {
  it("maps canonical waiting statuses to Waiting", () => {
    expect(normalizeTicketStatusLabel("waiting_customer")).toBe("Waiting");
    expect(normalizeTicketStatusLabel("waiting_third_party")).toBe("Waiting");
  });

  it("includes canonical waiting statuses in the Waiting filter", () => {
    expect(isWaitingTicketStatus(normalizeTicketStatusLabel("waiting_customer"))).toBe(true);
    expect(isWaitingTicketStatus(normalizeTicketStatusLabel("waiting_third_party"))).toBe(true);
  });

  it("keeps open, resolved, and supported legacy mappings intact", () => {
    expect(normalizeTicketStatusLabel("needs_attention")).toBe("Open");
    expect(normalizeTicketStatusLabel("resolved")).toBe("Resolved");
    expect(normalizeTicketStatusLabel("new")).toBe("New");
    expect(normalizeTicketStatusLabel("open")).toBe("Open");
    expect(normalizeTicketStatusLabel("pending")).toBe("Pending");
    expect(normalizeTicketStatusLabel("waiting")).toBe("Waiting");
    expect(isWaitingTicketStatus("Open")).toBe(false);
    expect(isWaitingTicketStatus("Resolved")).toBe(false);
  });
});
