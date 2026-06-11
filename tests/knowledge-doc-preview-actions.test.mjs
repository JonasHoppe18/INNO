import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKnowledgeDocumentPreviewPayload,
  buildKnowledgeDocumentSimulationHref,
  getKnowledgeDocumentPreviewBlockedReason,
} from "../apps/web/lib/knowledge/knowledge-doc-preview-actions.js";

test("unsaved document returns a clear preview block reason", () => {
  assert.equal(
    getKnowledgeDocumentPreviewBlockedReason({ documentId: "", isDirty: false }),
    "Save the document before testing it.",
  );
});

test("dirty document returns a clear preview block reason", () => {
  assert.equal(
    getKnowledgeDocumentPreviewBlockedReason({ documentId: "doc-1", isDirty: true }),
    "Save changes before testing it.",
  );
});

test("saved document simulation href carries preview_document_id", () => {
  assert.equal(
    buildKnowledgeDocumentSimulationHref("doc 1"),
    "/knowledge/simulate?preview_document_id=doc%201",
  );
});

test("saved document ticket preview payload carries preview_document_id and thread id", () => {
  assert.deepEqual(
    buildKnowledgeDocumentPreviewPayload({ documentId: "doc-1", threadId: "thread-1" }),
    { preview_document_id: "doc-1", thread_id: "thread-1" },
  );
});

test("saved document custom preview payload carries preview_document_id and custom message", () => {
  const customMessage = { body: "Can I return these?", subject: "Return" };
  assert.deepEqual(
    buildKnowledgeDocumentPreviewPayload({ documentId: "doc-1", customMessage }),
    { preview_document_id: "doc-1", custom_message: customMessage },
  );
});

test("missing document id fails safely before preview payload construction", () => {
  assert.throws(
    () => buildKnowledgeDocumentPreviewPayload({ documentId: "", threadId: "thread-1" }),
    /Save the document before testing it/,
  );
});
