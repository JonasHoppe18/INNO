import { describe, it, expect } from "vitest";
import { PRICING_TIERS, formatTierPrice } from "../pricing";

describe("pricing tiers", () => {
  it("has the four approved DKK tiers in ascending order", () => {
    expect(PRICING_TIERS.map((t) => [t.id, t.tickets, t.dkk])).toEqual([
      ["solo", 100, 999],
      ["starter", 250, 1995],
      ["growth", 1000, 4995],
      ["scale", 3000, 9995],
    ]);
  });
  it("highlights exactly growth", () => {
    expect(PRICING_TIERS.filter((t) => t.highlighted).map((t) => t.id)).toEqual(["growth"]);
  });
  it("formats DKK for both landing locales", () => {
    const starter = PRICING_TIERS.find((t) => t.id === "starter");
    expect(formatTierPrice(starter, "da")).toBe("1.995 kr");
    expect(formatTierPrice(starter, "en")).toBe("1,995 kr");
  });
});
