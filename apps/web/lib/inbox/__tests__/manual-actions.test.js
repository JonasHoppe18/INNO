import { describe, it, expect } from "vitest";
import {
  buildManualActionInsert,
  resolveMatchedOrder,
  MANUAL_ACTION_TYPES,
  RETURN_REASONS,
} from "../manual-actions.js";

const order = { id: "#4538", adminId: "5891234567891" };

describe("resolveMatchedOrder", () => {
  it("returns the first order when present", () => {
    expect(resolveMatchedOrder([order, { id: "#9" }])).toBe(order);
  });

  it("returns null when there are no orders", () => {
    expect(resolveMatchedOrder([])).toBeNull();
    expect(resolveMatchedOrder(null)).toBeNull();
    expect(resolveMatchedOrder(undefined)).toBeNull();
  });
});

describe("MANUAL_ACTION_TYPES", () => {
  it("excludes create_exchange_request", () => {
    expect(MANUAL_ACTION_TYPES).not.toContain("create_exchange_request");
    expect(MANUAL_ACTION_TYPES).toEqual([
      "update_shipping_address",
      "cancel_order",
      "refund_order",
      "initiate_return",
    ]);
  });
});

describe("buildManualActionInsert", () => {
  it("rejects an unsupported action type", () => {
    const result = buildManualActionInsert({
      actionType: "create_exchange_request",
      order,
      formPayload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when there is no matched order", () => {
    const result = buildManualActionInsert({ actionType: "cancel_order", order: null, formPayload: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/matched order/i);
  });

  it("rejects an order missing adminId or id", () => {
    const result = buildManualActionInsert({
      actionType: "cancel_order",
      order: { id: "#4538" },
      formPayload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("accepts an order whose id/adminId are numbers, as the real customer-lookup payload sends them", () => {
    const numericOrder = { id: 1048, adminId: 17013859123549 };
    const result = buildManualActionInsert({
      actionType: "cancel_order",
      order: numericOrder,
      formPayload: {},
    });
    expect(result).toEqual({
      ok: true,
      insert: {
        action_type: "cancel_order",
        order_id: "17013859123549",
        order_number: "1048",
        payload: {},
      },
    });
  });

  it("builds a cancel_order insert with an empty payload, mapping order fields correctly", () => {
    const result = buildManualActionInsert({ actionType: "cancel_order", order, formPayload: {} });
    expect(result).toEqual({
      ok: true,
      insert: {
        action_type: "cancel_order",
        order_id: "5891234567891",
        order_number: "#4538",
        payload: {},
      },
    });
  });

  it("requires address1, zip, city and country for update_shipping_address", () => {
    const result = buildManualActionInsert({
      actionType: "update_shipping_address",
      order,
      formPayload: { address1: "", zip: "8000", city: "Aarhus", country: "DK" },
    });
    expect(result.ok).toBe(false);
  });

  it("builds an update_shipping_address insert, omitting blank optional fields", () => {
    const result = buildManualActionInsert({
      actionType: "update_shipping_address",
      order,
      formPayload: {
        name: "Jonas Hoppe",
        address1: "Main St 1",
        address2: "",
        zip: "8000",
        city: "Aarhus",
        country: "DK",
      },
    });
    expect(result.ok).toBe(true);
    expect(result.insert.payload).toEqual({
      shipping_address: {
        name: "Jonas Hoppe",
        address1: "Main St 1",
        zip: "8000",
        city: "Aarhus",
        country: "DK",
      },
    });
  });

  it("requires a positive amount for refund_order", () => {
    const result = buildManualActionInsert({ actionType: "refund_order", order, formPayload: { amount: 0 } });
    expect(result.ok).toBe(false);
    const negative = buildManualActionInsert({ actionType: "refund_order", order, formPayload: { amount: -5 } });
    expect(negative.ok).toBe(false);
  });

  it("builds a refund_order insert, coercing string amounts to numbers", () => {
    const result = buildManualActionInsert({
      actionType: "refund_order",
      order,
      formPayload: { amount: "199.50", note: "Damaged in transit" },
    });
    expect(result.ok).toBe(true);
    expect(result.insert.payload).toEqual({ amount: 199.5, note: "Damaged in transit" });
  });

  it("maps initiate_return to action_type create_return_case", () => {
    const result = buildManualActionInsert({
      actionType: "initiate_return",
      order,
      formPayload: { reason: "wrong_item" },
    });
    expect(result.ok).toBe(true);
    expect(result.insert.action_type).toBe("create_return_case");
    expect(result.insert.payload.reason).toBe("WRONG_ITEM");
  });

  it("rejects an invalid return reason", () => {
    const result = buildManualActionInsert({
      actionType: "initiate_return",
      order,
      formPayload: { reason: "because" },
    });
    expect(result.ok).toBe(false);
  });

  it("exposes the full return reason enum", () => {
    expect(RETURN_REASONS).toEqual([
      "COLOR",
      "DEFECTIVE",
      "NOT_AS_DESCRIBED",
      "OTHER",
      "SIZE_TOO_LARGE",
      "SIZE_TOO_SMALL",
      "STYLE",
      "UNKNOWN",
      "UNWANTED",
      "WRONG_ITEM",
    ]);
  });
});
