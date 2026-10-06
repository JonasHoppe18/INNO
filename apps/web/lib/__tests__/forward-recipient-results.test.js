import { describe, expect, it } from "vitest";
import {
  buildForwardRecipientResult,
  getForwardRecipientDisplayModel,
  summarizeForwardRecipientResults,
} from "../forward-recipient-results.js";

const recipient = (email, state, errorCode = null) =>
  buildForwardRecipientResult({
    recipient: email,
    attemptId: `${email}-attempt`,
    state,
    errorCode,
  });

describe("forward recipient results", () => {
  it("summarizes three successful independent sends", () => {
    const summary = summarizeForwardRecipientResults([
      recipient("one@example.com", "sent"),
      recipient("two@example.com", "sent"),
      recipient("three@example.com", "sent"),
    ]);

    expect(summary).toMatchObject({ kind: "all_succeeded", detail: "Forwarded to 3 recipients." });
  });

  it("preserves successful recipients in a partial failure", () => {
    const summary = summarizeForwardRecipientResults([
      recipient("one@example.com", "sent"),
      recipient("two@example.com", "failed", "recipient_rejected"),
      recipient("three@example.com", "sent"),
    ]);

    expect(summary).toMatchObject({ kind: "partial_failure" });
    expect(summary.error).toContain("Forwarded to 2 of 3 recipients.");
    expect(summary.error).toContain("two@example.com — delivery rejected");
  });

  it("keeps unknown recipients out of automatic retry messaging", () => {
    const summary = summarizeForwardRecipientResults([
      recipient("one@example.com", "sent"),
      recipient("two@example.com", "unknown", "send_status_unknown"),
    ]);

    expect(summary.kind).toBe("unknown_outcome");
    expect(summary.error).toContain("do not retry those recipients automatically");
    expect(summary.error).toContain("two@example.com");
  });

  it("reports known failures alongside unknown outcomes", () => {
    const summary = summarizeForwardRecipientResults([
      recipient("one@example.com", "unknown", "send_status_unknown"),
      recipient("two@example.com", "failed", "recipient_rejected"),
    ]);

    expect(summary.kind).toBe("unknown_outcome");
    expect(summary.error).toContain("one@example.com");
    expect(summary.error).toContain("two@example.com — delivery rejected");
  });

  it("reports concurrent recipient work separately", () => {
    const summary = summarizeForwardRecipientResults([
      recipient("one@example.com", "in_progress", "send_in_progress"),
      recipient("two@example.com", "sent"),
    ]);

    expect(summary.kind).toBe("in_progress");
    expect(summary.detail).toContain("one@example.com");
  });

  it("builds an all-success recipient result view without retryable recipients", () => {
    const model = getForwardRecipientDisplayModel([
      recipient("one@example.com", "sent"),
      recipient("two@example.com", "sent"),
      recipient("three@example.com", "sent"),
    ]);

    expect(model).toMatchObject({
      headline: "Forwarded to 3 recipients",
      isMultiRecipient: true,
      hasUnknown: false,
      retryableRecipients: [],
    });
    expect(model.results.map((result) => result.email)).toEqual([
      "one@example.com",
      "two@example.com",
      "three@example.com",
    ]);
  });

  it("exposes only failed recipients as retryable in a partial result", () => {
    const model = getForwardRecipientDisplayModel([
      recipient("one@example.com", "sent"),
      recipient("two@example.com", "failed", "recipient_rejected"),
      recipient("three@example.com", "sent"),
    ]);

    expect(model.headline).toBe("Forwarded to 2 of 3 recipients");
    expect(model.retryableRecipients).toEqual(["two@example.com"]);
    expect(model.hasUnknown).toBe(false);
  });

  it("does not make unknown recipients retryable and preserves the warning state", () => {
    const model = getForwardRecipientDisplayModel([
      recipient("one@example.com", "sent"),
      recipient("two@example.com", "unknown", "send_status_unknown"),
      recipient("three@example.com", "failed", "recipient_rejected"),
    ]);

    expect(model.headline).toBe("Forwarded to 1 of 3 recipients");
    expect(model.hasUnknown).toBe(true);
    expect(model.retryableRecipients).toEqual(["three@example.com"]);
  });

  it("keeps a failed all-recipient result retryable", () => {
    const model = getForwardRecipientDisplayModel([
      recipient("one@example.com", "failed", "recipient_rejected"),
      recipient("two@example.com", "failed", "recipient_suppressed"),
    ]);

    expect(model.headline).toBe("The forward could not be delivered");
    expect(model.retryableRecipients).toEqual(["one@example.com", "two@example.com"]);
  });
});
