import { describe, it, expect } from "vitest";
import { customerPreviewsByThread } from "../message-preview";

describe("customer message previews", () => {
  it("selects the latest customer message despite newer replies, drafts and internal messages", () => {
    const messages = [
      { thread_id: "a", received_at: "2026-01-01", body_text: "Old question" },
      { thread_id: "a", received_at: "2026-01-02", clean_body_text: "New question", body_text: "New question plus quoted history" },
      { thread_id: "a", sent_at: "2026-01-03", from_me: true, body_text: "Our reply" },
      { thread_id: "a", received_at: "2026-01-04", is_draft: true, body_text: "Draft" },
      { thread_id: "a", received_at: "2026-01-05", from_email: "team@example.invalid", body_text: "Internal" },
    ];
    expect(customerPreviewsByThread(messages, [], (message) => message.from_email === "team@example.invalid")).toEqual({ a: "New question" });
  });

  it("keeps attachment-only latest messages empty instead of showing an older question", () => {
    expect(customerPreviewsByThread([
      { thread_id: "a", received_at: "2026-01-01", body_text: "Older text" },
      { thread_id: "a", received_at: "2026-01-02" },
    ])).toEqual({ a: "" });
  });

  it("flattens multiline text and strips HTML formatting from previews", () => {
    expect(customerPreviewsByThread([
      { thread_id: "a", received_at: "2026-01-01", body_text: "Hello\n\nWhere is\tmy order?" },
      { thread_id: "b", received_at: "2026-01-01", body_html: "<style>hidden</style><p>Returns &amp; refunds</p>" },
    ])).toEqual({ a: "Hello Where is my order?", b: "Returns & refunds" });
  });
});
