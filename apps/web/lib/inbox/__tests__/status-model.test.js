import { describe, it, expect } from "vitest";
import {
  LIFECYCLE_STATUSES,
  normalizeLifecycleStatus,
  toLegacyUiStatus,
  buildAgentReplyStatusPatch,
} from "../status-model.js";

describe("normalizeLifecycleStatus", () => {
  it("passes canonical values through", () => {
    for (const s of LIFECYCLE_STATUSES) {
      expect(normalizeLifecycleStatus(s)).toBe(s);
    }
  });
  it("maps every legacy value", () => {
    expect(normalizeLifecycleStatus("new")).toBe("needs_attention");
    expect(normalizeLifecycleStatus("open")).toBe("needs_attention");
    expect(normalizeLifecycleStatus("Open")).toBe("needs_attention");
    expect(normalizeLifecycleStatus("pending")).toBe("waiting_customer");
    expect(normalizeLifecycleStatus("waiting")).toBe("waiting_customer");
    expect(normalizeLifecycleStatus("solved")).toBe("resolved");
    expect(normalizeLifecycleStatus("Resolved")).toBe("resolved");
  });
  it("keeps blocked out-of-band", () => {
    expect(normalizeLifecycleStatus("blocked")).toBe("blocked");
  });
  it("defaults unknown and empty to needs_attention", () => {
    expect(normalizeLifecycleStatus("")).toBe("needs_attention");
    expect(normalizeLifecycleStatus(null)).toBe("needs_attention");
    expect(normalizeLifecycleStatus("garbage")).toBe("needs_attention");
  });
});

describe("toLegacyUiStatus", () => {
  it("maps lifecycle values to existing UI labels", () => {
    expect(toLegacyUiStatus("needs_attention")).toBe("Open");
    expect(toLegacyUiStatus("waiting_customer")).toBe("Waiting");
    expect(toLegacyUiStatus("waiting_third_party")).toBe("Waiting");
    expect(toLegacyUiStatus("resolved")).toBe("Solved");
  });
  it("keeps legacy values rendering as today", () => {
    expect(toLegacyUiStatus("new")).toBe("New");
    expect(toLegacyUiStatus("open")).toBe("Open");
    expect(toLegacyUiStatus("pending")).toBe("Pending");
    expect(toLegacyUiStatus("waiting")).toBe("Waiting");
    expect(toLegacyUiStatus("solved")).toBe("Solved");
    expect(toLegacyUiStatus("resolved")).toBe("Solved");
  });
  it("returns null for empty input (existing behavior)", () => {
    expect(toLegacyUiStatus("")).toBe(null);
    expect(toLegacyUiStatus(null)).toBe(null);
  });
});

describe("buildAgentReplyStatusPatch", () => {
  const now = "2026-07-03T12:00:00.000Z";
  it("moves to waiting_customer by default", () => {
    expect(buildAgentReplyStatusPatch({ waiting_reason: null }, now)).toEqual({
      status: "waiting_customer",
      waiting_reason: "customer",
      close_pending: false,
      attention_reason: null,
      status_changed_at: now,
    });
  });
  it("returns to waiting_third_party when a third-party wait is active", () => {
    expect(
      buildAgentReplyStatusPatch({ waiting_reason: "third_party" }, now).status
    ).toBe("waiting_third_party");
  });
});
