import { describe, expect, it } from "vitest";
import { describeActionTypes, flowDetail, formatWait } from "../dashboard-queue-copy.js";

describe("formatWait", () => {
  it("uses hours for two days, then days", () => {
    expect(formatWait(0)).toBe("under 1h");
    expect(formatWait(26)).toBe("26h");
    expect(formatWait(72)).toBe("3d");
    expect(formatWait(null)).toBeNull();
  });
});

describe("describeActionTypes", () => {
  it("names the most common action and counts the rest", () => {
    expect(describeActionTypes({ create_refund: 2 })).toBe("2 refunds");
    expect(describeActionTypes({ change_shipping_address: 1, create_refund: 2, cancel_order: 1 })).toBe("2 refunds, 2 other");
    expect(describeActionTypes({ something_new: 1 })).toBe("1 action");
  });
});

describe("flowDetail", () => {
  it("leads with overdue tickets and falls back to the oldest wait", () => {
    expect(flowDetail("needsReply", { count: 3, overdue: 1, oldestHours: 30 })).toBe("1 waiting over 24h");
    expect(flowDetail("needsReply", { count: 3, overdue: 0, oldestHours: 5 })).toBe("Oldest 5h");
    expect(flowDetail("waiting", { count: 5, oldestHours: 72 })).toBe("Oldest 3d");
    expect(flowDetail("repliesReady", { count: 0 })).toBe("No replies waiting");
  });
});
