import { describe, expect, it } from "vitest";
import { splitActionApprovalOptions } from "../inbox/action-approval.js";

describe("forward approval payload", () => {
  it("preserves multiple recipients while keeping close-ticket control separate", () => {
    expect(splitActionApprovalOptions({
      decision: "accepted",
      actionType: "forward_email",
      options: {
        recipients: ["one@example.com", "two@example.com"],
        target_email: null,
        closeTicket: true,
      },
    })).toEqual({
      payloadOverride: {
        recipients: ["one@example.com", "two@example.com"],
        target_email: null,
      },
      shouldResolveAfterApproval: true,
    });
  });

  it("keeps legacy single-recipient payloads unchanged", () => {
    expect(splitActionApprovalOptions({
      decision: "accepted",
      actionType: "forward_email",
      options: { target_email: "one@example.com" },
    }).payloadOverride).toEqual({ target_email: "one@example.com" });
  });
});
