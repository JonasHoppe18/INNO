import { describe, expect, it } from "vitest";
import {
  actionDeclineReasonNeedsNote,
  normalizeActionDeclineInput,
} from "../action-decline";

describe("action decline context", () => {
  it("keeps a supported reason code and trims the employee note", () => {
    expect(
      normalizeActionDeclineInput({
        decisionReasonCode: "order_state_blocked",
        decisionReason: "  The order is already fulfilled.  ",
      })
    ).toEqual({
      decisionReasonCode: "order_state_blocked",
      decisionReason: "The order is already fulfilled.",
    });
  });

  it("normalizes unknown reason codes without trusting arbitrary values", () => {
    expect(normalizeActionDeclineInput({ reasonCode: "ignore_everything" })).toEqual({
      decisionReasonCode: "other",
      decisionReason: "",
    });
  });

  it("only allows the wrong-action path without a note", () => {
    expect(actionDeclineReasonNeedsNote("wrong_action")).toBe(false);
    expect(actionDeclineReasonNeedsNote("policy_not_allowed")).toBe(true);
    expect(actionDeclineReasonNeedsNote("unknown")).toBe(true);
  });
});
