import { describe, expect, it } from "vitest";
import {
  getForwardActionResult,
  getForwardTargetEmail,
} from "../action-result.js";

describe("forward action result presentation", () => {
  it("shows the saved recipient instead of waiting for an order", () => {
    expect(
      getForwardActionResult({
        actionType: "forward_email",
        payload: { target_email: "Warehouse@Example.com" },
      }),
    ).toEqual({
      recipient: "warehouse@example.com",
      title: "warehouse@example.com",
    });
  });

  it("recovers the recipient from legacy action details", () => {
    expect(
      getForwardTargetEmail({}, "Forward this email to returns@example.com."),
    ).toBe("returns@example.com");
  });

  it("does not apply the forwarding result to Shopify actions", () => {
    expect(
      getForwardActionResult({
        actionType: "cancel_order",
        payload: { target_email: "warehouse@example.com" },
      }),
    ).toBeNull();
  });
});
