import { describe, expect, it } from "vitest";
import { modelConversationContext, nextConversationContext } from "../conversation-context";

describe("greenfield conversation context", () => {
  it("exposes only compact continuity state to the model", () => {
    const activeOrder = {
      requestedOrderId: "10231",
      state: "verified",
      order: {
        id: "shopify-10231",
        orderNumber: "10231",
        status: "fulfilled",
        fulfillments: [{ id: "fulfillment-10231", trackingNumber: "PC10231" }],
      },
    };

    const input = modelConversationContext(
      { turn: 1, activeOrder, customerSignal: null },
      activeOrder,
      "Never mind, I found it.",
    );

    expect(input).toContain('"state":"verified"');
    expect(input).toContain('"verified_order_number":"10231"');
    expect(input).toContain('"customer_signal":"resolution"');
    expect(input).not.toContain("PC10231");
  });

  it("makes the latest customer resolution the current signal", () => {
    const result = nextConversationContext(
      { turn: 3, activeOrder: null, customerSignal: null },
      null,
      "The issue is solved now, thanks.",
    );

    expect(result).toEqual({ turn: 4, activeOrder: null, customerSignal: "resolution" });
  });
});
