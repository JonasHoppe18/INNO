import { describe, expect, it } from "vitest";
import {
  normalizeActionModes,
  resolveActionMode,
  validateActionModes,
} from "../action-modes";

describe("action modes", () => {
  it("uses conservative defaults", () => {
    expect(normalizeActionModes()).toEqual({
      update_shipping_address: "approve",
      cancel_order: "approve",
      refund_order: "off",
      initiate_return: "off",
      create_exchange_request: "off",
    });
  });

  it("maps return executor aliases to the return setting", () => {
    expect(
      resolveActionMode("send_return_instructions", {
        initiate_return: "approve",
      })
    ).toBe("approve");
  });

  it("rejects auto for actions without a complete executor policy", () => {
    expect(validateActionModes({ refund_order: "auto" })).toEqual({
      ok: false,
      error: "refund_order cannot run automatically yet.",
    });
  });

  it("accepts and fills a valid partial settings payload", () => {
    expect(
      validateActionModes({
        update_shipping_address: "auto",
        cancel_order: "off",
      })
    ).toEqual({
      ok: true,
      value: {
        update_shipping_address: "auto",
        cancel_order: "off",
        refund_order: "off",
        initiate_return: "off",
        create_exchange_request: "off",
      },
    });
  });
});
