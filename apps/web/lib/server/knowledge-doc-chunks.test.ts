// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildKnowledgeDocumentChunks } from "./knowledge-doc-chunks.ts";
import type { KnowledgeDocumentSection } from "./knowledge-doc-parser.ts";

function section(overrides: Partial<KnowledgeDocumentSection> = {}): KnowledgeDocumentSection {
  return {
    heading: "Default return address",
    normalized_heading: "default return address",
    section_key: "return_address",
    content: "Address text.",
    order: 0,
    metadata: { address_type: "ordinary_return", region_scope: "default" },
    warnings: [],
    ...overrides,
  };
}

Deno.test("preview chunks are inactive and preserve environment", () => {
  const rows = buildKnowledgeDocumentChunks({
    shopId: "shop-1",
    documentId: "doc-1",
    documentType: "returns_refunds",
    category: "returns",
    title: "Returns & Refunds",
    sections: [section()],
    environment: "preview",
  });

  assertEquals(rows[0].source_type, "document");
  assertEquals(rows[0].source_provider, "knowledge_document");
  assertEquals(rows[0].metadata.environment, "preview");
  assertEquals(rows[0].metadata.active_for_ai, false);
});

Deno.test("production chunks stay inactive until runtime activation is wired", () => {
  const rows = buildKnowledgeDocumentChunks({
    shopId: "shop-1",
    documentId: "doc-1",
    documentType: "returns_refunds",
    category: "returns",
    title: "Returns & Refunds",
    sections: [section()],
    environment: "production",
  });

  assertEquals(rows[0].metadata.environment, "production");
  assertEquals(rows[0].metadata.active_for_ai, false);
  assertEquals(rows[0].metadata.runtime_activation_pending, true);
});

Deno.test("document id and section order are preserved", () => {
  const rows = buildKnowledgeDocumentChunks({
    shopId: "shop-1",
    documentId: "doc-1",
    documentType: "returns_refunds",
    category: "returns",
    title: "Returns & Refunds",
    sections: [
      section({ heading: "Return window", section_key: "return_window", order: 0, metadata: {} }),
      section({ heading: "Refund processing", section_key: "refund_processing", order: 1, metadata: {} }),
    ],
    environment: "preview",
  });

  assertEquals(rows.map((r) => r.metadata.document_id), ["doc-1", "doc-1"]);
  assertEquals(rows.map((r) => r.metadata.section_order), [0, 1]);
  assertEquals(rows.map((r) => r.metadata.chunk_index), [0, 1]);
  assertEquals(rows.map((r) => r.metadata.chunk_count), [2, 2]);
});

Deno.test("parser metadata is preserved without inventing unrelated metadata", () => {
  const rows = buildKnowledgeDocumentChunks({
    shopId: "shop-1",
    documentId: "doc-1",
    documentType: "returns_refunds",
    category: "returns",
    title: "Returns & Refunds",
    sections: [section()],
    environment: "preview",
  });

  assertEquals(rows[0].metadata.address_type, "ordinary_return");
  assertEquals(rows[0].metadata.region_scope, "default");
  assertEquals("product_scope" in rows[0].metadata, false);
});

Deno.test("unknown sections stay safe and body text does not infer address metadata", () => {
  const rows = buildKnowledgeDocumentChunks({
    shopId: "shop-1",
    documentId: "doc-1",
    documentType: "returns_refunds",
    category: "returns",
    title: "Returns & Refunds",
    sections: [
      section({
        heading: "Special cases",
        normalized_heading: "special cases",
        section_key: "special_cases",
        content: "Testvej 12, 1000 Copenhagen",
        metadata: {},
      }),
    ],
    environment: "preview",
  });

  assertEquals(rows[0].metadata.section_key, "special_cases");
  assertEquals("address_type" in rows[0].metadata, false);
  assertEquals("region_scope" in rows[0].metadata, false);
});

Deno.test("input sections are not mutated", () => {
  const input = [section({ warnings: ["empty_section"] })];
  const before = JSON.stringify(input);
  buildKnowledgeDocumentChunks({
    shopId: "shop-1",
    documentId: "doc-1",
    documentType: "returns_refunds",
    category: "returns",
    title: "Returns & Refunds",
    sections: input,
    environment: "preview",
  });

  assertEquals(JSON.stringify(input), before);
});
