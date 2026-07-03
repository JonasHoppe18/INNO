import { describe, it, expect } from "vitest";
import { buildManualStatusPatch } from "../status-patch.js";

const NOW = "2026-07-03T12:00:00.000Z";

describe("buildManualStatusPatch", () => {
  it("normalizes legacy status input", () => {
    const { payload } = buildManualStatusPatch({ status: "Solved" }, NOW);
    expect(payload.status).toBe("resolved");
    expect(payload.status_changed_at).toBe(NOW);
  });
  it("clears wait state when resolving", () => {
    const { payload } = buildManualStatusPatch({ status: "resolved" }, NOW);
    expect(payload.waiting_reason).toBe(null);
    expect(payload.wake_at).toBe(null);
    expect(payload.close_pending).toBe(false);
    expect(payload.attention_reason).toBe(null);
  });
  it("sets third-party wait with wake date", () => {
    const { payload } = buildManualStatusPatch(
      { status: "waiting_third_party", waitingReason: "third_party", wakeAt: "2026-07-08T00:00:00.000Z" },
      NOW
    );
    expect(payload.status).toBe("waiting_third_party");
    expect(payload.waiting_reason).toBe("third_party");
    expect(payload.wake_at).toBe("2026-07-08T00:00:00.000Z");
  });
  it("defaults waiting_reason from the status", () => {
    const { payload } = buildManualStatusPatch({ status: "waiting_customer" }, NOW);
    expect(payload.waiting_reason).toBe("customer");
  });
  it("rejects an invalid wakeAt", () => {
    const { error } = buildManualStatusPatch(
      { status: "waiting_third_party", wakeAt: "not-a-date" },
      NOW
    );
    expect(error).toBeTruthy();
  });
  it("passes through no-status bodies untouched", () => {
    const { payload } = buildManualStatusPatch({}, NOW);
    expect(payload).toEqual({});
  });
});
