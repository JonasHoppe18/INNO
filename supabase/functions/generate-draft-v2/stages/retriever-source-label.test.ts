import { assertEquals } from "jsr:@std/assert@1";
import {
  buildRetrievalCandidateDiagnostics,
  evaluateRuntimeKnowledgeDocumentAccess,
  metadataLabelText,
  type RetrievedChunk,
  sourceLabel,
} from "./retriever.ts";

// Fix A: document chunks (e.g. General knowledge) store their H2 heading under
// metadata.section_heading / normalized_heading, not metadata.title. These tests
// assert the heading is now surfaced as a label/title for diagnostics and the
// matcher's candidate title, while existing title/name/label behavior is intact.

Deno.test("metadataLabelText: section_heading is used when title/name/label absent", () => {
  assertEquals(
    metadataLabelText({
      section_heading: "Missing accessories and spare parts",
    }),
    "Missing accessories and spare parts",
  );
});

Deno.test("metadataLabelText: normalized_heading is used as a fallback", () => {
  assertEquals(
    metadataLabelText({
      normalized_heading: "missing accessories and spare parts",
    }),
    "missing accessories and spare parts",
  );
});

Deno.test("metadataLabelText: explicit title/name/label keep precedence over headings", () => {
  // title wins
  assertEquals(
    metadataLabelText({
      title: "Explicit Title",
      name: "Name",
      label: "Label",
      section_heading: "Heading",
      normalized_heading: "heading",
    }),
    "Explicit Title",
  );
  // name wins when title absent
  assertEquals(
    metadataLabelText({ name: "Name", section_heading: "Heading" }),
    "Name",
  );
  // label wins when title/name absent
  assertEquals(
    metadataLabelText({ label: "Label", section_heading: "Heading" }),
    "Label",
  );
});

Deno.test("metadataLabelText: empty when no usable field present", () => {
  assertEquals(metadataLabelText({}), "");
  assertEquals(metadataLabelText({ usable_as: "policy" }), "");
});

Deno.test("sourceLabel: knowledge_document chunk gets provider + section heading", () => {
  assertEquals(
    sourceLabel({
      source_provider: "knowledge_document",
      source_type: "document",
      metadata: { section_heading: "Missing accessories and spare parts" },
    }),
    "knowledge_document: Missing accessories and spare parts",
  );
});

Deno.test("sourceLabel: normalized_heading fallback", () => {
  assertEquals(
    sourceLabel({
      source_provider: "knowledge_document",
      metadata: { normalized_heading: "technical issues" },
    }),
    "knowledge_document: technical issues",
  );
});

Deno.test("sourceLabel: explicit title unchanged (precedence preserved)", () => {
  assertEquals(
    sourceLabel({
      source_provider: "manual_text",
      metadata: { title: "Dongle pairing guide", section_heading: "ignored" },
    }),
    "manual_text: Dongle pairing guide",
  );
});

Deno.test("sourceLabel: provider only when no label available (unchanged)", () => {
  assertEquals(
    sourceLabel({ source_provider: "knowledge_document", metadata: {} }),
    "knowledge_document",
  );
});

// diagnosticChunkMeta is internal; exercise it through buildRetrievalCandidateDiagnostics,
// which sets each query_results[].title via diagnosticChunkMeta.
function chunk(
  id: string,
  overrides: Partial<RetrievedChunk> = {},
): RetrievedChunk {
  return {
    id,
    content: "policy content that must not be copied",
    kind: "document",
    source_label: "knowledge_document: Missing accessories and spare parts",
    similarity: 0.5,
    usable_as: "policy",
    risk_flags: [],
    applies_to_all_products: false,
    chunk_issue_types: [],
    source_title: null,
    products: [],
    vector_similarity: 0.7,
    question: null,
    ...overrides,
  };
}

Deno.test("diagnosticChunkMeta (via diagnostics): section_heading surfaces as query_results title", () => {
  const id = "4577";
  const rowWithHeading = {
    id,
    content:
      "# General Knowledge\n\n## Missing accessories and spare parts\n\n...",
    source_type: "document",
    source_provider: "knowledge_document",
    similarity: 0.7,
    metadata: { section_heading: "Missing accessories and spare parts" },
  };
  const c = chunk(id);
  const diagnostics = buildRetrievalCandidateDiagnostics({
    plannerQueries: ["dongle replacement"],
    fallbackQueries: [],
    queryDefs: [{ text: "dongle replacement", productAgnostic: false }],
    queryPairs: [{ vector: [rowWithHeading], bm25: [] }],
    fusedRaw: [{
      id,
      score: 0.03,
      vectorSimilarity: 0.7,
      chunk: rowWithHeading,
    }],
    scoredChunks: [c],
    candidatesPostDedupe: [c],
    matcherPool: [c],
    matcherDebug: undefined,
    finalChunks: [],
    scoreBreakdown: (cand) => ({
      base_score: cand.similarity,
      product_boost: 0,
      issue_type_boost: 0,
      lexical_issue_boost: 0,
      product_support_doc_boost: 0,
      general_policy_boost: 0,
      power_reset_boost: 0,
      return_policy_boost: 0,
      source_type_boost: 0,
      usable_as_boost: 0,
      cross_product_penalty: 0,
      final_score: cand.similarity,
    }),
  });
  const titles = diagnostics.query_results.map((r) => r.title);
  assertEquals(titles, ["Missing accessories and spare parts"]);
});

// Requirement 4: the runtime category gate is untouched by Fix A. A document
// chunk with an unsupported category is still blocked (label change only).
Deno.test("runtime gate: unsupported category still blocked (unchanged by Fix A)", () => {
  const decision = evaluateRuntimeKnowledgeDocumentAccess({
    source_provider: "knowledge_document",
    content: "# Doc\n\n## Random\n\nUnsupported document body.",
    metadata: {
      environment: "production",
      category: "totally_unsupported_category",
      section_heading: "Random",
    },
    plan: {
      primary_intent: "complaint",
      resolution_stage: "info_only",
      sub_queries: [],
    } as any,
    customerMessage: "hello",
    shop: { product_overview: "- A-Spire Wireless" },
  });
  assertEquals(decision.allowed, false);
});
