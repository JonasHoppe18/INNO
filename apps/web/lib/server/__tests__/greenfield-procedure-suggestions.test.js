import { describe, expect, it } from "vitest";
import {
  buildPublishedProcedure,
  buildSuggestionUpdate,
  normalizeSuggestionSteps,
  serializeProcedureSuggestion,
  validateProcedureSuggestionPayload,
} from "../greenfield-procedure-suggestions";

const suggestion = {
  id: "suggestion-1",
  workspace_id: "workspace-a",
  suggestion_key: "returns_rma",
  title: "Returns / RMA intake",
  trigger: "Customer asks to return an item or receive a refund.",
  customer_phrasing_examples: ["I want to return this", "Can I get a refund?"],
  recommended_steps: [
    { kind: "instruction", text: "Identify the customer and order.", list_style: "ordered" },
    { kind: "instruction", text: "Check the current return policy.", list_style: "ordered" },
  ],
  escalation_condition: "Escalate exceptions or action requests requiring approval.",
  policy_dependencies: ["Current return policy"],
  action_permission_note: "Human approval required for refund or return action.",
  historical_evidence_count: 320,
  confidence: "HIGH",
  status: "suggested",
  provenance: {
    origin: "historical_support_suggestion",
    evidence_count: 320,
    confidence_at_creation: "HIGH",
    policy_conflict_warnings: ["Historical return wording needs current policy review."],
  },
};

describe("greenfield procedure suggestions", () => {
  it("normalizes aggregate evidence without accepting raw or malformed steps", () => {
    expect(normalizeSuggestionSteps([
      { kind: "instruction", text: " Check the current policy. ", list_style: "unordered" },
      { kind: "not-a-block", text: "Escalate when unresolved." },
      { kind: "instruction", text: "" },
    ])).toEqual([
      { kind: "instruction", text: "Check the current policy.", list_style: "unordered" },
      { kind: "instruction", text: "Escalate when unresolved.", list_style: "ordered" },
    ]);
  });

  it("validates editable review fields and maps the review lifecycle", () => {
    const validation = validateProcedureSuggestionPayload({
      title: "Returns / RMA intake revised",
      trigger: "A customer asks to return an item.",
      customer_phrasing_examples: ["return this"],
      recommended_steps: [{ kind: "instruction", text: "Check the current return policy." }],
      escalation_condition: "Escalate exceptions.",
      policy_dependencies: ["Current return policy"],
      action_permission_note: "Human approval required.",
      status: "reviewed",
    }, { existing: suggestion });
    expect(validation.valid).toBe(true);
    expect(buildSuggestionUpdate(validation.value, new Date("2026-09-13T12:00:00.000Z"))).toMatchObject({
      status: "reviewed",
      reviewed_at: "2026-09-13T12:00:00.000Z",
      dismissed_at: null,
    });
  });

  it("converts only the reviewed workflow to canonical structured Knowledge V1 provenance", () => {
    const validation = validateProcedureSuggestionPayload({ status: "reviewed" }, { existing: suggestion });
    const published = buildPublishedProcedure({ suggestion, value: validation.value, now: new Date("2026-09-13T12:00:00.000Z") });
    expect(published.source).toMatchObject({
      sourceKind: "merchant_authored",
      knowledgeType: "procedural",
      authority: "authoritative",
      sourceId: "historical-support-suggestion:suggestion-1",
      publishedAt: "2026-09-13T12:00:00.000Z",
    });
    expect(published.source.structuredData.procedure.blocks).toHaveLength(2);
    expect(published.source.structuredData.procedure.blocks[1].text).toBe("Check the current return policy.");
    expect(published.source.metadata.historical_support_suggestion).toMatchObject({
      origin: "historical_support_suggestion",
      evidence_count: 320,
      confidence_at_creation: "HIGH",
    });
    expect(published.source.metadata.historical_support_suggestion).not.toHaveProperty("action");
    expect(published.source.content).not.toMatch(/14|30|refund in \d+/i);
  });

  it("serializes conflict warnings and keeps published suggestions identifiable", () => {
    const serialized = serializeProcedureSuggestion({
      ...suggestion,
      status: "published",
      published_knowledge_record_id: "record-1",
    });
    expect(serialized).toMatchObject({ status: "published", published_knowledge_record_id: "record-1" });
    expect(serialized.provenance.policy_conflict_warnings).toEqual(["Historical return wording needs current policy review."]);
  });
});
