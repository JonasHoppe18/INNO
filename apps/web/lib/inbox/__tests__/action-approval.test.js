import { describe, expect, it } from "vitest";
import { splitActionApprovalOptions } from "../action-approval.js";

describe("splitActionApprovalOptions", () => {
  it("keeps the forwarding payload and requests resolve when selected", () => {
    expect(
      splitActionApprovalOptions({
        decision: "accepted",
        actionType: "forward_email",
        options: {
          target_email: "warehouse@example.com",
          closeTicket: true,
        },
      }),
    ).toEqual({
      payloadOverride: { target_email: "warehouse@example.com" },
      shouldResolveAfterApproval: true,
    });
  });

  it("approves forwarding without resolving when not selected", () => {
    expect(
      splitActionApprovalOptions({
        decision: "accepted",
        actionType: "forward_email",
        options: {
          target_email: "warehouse@example.com",
          closeTicket: false,
        },
      }),
    ).toEqual({
      payloadOverride: { target_email: "warehouse@example.com" },
      shouldResolveAfterApproval: false,
    });
  });

  it("never lets the UI-only close flag leak into another action payload", () => {
    expect(
      splitActionApprovalOptions({
        decision: "accepted",
        actionType: "refund_order",
        options: { amount: 100, closeTicket: true },
      }),
    ).toEqual({
      payloadOverride: { amount: 100 },
      shouldResolveAfterApproval: false,
    });
  });

  it("does not create an approval payload for a declined action", () => {
    expect(
      splitActionApprovalOptions({
        decision: "denied",
        actionType: "forward_email",
        options: { closeTicket: true },
      }),
    ).toEqual({
      payloadOverride: null,
      shouldResolveAfterApproval: false,
    });
  });
});
