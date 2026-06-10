require("sucrase/register/ts-legacy-module-interop");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildKnowledgeDocumentPreviewRunBodies,
  wasLegacySnippetRetrieved,
  wasPreviewDocumentInjected,
} = require("../apps/web/lib/server/knowledge-doc-preview-comparison.ts");

const emailData = {
  subject: "Return window",
  body: "Hvor mange dage har jeg til at returnere?",
};

const previewDocumentContext = {
  requested: true,
  document_id: "doc-1",
  chunk_ids: ["chunk-return-window"],
  section_headings: ["Return window"],
  chunks: [
    {
      id: "chunk-return-window",
      content: "## Return window\n30 days",
      metadata: {
        document_id: "doc-1",
        environment: "preview",
        active_for_ai: false,
        section_key: "return_window",
        section_heading: "Return window",
      },
    },
  ],
};

test("preview comparison sends explicit context only to the with run", () => {
  const result = buildKnowledgeDocumentPreviewRunBodies({
    shopId: "shop-1",
    emailData,
    previewDocumentContext,
    snippetExcludeChunkIds: [],
  });

  assert.equal(result.withPreview.shop_id, "shop-1");
  assert.equal(result.withPreview.preview_document_context.document_id, "doc-1");
  assert.equal(result.withPreview.exclude_chunk_ids, undefined);
  assert.equal(result.withoutPreview.preview_document_context, undefined);
  assert.deepEqual(result.withoutPreview.exclude_chunk_ids, ["chunk-return-window"]);
  assert.deepEqual(result.excludedChunkIds, ["chunk-return-window"]);
});

test("legacy snippet comparison payload remains unchanged when no preview id exists", () => {
  const result = buildKnowledgeDocumentPreviewRunBodies({
    shopId: "shop-1",
    emailData,
    previewDocumentContext: null,
    snippetExcludeChunkIds: ["snippet-chunk"],
  });

  assert.deepEqual(result.withPreview, {
    shop_id: "shop-1",
    email_data: emailData,
  });
  assert.deepEqual(result.withoutPreview, {
    shop_id: "shop-1",
    email_data: emailData,
    exclude_chunk_ids: ["snippet-chunk"],
  });
});

test("banner diagnostic reports preview used only when the pipeline injected chunks", () => {
  assert.equal(
    wasPreviewDocumentInjected({
      preview_document_context: {
        injected: true,
        preview_chunk_ids: ["chunk-return-window"],
        reason: "injected",
      },
    }),
    true,
  );
  assert.equal(
    wasPreviewDocumentInjected({
      preview_document_context: {
        injected: false,
        preview_chunk_ids: ["chunk-return-window"],
        reason: "intent_not_applicable",
      },
    }),
    false,
  );
});

test("legacy snippet detection still uses source labels", () => {
  assert.equal(
    wasLegacySnippetRetrieved({
      snippetTitle: "Refund policy",
      run: { sources: [{ source_label: "shopify_policy: Refund policy" }] },
    }),
    true,
  );
  assert.equal(
    wasLegacySnippetRetrieved({
      snippetTitle: "Refund policy",
      run: { sources: [{ source_label: "shopify_policy: Privacy policy" }] },
    }),
    false,
  );
});
