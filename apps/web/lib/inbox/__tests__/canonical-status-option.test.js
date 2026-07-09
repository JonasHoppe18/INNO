import { describe, it, expect } from "vitest";
import { canonicalStatusOption, CANONICAL_STATUS_OPTIONS } from "../view-model.js";

describe("canonicalStatusOption", () => {
  it("maps needs_attention", () => {
    expect(canonicalStatusOption({ status: "needs_attention" })).toBe("needs_attention");
  });
  it("preserves waiting_third_party", () => {
    expect(canonicalStatusOption({ status: "waiting_third_party" })).toBe("waiting_third_party");
  });
  it("splits generic waiting by waiting_reason", () => {
    expect(canonicalStatusOption({ status: "waiting_customer", waiting_reason: "third_party" }))
      .toBe("waiting_third_party");
    expect(canonicalStatusOption({ status: "Waiting", waiting_reason: "third_party" }))
      .toBe("waiting_third_party");
    expect(canonicalStatusOption({ status: "Waiting" })).toBe("waiting_customer");
  });
  it("maps legacy Solved/Open", () => {
    expect(canonicalStatusOption({ status: "Solved" })).toBe("resolved");
    expect(canonicalStatusOption({ status: "Open" })).toBe("needs_attention");
  });
  it("defaults empty to needs_attention", () => {
    expect(canonicalStatusOption({})).toBe("needs_attention");
    expect(canonicalStatusOption(null)).toBe("needs_attention");
  });
  it("exposes the 4 canonical options in order", () => {
    expect(CANONICAL_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      "needs_attention", "waiting_customer", "waiting_third_party", "resolved",
    ]);
  });
});
