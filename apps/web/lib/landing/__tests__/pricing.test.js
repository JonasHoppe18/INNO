import { describe, it, expect } from "vitest";
import { PRICING_TIERS, formatTierPrice } from "../pricing";

describe("pricing tiers", () => {
  it("has the four approved tiers in ascending order", () => {
    expect(PRICING_TIERS.map((t) => [t.id, t.tickets, t.dkk, t.eur])).toEqual([
      ["mini", 150, 699, 99],
      ["starter", 500, 1999, 269],
      ["growth", 2000, 3999, 549],
      ["scale", 5000, 6999, 949],
    ]);
  });
  it("highlights exactly growth", () => {
    expect(PRICING_TIERS.filter((t) => t.highlighted).map((t) => t.id)).toEqual(["growth"]);
  });
  it("formats DKK for da and EUR for en", () => {
    const starter = PRICING_TIERS.find((t) => t.id === "starter");
    expect(formatTierPrice(starter, "da")).toBe("1.999 kr");
    expect(formatTierPrice(starter, "en")).toBe("€269");
  });
});
