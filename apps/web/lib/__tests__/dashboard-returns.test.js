import { describe, expect, it } from "vitest";
import { openReturnShipments } from "../dashboard-returns.js";

describe("openReturnShipments", () => {
  it("drops returns whose refund is completed and keeps everything still in motion", () => {
    const rows = [
      { id: "a", status: "return_in_transit" },
      { id: "b", status: "refund_completed" },
      { id: "c", status: "refund_pending" },
      { id: "d", status: "return_exception" },
      { id: "e", status: null },
    ];
    expect(openReturnShipments(rows).map((row) => row.id)).toEqual(["a", "c", "d", "e"]);
  });

  it("handles missing data", () => {
    expect(openReturnShipments(null)).toEqual([]);
  });
});
