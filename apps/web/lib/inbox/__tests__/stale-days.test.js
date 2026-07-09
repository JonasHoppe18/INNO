import { describe, it, expect } from "vitest";
import { normalizeStaleDays } from "../stale-days.js";

describe("normalizeStaleDays", () => {
  it("defaults non-numbers to 7", () => {
    expect(normalizeStaleDays(undefined)).toBe(7);
    expect(normalizeStaleDays(null)).toBe(7);
    expect(normalizeStaleDays("abc")).toBe(7);
  });
  it("passes through valid integers", () => {
    expect(normalizeStaleDays(0)).toBe(0);
    expect(normalizeStaleDays(14)).toBe(14);
    expect(normalizeStaleDays("30")).toBe(30);
  });
  it("clamps to 0..365 and rounds", () => {
    expect(normalizeStaleDays(-5)).toBe(0);
    expect(normalizeStaleDays(999)).toBe(365);
    expect(normalizeStaleDays(7.6)).toBe(8);
  });
});
