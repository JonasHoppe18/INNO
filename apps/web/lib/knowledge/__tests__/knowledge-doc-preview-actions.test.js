import { describe, expect, it } from "vitest";
import {
  buildKnowledgeDocumentSimulationHref,
  getKnowledgeDocumentPreviewBlockedReason,
} from "../knowledge-doc-preview-actions.js";

describe("knowledge document preview actions", () => {
  it("requires a saved document before opening a preview", () => {
    expect(getKnowledgeDocumentPreviewBlockedReason({ documentId: "", isDirty: false })).toBe(
      "Save the document before testing it.",
    );
  });

  it("requires the latest changes to be saved before testing", () => {
    expect(getKnowledgeDocumentPreviewBlockedReason({ documentId: "doc-1", isDirty: true })).toBe(
      "Save changes before testing it.",
    );
  });

  it("blocks previews when AI indexing needs attention", () => {
    expect(
      getKnowledgeDocumentPreviewBlockedReason({
        documentId: "doc-1",
        isDirty: false,
        indexingStatus: "error",
      }),
    ).toBe("AI preview is not ready yet. Resolve the AI indexing setup, then save again.");
  });

  it("builds a preview simulation URL for a saved document", () => {
    expect(buildKnowledgeDocumentSimulationHref("doc 1")).toBe(
      "/knowledge/simulate?preview_document_id=doc%201",
    );
  });
});
