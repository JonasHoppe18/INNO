import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildKnowledgeDocPreviewContext } from "./knowledge-doc-preview-context.ts";

Deno.test("no preview context returns no block, diagnostics, or sources", () => {
  const result = buildKnowledgeDocPreviewContext(null);
  assertEquals(result.blockText, null);
  assertEquals(result.diagnostics, null);
  assertEquals(result.sources, []);
});

Deno.test("explicit preview context renders a preview-only authoritative block", () => {
  const result = buildKnowledgeDocPreviewContext({
    document_id: "doc-1",
    sections: [
      {
        chunk_id: "chunk-1",
        section_key: "return_window",
        section_heading: "Return window",
        content: "30 days",
      },
    ],
  });

  assertStringIncludes(result.blockText ?? "", "AUTHORITATIVE PREVIEW KNOWLEDGE DOCUMENT");
  assertStringIncludes(result.blockText ?? "", "explicit test or simulation run");
  assertStringIncludes(result.blockText ?? "", "## Return window");
  assertStringIncludes(result.blockText ?? "", "30 days");
  assertEquals(result.diagnostics?.injected, true);
  assertEquals(result.diagnostics?.document_id, "doc-1");
  assertEquals(result.diagnostics?.preview_chunk_ids, ["chunk-1"]);
  assertEquals(result.diagnostics?.section_headings, ["Return window"]);
});

Deno.test("multiple preview sections preserve order", () => {
  const result = buildKnowledgeDocPreviewContext({
    document_id: "doc-1",
    sections: [
      {
        chunk_id: "chunk-1",
        section_key: "return_window",
        section_heading: "Return window",
        content: "30 days",
      },
      {
        chunk_id: "chunk-2",
        section_key: "refund_processing",
        section_heading: "Refund processing",
        content: "Refunds return to the original payment method.",
      },
    ],
  });

  const block = result.blockText ?? "";
  assertEquals(
    block.indexOf("## Return window") < block.indexOf("## Refund processing"),
    true,
  );
  assertEquals(result.diagnostics?.preview_chunk_ids, ["chunk-1", "chunk-2"]);
  assertEquals(result.sources.map((source) => source.source_label), [
    "Draft document: Return window",
    "Draft document: Refund processing",
  ]);
});

Deno.test("feature-branch chunk-shaped preview context is supported", () => {
  const result = buildKnowledgeDocPreviewContext({
    requested: true,
    document_id: "doc-1",
    chunk_ids: ["chunk-1"],
    section_headings: ["Return window"],
    chunks: [
      {
        id: "chunk-1",
        content: "## Return window\n30 days",
        metadata: {
          section_key: "return_window",
          section_heading: "Return window",
        },
      },
    ],
  });

  assertEquals(result.diagnostics?.injected, true);
  assertEquals(result.diagnostics?.preview_chunk_ids, ["chunk-1"]);
  assertStringIncludes(result.blockText ?? "", "## Return window");
  assertStringIncludes(result.blockText ?? "", "30 days");
});

Deno.test("missing sections produce safe non-injected diagnostics", () => {
  const result = buildKnowledgeDocPreviewContext({
    document_id: "doc-1",
    sections: [],
  });

  assertEquals(result.blockText, null);
  assertEquals(result.diagnostics?.injected, false);
  assertEquals(result.diagnostics?.reason, "no_preview_sections");
  assertEquals(result.sources, []);
});

Deno.test("preview context has no shop-specific or address-specific hardcoding", () => {
  const result = buildKnowledgeDocPreviewContext({
    document_id: "doc-1",
    sections: [
      {
        chunk_id: "chunk-1",
        section_key: "special_cases",
        section_heading: "Special cases",
        content: "Use the documented policy text.",
      },
    ],
  });

  const block = result.blockText ?? "";
  assertEquals(/AceZone|Øster|Nordre|address/i.test(block), false);
});
