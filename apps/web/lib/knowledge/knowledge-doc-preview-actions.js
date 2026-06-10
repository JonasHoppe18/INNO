export function getKnowledgeDocumentPreviewBlockedReason({ documentId, isDirty }) {
  if (isDirty) return "Save changes before testing it.";
  if (!String(documentId || "").trim()) return "Save the document before testing it.";
  return "";
}

export function buildKnowledgeDocumentSimulationHref(documentId) {
  const id = String(documentId || "").trim();
  if (!id) throw new Error("Save the document before testing it.");
  return `/knowledge/simulate?preview_document_id=${encodeURIComponent(id)}`;
}

export function buildKnowledgeDocumentPreviewPayload({ documentId, threadId, customMessage }) {
  const id = String(documentId || "").trim();
  if (!id) throw new Error("Save the document before testing it.");
  const payload = { preview_document_id: id };
  const thread = String(threadId || "").trim();
  if (thread) {
    payload.thread_id = thread;
    return payload;
  }
  if (customMessage) payload.custom_message = customMessage;
  return payload;
}
