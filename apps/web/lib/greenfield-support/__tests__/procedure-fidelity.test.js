import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { createDemoDependencies } from "../demo-fixtures";
import { InMemoryKnowledgeStore } from "../knowledge";
import { renderResponseSegments, validateStructuredResponse } from "../response-contract";

const WORKSPACE_ID = "greenfield-demo-workspace";

async function procedureRegistry() {
  const base = await createDemoDependencies();
  const knowledge = new InMemoryKnowledgeStore();
  await knowledge.ingest(WORKSPACE_ID, {
    sourceKind: "merchant_authored",
    sourceId: "wireless-reset",
    title: "A-Spire Wireless factory reset",
    content: [
      "Turn the headset off.",
      "Hold the power button for at least 15 seconds.",
      "Listen for the reset voice prompt.",
      "Remove saved Bluetooth devices before pairing again.",
    ].join("\n\n"),
    knowledgeType: "procedural",
    authority: "authoritative",
    sourceLabel: "Merchant Wireless support procedure",
    structuredData: { applies_to: { product_models: ["A-Spire Wireless"] } },
  });
  await knowledge.ingest(WORKSPACE_ID, {
    sourceKind: "merchant_authored",
    sourceId: "wired-reset",
    title: "A-Spire factory reset",
    content: [
      "Turn the headset off.",
      "Hold the power button for at least 35 seconds.",
      "Press Play/Pause after the Bluetooth pairing prompt.",
    ].join("\n\n"),
    knowledgeType: "procedural",
    authority: "authoritative",
    sourceLabel: "Merchant wired support procedure",
    structuredData: { applies_to: { product_models: ["A-Spire"] } },
  });
  return createCapabilityRegistry({ ...base, knowledge });
}

function procedureResultIndex(result, sourceId) {
  return result.data.results.findIndex((item) => item.provenance.source_id === sourceId);
}

function stepPath(resultIndex, stepIndex) {
  return `data.results[${resultIndex}].structured_data.procedure_steps[${stepIndex}].text`;
}

function procedureSegment(resultId, resultIndex, steps, text = "I found the relevant instructions.") {
  return {
    type: "procedure_guidance",
    text,
    basis: {
      result_id: resultId,
      field_paths: [`data.results[${resultIndex}].provenance.source_id`],
    },
    step_paths: steps.map((step) => stepPath(resultIndex, step)),
  };
}

describe("source-bound merchant procedure guidance", () => {
  it("preserves exact numeric/button/order facts from one procedure", async () => {
    const registry = await procedureRegistry();
    const lookup = await registry.execute("search_procedures", JSON.stringify({ query: "A-Spire Wireless factory reset" }));
    const wirelessIndex = procedureResultIndex(lookup, "wireless-reset");
    const result = validateStructuredResponse({
      segments: [procedureSegment(lookup.resultId, wirelessIndex, [0, 1, 2, 3])],
    }, { ...registry, customerMessage: "I need to reset my A-Spire Wireless." });

    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, { ...registry, customerMessage: "I need to reset my A-Spire Wireless." });
    expect(rendered).toContain("15 seconds");
    expect(rendered).toContain("power button");
    expect(rendered).toContain("Remove saved Bluetooth devices");
    expect(rendered).not.toContain("35 seconds");
    expect(rendered).not.toContain("Play/Pause");
  });

  it("rejects reordered source steps and cross-record step mixing", async () => {
    const registry = await procedureRegistry();
    const lookup = await registry.execute("search_procedures", JSON.stringify({ query: "A-Spire Wireless factory reset" }));
    const wirelessIndex = procedureResultIndex(lookup, "wireless-reset");
    const wiredIndex = procedureResultIndex(lookup, "wired-reset");

    const reordered = validateStructuredResponse({
      segments: [procedureSegment(lookup.resultId, wirelessIndex, [1, 0])],
    }, { ...registry, customerMessage: "Reset my A-Spire Wireless." });
    const mixed = validateStructuredResponse({
      segments: [
        {
          ...procedureSegment(lookup.resultId, wirelessIndex, [0, 1]),
          step_paths: [stepPath(wirelessIndex, 0), stepPath(wiredIndex, 1)],
        },
      ],
    }, { ...registry, customerMessage: "Reset my A-Spire Wireless." });

    expect(reordered.issues.map((issue) => issue.code)).toContain("procedure_step_order");
    expect(mixed.issues.map((issue) => issue.code)).toContain("procedure_cross_record_merge");
  });

  it("renders source steps instead of allowing unsupported model prose", async () => {
    const registry = await procedureRegistry();
    const lookup = await registry.execute("search_procedures", JSON.stringify({ query: "A-Spire Wireless factory reset" }));
    const wirelessIndex = procedureResultIndex(lookup, "wireless-reset");
    const segment = procedureSegment(
      lookup.resultId,
      wirelessIndex,
      [1],
      "Hold ANC for 10 seconds and then press Play/Pause.",
    );
    segment.step_paths = [`structured_data.procedure_steps[1]`];
    const result = validateStructuredResponse({
      segments: [segment],
    }, { ...registry, customerMessage: "How long should I hold the power button on A-Spire Wireless?" });
    expect(result.allValid).toBe(true);
    const rendered = renderResponseSegments(result.approvedSegments, { ...registry, customerMessage: "How long should I hold the power button on A-Spire Wireless?" });
    expect(rendered).toContain("15 seconds");
    expect(rendered).not.toContain("ANC");
    expect(rendered).not.toContain("10 seconds");
    expect(rendered).not.toContain("Play/Pause");
  });

  it("keeps partial continuation source-bound and rejects a mismatched product", async () => {
    const registry = await procedureRegistry();
    const lookup = await registry.execute("search_procedures", JSON.stringify({ query: "A-Spire Wireless factory reset" }));
    const wirelessIndex = procedureResultIndex(lookup, "wireless-reset");
    const wiredIndex = procedureResultIndex(lookup, "wired-reset");
    const continuation = validateStructuredResponse({
      segments: [procedureSegment(lookup.resultId, wirelessIndex, [2, 3])],
    }, { ...registry, customerMessage: "I already turned it off and held the power button for 15 seconds on my A-Spire Wireless. What next?" });
    const mismatch = validateStructuredResponse({
      segments: [procedureSegment(lookup.resultId, wiredIndex, [0, 1, 2])],
    }, { ...registry, customerMessage: "I need to reset my A-Spire Wireless." });

    expect(continuation.allValid).toBe(true);
    const rendered = renderResponseSegments(continuation.approvedSegments, { ...registry, customerMessage: "I already turned it off and held the power button for 15 seconds on my A-Spire Wireless. What next?" });
    expect(rendered).toContain("reset voice prompt");
    expect(rendered).toContain("saved Bluetooth devices");
    expect(rendered).not.toContain("15 seconds");
    expect(mismatch.issues.map((issue) => issue.code)).toContain("procedure_product_mismatch");
  });

  it("fails closed when no procedure was found instead of fabricating steps", async () => {
    const registry = await procedureRegistry();
    const lookup = await registry.execute("search_procedures", JSON.stringify({ query: "unknown solar panel calibration" }));
    expect(lookup.status).toBe("not_found");

    const result = validateStructuredResponse({
      segments: [procedureSegment(lookup.resultId, 0, [0], "Hold the button for 20 seconds.")],
    }, { ...registry, customerMessage: "How do I reset an unknown product?" });

    expect(result.approvedSegments).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toContain("result_not_verified");
    expect(renderResponseSegments(result.approvedSegments, { ...registry, customerMessage: "How do I reset an unknown product?" })).toBe("");
  });

  it("does not allow legacy free-form guidance to cite procedural evidence", async () => {
    const registry = await procedureRegistry();
    const lookup = await registry.execute("search_procedures", JSON.stringify({ query: "A-Spire Wireless factory reset" }));
    const wirelessIndex = procedureResultIndex(lookup, "wireless-reset");
    const result = validateStructuredResponse({
      segments: [{
        type: "knowledge_guidance",
        text: "Hold the power button for 15 seconds.",
        basis: {
          result_id: lookup.resultId,
          field_paths: [`data.results[${wirelessIndex}].provenance.source_id`],
        },
      }],
    }, { ...registry, customerMessage: "Reset my A-Spire Wireless." });

    expect(result.issues.map((issue) => issue.code)).toContain("procedure_binding_required");
  });
});
