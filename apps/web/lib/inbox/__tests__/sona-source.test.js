import { describe, expect, it } from "vitest";
import {
  describeKnowledgeContent,
  describeKnowledgeSource,
  formatOrderNumber,
} from "../sona-source.js";

describe("Sona source presentation", () => {
  it("turns internal manual text labels into customer-facing knowledge labels", () => {
    expect(describeKnowledgeSource({ title: "manual_text: How do I return an item?" })).toEqual({
      title: "How do I return an item?",
      typeLabel: "Knowledge article",
    });
  });

  it("keeps Shopify provenance without exposing the raw prefix", () => {
    expect(describeKnowledgeSource({ title: "shopify_policy: Refund policy" })).toEqual({
      title: "Refund policy",
      typeLabel: "Shopify policy",
    });
  });

  it("uses the answer as the preview for question and answer knowledge", () => {
    expect(describeKnowledgeContent("Question: Can I return it? Answer: Yes, within 30 days.")).toMatchObject({
      question: "Can I return it?",
      answer: "Yes, within 30 days.",
      preview: "Answer: Yes, within 30 days.",
    });
  });

  it("normalizes order numbers to one leading hash", () => {
    expect(formatOrderNumber("##1051")).toBe("#1051");
    expect(formatOrderNumber("1051")).toBe("#1051");
  });
});
