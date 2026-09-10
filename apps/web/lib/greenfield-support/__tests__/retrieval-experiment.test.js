import { describe, expect, it } from "vitest";
import { combineHybrid, titleEntityOverlap } from "../retrieval-experiment.mjs";

function record(id, title, authority = "reference") {
  return {
    id,
    workspaceId: "workspace",
    knowledgeType: "product",
    authority,
    title,
    content: title,
    structuredData: {},
    sourceKind: "product",
    sourceId: id,
    sourceUri: null,
    sourceLabel: null,
    contentHash: id,
    publishedAt: null,
    observedAt: null,
    expiresAt: null,
    metadata: {},
    chunks: [title],
  };
}

describe("greenfield retrieval experiment", () => {
  it("uses generic title/entity evidence without merchant-specific names", () => {
    expect(titleEntityOverlap("Is the Model Zeta compatible with Console 5", "Model Zeta specifications")).toBeGreaterThan(0);
  });

  it("keeps the semantic candidate when lexical retrieval has no result", () => {
    const semanticRecord = record("model-zeta", "Model Zeta specifications");
    const result = combineHybrid(
      "Is the Model Zeta compatible",
      [],
      [{ record: semanticRecord, chunk: { id: "chunk", index: 0, content: "Compatibility" }, score: 0.7 }],
      { limit: 5, now: Date.now() },
    );
    expect(result[0].record.id).toBe("model-zeta");
    expect(result[0].matchReason).toBe("semantic");
  });
});
