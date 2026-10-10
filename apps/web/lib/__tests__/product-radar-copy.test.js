import { describe, expect, it } from "vitest";
import { describeRadarSignal, productRadarHref, usualLabel } from "../product-radar-copy.js";

describe("describeRadarSignal", () => {
  it("compares a spike week with the usual week", () => {
    expect(describeRadarSignal({ status: "spike", current: 14, baseline: 1.75 })).toBe("14 tickets in the last 7 days (usually 2)");
  });

  it("compares a rising month with the usual four weeks", () => {
    expect(describeRadarSignal({ status: "rising", recentTotal: 19, priorMean: 1.875 })).toBe("19 tickets in the last 4 weeks (usually 8)");
  });

  it("handles a quiet baseline and singular counts", () => {
    expect(usualLabel(0.3)).toBe("usually none");
    expect(describeRadarSignal({ status: "steady", current: 1 })).toBe("1 ticket in the last 7 days");
  });
});

describe("productRadarHref", () => {
  it("links to the Products tab and optionally a product", () => {
    expect(productRadarHref()).toBe("/analytics?report=products");
    expect(productRadarHref(42)).toBe("/analytics?report=products&product=42");
  });
});
