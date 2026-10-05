import { describe, expect, it } from "vitest";
import {
  addForwardRecipient,
  formatForwardRecipients,
  formatForwardRecipientList,
  normalizeForwardRecipients,
  removeForwardRecipient,
  resolveForwardRecipients,
} from "../forward-recipients.js";

describe("forward recipient normalization", () => {
  it("keeps the legacy single target compatible", () => {
    expect(resolveForwardRecipients({ payload: { target_email: " Team@Example.com " } })).toMatchObject({
      recipients: ["team@example.com"],
      valid: true,
      source: "legacy",
    });
  });

  it("normalizes multiple recipients and removes case-insensitive duplicates", () => {
    expect(normalizeForwardRecipients(["a@example.com", "B@example.com", "A@example.com"])).toMatchObject({
      recipients: ["a@example.com", "b@example.com"],
      duplicates: ["a@example.com"],
      valid: false,
    });
    expect(formatForwardRecipients(["a@example.com", "b@example.com"])).toBe(
      "a@example.com, b@example.com",
    );
    expect(formatForwardRecipientList(["a@example.com", "b@example.com", "c@example.com"])).toBe(
      "a@example.com, b@example.com, and c@example.com",
    );
  });

  it("rejects empty, malformed, and over-limit recipient input", () => {
    expect(normalizeForwardRecipients([]).valid).toBe(false);
    expect(normalizeForwardRecipients(["not-an-email"]).invalid).toEqual(["not-an-email"]);
    expect(normalizeForwardRecipients(Array.from({ length: 21 }, (_, i) => `user-${i}@example.com`))).toMatchObject({
      tooMany: true,
      valid: false,
    });
    expect(normalizeForwardRecipients(["unsafe\n@example.com"]).invalid).toEqual([
      "unsafe\n@example.com",
    ]);
  });

  it("does not fall back to a legacy address when an explicit empty array is supplied", () => {
    expect(resolveForwardRecipients({
      payload: { recipients: [], target_email: "legacy@example.com" },
      detail: "Forward to detail@example.com",
    })).toMatchObject({ recipients: [], valid: false, source: "recipients" });
  });

  it("adds and removes recipients without allowing malformed or duplicate entries", () => {
    const added = addForwardRecipient(["first@example.com"], " Second@Example.com ");
    expect(added).toEqual({
      ok: true,
      error: "",
      recipients: ["first@example.com", "second@example.com"],
    });
    expect(addForwardRecipient(added.recipients, "FIRST@example.com").ok).toBe(false);
    expect(addForwardRecipient(added.recipients, "not-an-email").ok).toBe(false);
    expect(removeForwardRecipient(added.recipients, "FIRST@example.com")).toEqual([
      "second@example.com",
    ]);
  });

  it("uses only the first detail address for legacy proposal text", () => {
    expect(resolveForwardRecipients({ detail: "Forward this to first@example.com and second@example.com" })).toMatchObject({
      recipients: ["first@example.com"],
      valid: true,
      source: "detail",
    });
  });
});
